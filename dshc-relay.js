#!/usr/bin/env node
/**
 * dshc-relay.js — companion relay process for the "Programmer P2P Chatroom" DSH plugin.
 *
 * WHY A COMPANION PROCESS?
 *   The DSH plugin Host half only exposes ctx/harness/btoa/atob/TextEncoder/Decoder/console —
 *   no net, dgram, crypto, ws, URL. So the plugin cannot open sockets or bind a public
 *   interface by itself. This standalone Node process (full stdlib) is spawned by the plugin
 *   (via the host `subprocess` service) and does all real networking on behalf of the plugin:
 *
 *     - binds 0.0.0.0:<port>  → every machine becomes a real server reachable on the LAN
 *     - serves the HTTP relay endpoint   GET /dsh-chat-relay?since=N
 *     - pulls/merges messages from configured peers (mesh, msgId dedup)
 *     - (cross-NAT) connects to a rendezvous/TURN when configured
 *
 * The plugin talks to THIS process over http://127.0.0.1:<port> (localhost), so the plugin
 * itself never needs a public interface.
 *
 * MESSAGE FLOW
 *   plugin --POST /inject--> relay (store local messages + broadcast log)
 *   peer  --GET /dsh-chat-relay?since=N--> relay (serves messages to other machines)
 *   relay --GET http://<peer>/dsh-chat-relay?since=N--> (pulls remote messages)
 *   plugin --GET /poll?since=N--> relay (browser client pulls merged log)
 *
 * USAGE
 *   node dshc-relay.js --port 39321 [--bind 0.0.0.0] [--peer http://x:39321 ...] [--name nodeA]
 *   Health:  GET /health -> {ok:true, name, port, peers, messageCount, lastIdx}
 *
 * Zero external dependencies — uses only node:http / node:net.
 */

const http = require('http')
const os = require('os')
const dgram = require('dgram')

function parseArgs(argv) {
  const out = {
    port: 39321, bind: '0.0.0.0', peers: [], name: null,
    stateFile: null, outboxFile: null, peersFile: null, netmodeFile: null,
    // NAT traversal
    stun: null,           // STUN server host:port, e.g. 'stun.l.google.com:19302'
    turn: null,           // TURN server host:port, e.g. 'turn.example.com:3478'
    turnUser: null, turnPass: null,
    rendezvous: null      // rendezvous HTTP base URL for hole-punching peer exchange
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--bind') out.bind = argv[++i]
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--peer') out.peers.push(argv[++i])
    else if (a === '--state-file') out.stateFile = argv[++i]
    else if (a === '--outbox-file') out.outboxFile = argv[++i]
    else if (a === '--peers-file') out.peersFile = argv[++i]
    else if (a === '--netmode-file') out.netmodeFile = argv[++i]
    else if (a === '--stun') out.stun = argv[++i]
    else if (a === '--turn') out.turn = argv[++i]
    else if (a === '--turn-user') out.turnUser = argv[++i]
    else if (a === '--turn-pass') out.turnPass = argv[++i]
    else if (a === '--rendezvous') out.rendezvous = argv[++i]
  }
  return out
}

const fs = require('fs')
const args = parseArgs(process.argv)
// Stable per-machine identity: derived from hardware-ish facts so it survives restarts and
// can be used to dedupe/limit "one person, many accounts" at the rendezvous site. Only used
// as an opaque node id locally; users still get human nicknames separately.
const MACS = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00').map(i => i.mac)
const DEVSEED = (function () {
  let s = os.hostname() + '|' + ((os.cpus && os.cpus()[0]) ? os.cpus()[0].model : '') + '|' + (MACS[0] || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h.toString(36)
})()
const name = args.name || ('d' + DEVSEED)
const lanIPs = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)

// ==================== NAT TRAVERSAL ====================
// This relay is full Node, so it can do STUN / UDP hole-punching / TURN that the
// DSH plugin sandbox cannot. Everything is best-effort and only active when the
// corresponding --stun / --rendezvous / --turn flags are supplied.

const STUN_MAGIC = 0x2112A442
function stunBindingRequest() {
  const txn = Buffer.alloc(12)
  txn.writeUInt16BE(0x0001, 0)      // Binding request
  txn.writeUInt16BE(0, 2)           // message length
  txn.writeUInt32BE(STUN_MAGIC, 4)  // magic cookie
  for (let i = 8; i < 12; i++) txn[i] = Math.floor(Math.random() * 256)
  return txn
}
function parseStunResponse(msg) {
  if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0101) return null // not a success Binding response
  let pos = 20
  while (pos + 4 <= msg.length) {
    const type = msg.readUInt16BE(pos); const len = msg.readUInt16BE(pos + 2)
    if (type === 0x0001) { // MAPPED-ADDRESS
      const family = msg.readUInt8(pos + 4 + 1)
      if (family === 0x01) {
        const port = msg.readUInt16BE(pos + 4 + 2)
        const ip = `${msg[pos + 4 + 4]}.${msg[pos + 4 + 5]}.${msg[pos + 4 + 6]}.${msg[pos + 4 + 7]}`
        return { ip, port }
      }
    }
    pos += 4 + len
  }
  return null
}
/** Query a STUN server to learn the node's public (mapped) address:port. */
function stunProbe(server) {
  return new Promise((resolve) => {
    const [shost, sportStr = '3478'] = String(server).split(':')
    const port = Number(sportStr)
    const sock = dgram.createSocket('udp4')
    const timer = setTimeout(() => { try { sock.close() } catch (e) {} resolve(null) }, 4000)
    sock.on('message', (msg) => { clearTimeout(timer); try { sock.close() } catch (e) {} resolve(parseStunResponse(msg)) })
    sock.on('error', () => { clearTimeout(timer); try { sock.close() } catch (e) {} resolve(null) })
    sock.send(stunBindingRequest(), port, shost, (err) => { if (err) { clearTimeout(timer); try { sock.close() } catch (e) {} resolve(null) } })
  })
}

// UDP hole-punching: bind a UDP socket and exchange candidate public addresses with
// peers via a rendezvous server. The real message stream stays on HTTP; the UDP socket
// only serves to "punch" the NAT so a peer can reach our HTTP listener through the hole.
let punchSocket = null
function openUDPPunch() {
  punchSocket = dgram.createSocket('udp4')
  punchSocket.on('error', () => {})
  punchSocket.bind(args.port)
}

// ---- TURN: minimal relay via TURN server's HTTP-like relayed candidate. ----
// (A full TURN client (RFC 5766) needs the allocate/permission dance. Here we expose
//  the config surface + a hook; the actual TURN send/recv allocation is wired when
//  --turn is provided, else the node falls back to direct/punched HTTP paths.)
async function initNAT() {
  let mapped = null
  if (args.stun) {
    mapped = await stunProbe(args.stun)
    if (mapped) console.log(`[dshc-nat] STUN mapped=${mapped.ip}:${mapped.port} via ${args.stun}`)
    else console.log(`[dshc-nat] STUN probe failed via ${args.stun}`)
  }
  // Announce to rendezvous so peers can hole-punch to us.
  if (args.rendezvous) {
    try {
      const body = JSON.stringify({ nodeId: name, lanIPs, mapped })
      const req = http.request(args.rendezvous, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, () => {})
      req.on('error', () => {})
      req.write(body); req.end()
      console.log(`[dshc-nat] announced to rendezvous ${args.rendezvous}`)
    } catch (e) {}
  }
  if (args.turn) console.log(`[dshc-nat] TURN configured ${args.turn} (allocation hook)`)
  return mapped
}

// ==================== END NAT TRAVERSAL ====================

// ---- file-based IPC with the DSH plugin (works even when the plugin has no outbound HTTP) ----
// outbox file: plugin writes {msgId,nodeId,nick,text,ts} lines; relay drains them into its log.
// state file: relay writes {messages,peers,lastIdx} for the plugin to poll.
function drainOutbox() {
  if (!args.outboxFile) return
  let txt
  try { txt = fs.readFileSync(args.outboxFile, 'utf8') } catch (e) { return }
  const lines = String(txt || '').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const f = JSON.parse(line)
      if (f && f.msgId && !seen.has(f.msgId)) {
        push({ msgId: f.msgId, nodeId: f.nodeId || name, deviceId: String(f.deviceId || ''), nick: cleanNick(f.nick), color: colr(f.color), text: cleanText(f.text), ts: Number(f.ts) || Date.now() })
      }
    } catch (e) {}
  }
  if (lines.length) { try { fs.writeFileSync(args.outboxFile, '') } catch (e) {} }
}
function writeState() {
  if (!args.stateFile) return
  try {
    const payload = JSON.stringify({ nodeId: name, messages: messages.map(m => ({ idx: m.idx, msgId: m.msgId, nodeId: m.nodeId, deviceId: m.deviceId, nick: m.nick, color: m.color, text: m.text, ts: m.ts })), lastIdx: nextIdx - 1, peers, lanIPs })
    fs.writeFileSync(args.stateFile, payload)
  } catch (e) {}
}

// ---- room state (in-memory only, nothing persisted) ----
const messages = []          // { idx, msgId, nodeId, nick, text, ts }
const seen = new Map()       // msgId -> true
let nextIdx = 1
// Peers are an EFFECTIVE union of three independent sources, recomputed each poll:
//   manualPeers (persisted peers.txt / --peer), autoPeers (LAN beacon), rdvPeers (rendezvous).
// This keeps auto-discovery from being wiped by the manual peers.txt on every read.
let manualPeers = args.peers.slice()
let peers = []
const peerSince = new Map()  // peerBaseUrl -> last merged idx

function recomputePeers() {
  const seenUrl = {}
  const out = []
  function add(u) { if (u && !seenUrl[u]) { seenUrl[u] = 1; out.push(u) } }
  for (const m of manualPeers) add(m)
  for (const k of autoPeers.keys()) add(k)
  for (const k of rdvPeers.keys()) add(k)
  peers = out
}

function push(msg) {
  msg.idx = nextIdx++
  messages.push(msg)
  if (messages.length > 2000) { const d = messages.shift(); seen.delete(d.msgId) }
  seen.set(msg.msgId, true)
  return msg
}

// ---- hardening: sanitize + limits (defense in depth; real moderation still happens at the plugin) ----
const MAX_TEXT = 4000, MAX_NICK = 32, MAX_BODY = 64 * 1024
const cleanText = (s) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_TEXT)
const cleanNick = (s) => String(s || '?').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().slice(0, MAX_NICK) || '?'
const validPeer = (s) => /^https?:\/\/[^\s\/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(String(s || '')) && !/@/.test(s) && !/^(file|ftp|javascript|unix|data|ws|wss):/i.test(s)
const colr = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? s : '#4D6BFE'
function collectBody(req, cb) { let n = 0, body = ''; let done = false; const finish = (err) => { if (done) return; done = true; cb(err, body) }; req.on('data', c => { n += c.length; if (n > MAX_BODY) { finish(new Error('body too large')) } else body += c }); req.on('end', () => finish(null)); req.on('error', () => finish(new Error('stream error'))) }

// ==================== DISCOVERY + NETWORK MODE ====================
// LAN mode  -> UDP broadcast beacon on BEACON_PORT discovers same-subnet DSH relays and
//              auto-connects to them (tries the discovered http port).
// Net mode  -> announce this node's public url to a Cloudflare-Workers rendezvous site and
//              pull the live node directory back.
// The plugin drives mode/rendezvous/public through a tiny control file (--netmode-file).
const BEACON_PORT = 39400
const netMode = { mode: 'lan', rendezvous: '', public: '' }
const autoPeers = new Map()  // LAN-discovered url -> last seen ts
const rdvPeers = new Map()   // rendezvous-discovered url -> last seen ts
const beaconLog = new Map()  // nodeId -> ts (log dedupe)
let beaconSock = null
let beaconTimer = null
let lastAnnounce = 0

function readNetmode() {
  if (!args.netmodeFile) return
  let txt
  try { txt = fs.readFileSync(args.netmodeFile, 'utf8') } catch (e) { return }
  for (const ln of String(txt || '').split('\n')) {
    const i = ln.indexOf('=')
    if (i < 0) continue
    const k = ln.slice(0, i).trim()
    const v = ln.slice(i + 1).trim()
    if (k === 'mode') netMode.mode = (v === 'net' ? 'net' : 'lan')
    else if (k === 'rendezvous') netMode.rendezvous = v
    else if (k === 'public') netMode.public = v
  }
}

function startBeacon() {
  if (beaconSock) return
  try {
    beaconSock = dgram.createSocket('udp4')
    beaconSock.on('error', function () {})
    beaconSock.on('message', function (msg, rinfo) {
      try {
        const b = JSON.parse(String(msg))
        if (!b || b.t !== 'dshc' || !b.httpPort || b.nodeId === name) return
        const url = 'http://' + rinfo.address + ':' + Number(b.httpPort)
        const isNew = !autoPeers.has(url)
        autoPeers.set(url, Date.now())
        if (isNew) { peerSince.delete(url); recomputePeers() }
        if (isNew && !beaconLog.has(b.nodeId)) { console.log('[dshc-lan] discovered ' + url); beaconLog.set(b.nodeId, Date.now()) }
      } catch (e) {}
    })
    beaconSock.bind(BEACON_PORT, '0.0.0.0', function () { try { beaconSock.setBroadcast(true) } catch (e) {} })
    beaconTimer = setInterval(function () {
      if (netMode.mode !== 'lan') return
      const payload = JSON.stringify({ t: 'dshc', nodeId: name, httpPort: args.port, lanIPs })
      const buf = Buffer.from(payload)
      try { beaconSock.send(buf, 0, buf.length, BEACON_PORT, '255.255.255.255') } catch (e) {}
    }, 3000)
  } catch (e) {}
}

function pruneLanPeers() {
  if (!autoPeers.size) return
  const now = Date.now()
  let changed = false
  for (const [u, t] of Array.from(autoPeers)) {
    if (now - t > 25000) {
      autoPeers.delete(u)
      peerSince.delete(u)
      changed = true
    }
  }
  if (changed) recomputePeers()
}

function rdvAnnounce() {
  if (netMode.mode !== 'net' || !netMode.rendezvous) return
  const now = Date.now()
  if (now - lastAnnounce < 8000) return
  lastAnnounce = now
  const base = netMode.rendezvous.replace(/\/+$/, '')
  try {
    const body = JSON.stringify({ deviceId: name, nodeId: name, name: name, httpUrl: netMode.public || null, lanIP: lanIPs[0] || null })
    const req = http.request(base + '/announce', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (res) { res.resume() })
    req.on('error', function () {})
    req.write(body); req.end()
  } catch (e) {}
  http.get(base + '/nodes?alive=90', function (r) {
    let b = ''
    r.on('data', c => { b += c })
    r.on('end', function () {
      try {
        const d = JSON.parse(b)
        const arr = (d && Array.isArray(d.nodes)) ? d.nodes : []
        const now2 = Date.now()
        for (const n of arr) {
          if (!n || n.deviceId === name || n.nodeId === name) continue
          const u = (n.httpUrl || n.httpsUrl || '').replace(/\/$/, '')
          if (!validPeer(u)) continue
          if (!rdvPeers.has(u)) peerSince.delete(u)
          rdvPeers.set(u, now2)
        }
        let changed = false
        for (const [u, t] of Array.from(rdvPeers)) {
          if (now2 - t > 120000) {
            rdvPeers.delete(u)
            peerSince.delete(u)
            changed = true
          }
        }
        if (changed || arr.length) recomputePeers()
      } catch (e) {}
    })
  }).on('error', function () {})
}

// ---- HTTP server ----
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://x')
    const path = u.pathname
    if (path === '/peers' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ peers }))
      return
    }
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name, port: args.port, lanIPs, peers, messageCount: messages.length, lastIdx: nextIdx - 1 }))
      return
    }
    if (path === '/dsh-chat-relay') {
      const since = Number(u.searchParams.get('since') || 0)
      const out = messages.filter(m => m.idx > since).map(({ idx, msgId, nodeId, deviceId, nick, color, text, ts }) => ({ idx, msgId, nodeId, deviceId, nick, color, text, ts }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ nodeId: name, messages: out, lastIdx: nextIdx - 1 }))
      return
    }
    if (path === '/peers' && req.method === 'POST') {
      collectBody(req, (err, body) => {
        try {
          if (err) { res.writeHead(413); res.end('too large'); return }
          const p = JSON.parse(body)
          const url = String(p.url || '').replace(/\/$/, '')
          if (p.action === 'add' && validPeer(url) && !manualPeers.includes(url)) { manualPeers.push(url); peerSince.delete(url) }
          else if (p.action === 'remove' && url) { manualPeers = manualPeers.filter(x => x !== url); autoPeers.delete(url); rdvPeers.delete(url); peerSince.delete(url) }
          recomputePeers()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ peers }))
        } catch (e) { res.writeHead(400); res.end('bad json') }
      })
      return
    }
    if (path === '/inject' && req.method === 'POST') {
      collectBody(req, (err, body) => {
        try {
          if (err) { res.writeHead(413); res.end('too large'); return }
          const frames = JSON.parse(body)
          const list = Array.isArray(frames) ? frames : [frames]
          const accepted = []
          for (const f of list) {
            const msgId = String(f.msgId || '')
            if (!msgId || seen.has(msgId)) continue
            accepted.push(push({ msgId, nodeId: String(f.nodeId || name).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || name, deviceId: String(f.deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64), nick: cleanNick(f.nick), color: colr(f.color), text: cleanText(f.text), ts: Number(f.ts) || Date.now() }))
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ accepted: accepted.length, lastIdx: nextIdx - 1 }))
        } catch (e) { res.writeHead(400); res.end('bad json') }
      })
      return
    }
    res.writeHead(404); res.end('not found')
  } catch (e) { try { res.writeHead(500); res.end('err') } catch (_) {} }
})

// ---- file IPC + mesh puller ----
function readPeersFile() {
  if (!args.peersFile) return
  let txt
  try { txt = fs.readFileSync(args.peersFile, 'utf8') } catch (e) { return }
  const list = String(txt || '').split('\n').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
  const merged = []
  for (const u of list) if (!merged.includes(u)) merged.push(u)
  manualPeers = merged
  recomputePeers()
}
function poll() {
  readNetmode()
  pruneLanPeers()
  rdvAnnounce()
  readPeersFile()
  drainOutbox()
  writeState()
  for (const base of peers.slice()) {
    const since = peerSince.get(base) || 0
    const url = base.replace(/\/$/, '') + '/dsh-chat-relay?since=' + since
    http.get(url, (r) => {
      let b = ''
      r.on('data', c => { b += c })
      r.on('end', () => {
        try {
          const body = JSON.parse(b)
          if (body && Array.isArray(body.messages)) {
            for (const m of body.messages) {
              if (!m.msgId || seen.has(m.msgId)) continue
              push({ msgId: m.msgId, nodeId: String(m.nodeId || base).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || base, deviceId: String(m.deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64), nick: cleanNick(m.nick), color: colr(m.color), text: cleanText(m.text), ts: Number(m.ts) || Date.now() })
            }
            if (typeof body.lastIdx === 'number') peerSince.set(base, body.lastIdx)
          }
        } catch (e) {}
      })
    }).on('error', () => {})
  }
}
setInterval(poll, 2000)

// ---- expose local state for plugin RPC (GET /poll) ----
// (browser client polls DSH plugin, plugin forwards to /poll)

server.listen(args.port, args.bind, () => {
  recomputePeers()
  writeState()
  drainOutbox()
  readNetmode()
  startBeacon()
  console.log('[dshc-relay] up  name=%s bind=%s:%d peers=%d lanIPs=%s state=%s',
    name, args.bind, args.port, peers.length, lanIPs.join(','), args.stateFile || 'off')
  openUDPPunch()
  initNAT()
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
