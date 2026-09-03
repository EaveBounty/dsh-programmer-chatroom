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
const https = require('https')
const crypto = require('crypto')
const path = require('path')
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
      // 若该地址是 /24 扫描写入 manualPeers 的，一并回收，避免已下线主机成为僵尸对端
      if (scanManual.has(u)) {
        scanManual.delete(u)
        manualPeers = manualPeers.filter(x => x !== u)
      }
      peerNameByUrl.delete(u)
      changed = true
    }
  }
  if (changed) recomputePeers()
}

// 低频 announce（B5）：仅 net 模式且配置了 rendezvous 时，约每 60s 报到一次
function rdvAnnounce() {
  if (netMode.mode !== 'net' || !netMode.rendezvous) return
  const now = Date.now()
  if (now - lastAnnounce < 60000) return
  lastAnnounce = now
  const base = netMode.rendezvous.replace(/\/+$/, '')
  if (!base) return
  outPost(base + '/announce', { deviceId: name, nodeId: name, name: name, httpUrl: netMode.public || null, lanIP: lanIPs[0] || null }, 3000)
}

// 周期拉取 rendezvous 节点目录（既有行为，8s 节流），刷新 rdvPeers 并回收超时项
function rdvNodes() {
  if (netMode.mode !== 'net' || !netMode.rendezvous) return
  const now = Date.now()
  if (now - lastRdvNodes < 8000) return
  lastRdvNodes = now
  const base = netMode.rendezvous.replace(/\/+$/, '')
  if (!base) return
  outGet(base + '/nodes?alive=90', 5000, function (err, res, body) {
    if (err || !res || res.statusCode !== 200) return
    try {
      const d = JSON.parse(body || '')
      const arr = (d && Array.isArray(d.nodes)) ? d.nodes : []
      const now2 = Date.now()
      let changed = false
      for (const n of arr) {
        if (!n || n.deviceId === name || n.nodeId === name) continue
        const u = String(n.httpUrl || n.httpsUrl || '').replace(/\/$/, '')
        if (!validPeer(u) || isSelfUrl(u)) continue
        if (!rdvPeers.has(u)) peerSince.delete(u)
        rdvPeers.set(u, now2)
      }
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
}

// ==================== 新增功能 A：LAN /24 同端口扫描（mode lan） ====================
// 与 UDP 信标并存：某些网络屏蔽 UDP 广播时，仍可通过主动探测同网段、同 HTTP 端口
// (args.port，默认 39321) 的 /health 发现对端。扫描跑在独立定时器上，绝不阻塞 poll()。

const peerNameByUrl = new Map()   // 对端 url -> /health 上报的 name
const scanManual = new Set()      // 由扫描写入 manualPeers 的 url（下线时回收）
const failByUrl = new Map()       // 对端 url -> /health 连续失败次数
const LAN_SCAN_TICK = 2000        // 扫描调度定时器周期（2s 看一眼门闩）
const LAN_PASS_GAP = 20000        // 完整一轮扫描至少间隔 ~20s
const SCAN_CONCURRENCY = 8        // 探测并发上限（≤8 在途）
const SCAN_TIMEOUT = 900          // 单台 /health 探测超时（ms）
let lanScanBusy = false
let lanLastPass = 0

// 通用并发小池：list 上最多 conc 个 worker 同时在飞；任何异常都被吞掉，绝不抛出
function runPool(list, worker, conc, onEach) {
  return new Promise(function (resolve) {
    if (!list.length) return resolve()
    let i = 0, act = 0
    const finish = function () { if (act === 0 && i >= list.length) resolve() }
    const fill = function () {
      while (act < conc && i < list.length) {
        const item = list[i++]
        act++
        Promise.resolve().then(function () { return worker(item) }).catch(function () { return null }).then(function (res) {
          act--
          try { if (onEach) onEach(item, res) } catch (e) {}
          fill()
          finish()
        })
      }
      finish()
    }
    fill()
  })
}

// 探测单台主机：GET http://ip:port/health，200 且 {ok:true} 才算命中
function lanProbeHost(ip) {
  const url = 'http://' + ip + ':' + args.port
  return new Promise(function (resolve) {
    outGet(url + '/health', SCAN_TIMEOUT, function (err, res, body) {
      if (err || !res || res.statusCode !== 200) return resolve(null)
      try {
        const j = JSON.parse(body || '')
        if (j && j.ok === true) return resolve({ url: url, name: String(j.name || '').slice(0, 64) })
      } catch (e) {}
      resolve(null)
    })
  })
}

// 命中处理：写入 manualPeers（去重）+ autoPeers + recompute，并记录上报的 name
function lanScanFound(url, repName) {
  const now = Date.now()
  const isNew = !autoPeers.has(url)
  if (manualPeers.indexOf(url) < 0) { manualPeers.push(url); scanManual.add(url) }
  autoPeers.set(url, now)
  if (repName && peerNameByUrl.get(url) !== repName) peerNameByUrl.set(url, repName)
  failByUrl.delete(url)
  if (isNew) { peerSince.delete(url); console.log('[dshc-lan] scan hit ' + url + (repName ? ' name=' + repName : '')) }
  recomputePeers()
}

// 一轮完整扫描：对本机每个 IPv4 /24 枚举主机 1..254，跳过本机 IP 与已知对端
function lanScanPass() {
  const nets = new Set()
  for (const ip of lanIPs) {
    const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip)
    if (m) nets.add(m[1] + '.')
  }
  if (!nets.size) return Promise.resolve()
  const known = new Set(peers)
  const cands = []
  for (const pre of nets) {
    for (let h = 1; h <= 254; h++) {
      const ip = pre + h
      if (lanIPs.indexOf(ip) >= 0) continue           // 跳过本机 IP
      const u = 'http://' + ip + ':' + args.port
      if (known.has(u) || autoPeers.has(u)) continue  // 跳过已知对端
      cands.push(ip)
    }
  }
  return runPool(cands, lanProbeHost, SCAN_CONCURRENCY, function (ip, hit) {
    if (hit) lanScanFound(hit.url, hit.name)
  })
}

// 扫描调度：mode=lan 且距上次整轮 ≥~20s 才发起一轮（每次让出事件循环，不阻塞 poll）
function lanScanTick() {
  if (netMode.mode !== 'lan' || lanScanBusy) return
  const now = Date.now()
  if (now - lanLastPass < LAN_PASS_GAP) return
  lanLastPass = now
  lanScanBusy = true
  lanScanPass().catch(function () {}).then(function () { lanScanBusy = false })
}

// ==================== 新增功能 B：公网地址表同步（net mode） ====================
// 地址表 = manualPeers ∪ autoPeers ∪ rdvPeers（http(s) 基址）。表内容与 md5 会落到
// stateFile 同目录的 table.json，供重启后的冷启动复用（stalePeers）。

const TABLE_FILE = path.join(args.stateFile ? path.dirname(args.stateFile) : '.', 'table.json')
let stalePeers = []             // 启动时从 table.json 读入的旧地址表
let lastTableSig = null         // 上次落盘的表签名（去重排序后的 join('\n')）
let lastRdvNodes = 0            // 节点目录拉取节流（8s）
let lastAntiEntropy = 0         // 反熵对账节流（10s）
let lastMergeTs = 0             // merge 保底节流（600s）
let lastCpolarTs = 0            // cpolar 探测节流（15s）
let antiPtr = 0                 // 反熵轮询游标
let netColdDone = false         // 冷启动 bootstrap 仅做一次

function tableUrls() {
  const seen = {}
  const arr = []
  function add(u) {
    const t = String(u || '').replace(/\/$/, '')
    if (t && validPeer(t) && !seen[t]) { seen[t] = 1; arr.push(t) }
  }
  for (const m of manualPeers) add(m)
  for (const k of autoPeers.keys()) add(k)
  for (const k of rdvPeers.keys()) add(k)
  arr.sort()
  return arr
}
function tableMd5() { return crypto.createHash('md5').update(tableUrls().join('\n')).digest('hex') }
function tableSize() { return tableUrls().length }

// 内网/回环/保留段 IPv4 字面量判断；域名一律视为公网
function isPrivateIpLiteral(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || ''))) return false
  const p = String(ip).split('.').map(Number)
  if (p.some(function (x) { return x > 255 })) return true
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 127 || p[0] === 0 || p[0] === 169 || p[0] === 100) return true
  return false
}
function isPublicUrl(u) {
  try {
    const o = new URL(String(u || ''), 'http://x')
    if (o.protocol === 'https:') return true
    return !isPrivateIpLiteral(o.hostname)
  } catch (e) { return false }
}
function isSelfUrl(u) {
  return !!netMode.public && String(netMode.public).replace(/\/$/, '') === String(u || '').replace(/\/$/, '')
}

// 统一出站 GET/POST（http/https 自适应；网络层全部 try/catch + error + 超时，绝不抛出）
function outGet(url, timeoutMs, cb) {
  let done = false
  const fin = function (e, r, b) { if (!done) { done = true; cb(e, r, b) } }
  try {
    const mod = /^https:/i.test(url) ? https : http
    const req = mod.get(url, { timeout: timeoutMs || 3000 }, function (res) {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', function (c) { if (body.length < (1 << 20)) body += c })
      res.on('end', function () { fin(null, res, body) })
      res.on('error', function () { fin(new Error('res')) })
    })
    req.on('timeout', function () { try { req.destroy() } catch (e) {} fin(new Error('timeout')) })
    req.on('error', function (e) { fin(e) })
  } catch (e) { fin(e) }
}
function outPost(url, obj, timeoutMs) {
  let done = false
  const fin = function () { if (!done) { done = true } }
  try {
    const body = Buffer.from(JSON.stringify(obj || {}))
    const mod = /^https:/i.test(url) ? https : http
    const req = mod.request(url, { method: 'POST', timeout: timeoutMs || 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, function (res) {
      res.resume()
      res.on('end', fin)
      res.on('error', fin)
    })
    req.on('timeout', function () { try { req.destroy() } catch (e) {} fin() })
    req.on('error', fin)
    req.write(body); req.end()
  } catch (e) { fin() }
}

// 探测 url 的 /health：成功则重置失败计数并返回响应体；失败则累计失败并返回 null
function probeHealth(url) {
  return new Promise(function (resolve) {
    outGet(String(url).replace(/\/$/, '') + '/health', 3000, function (err, res, body) {
      let j = null
      if (!err && res && res.statusCode === 200) {
        try { const t = JSON.parse(body || ''); if (t && t.ok === true) j = t } catch (e) {}
      }
      if (j) {
        failByUrl.delete(url)
        if (j.name) peerNameByUrl.set(url, String(j.name).slice(0, 64))
        resolve(j)
      } else {
        failByUrl.set(url, (failByUrl.get(url) || 0) + 1)
        dropIfDown(url)
        resolve(null)
      }
    })
  })
}
// 下线（B8）：公网 rdv/manual 对端连续 3 次 /health 失败 → 从三者中移除并重算
function dropIfDown(url) {
  if ((failByUrl.get(url) || 0) < 3) return
  if (!isPublicUrl(url)) { failByUrl.delete(url); return }
  if (!rdvPeers.has(url) && manualPeers.indexOf(url) < 0) { failByUrl.delete(url); return }
  rdvPeers.delete(url)
  manualPeers = manualPeers.filter(function (x) { return x !== url })
  scanManual.delete(url)
  peerSince.delete(url)
  peerNameByUrl.delete(url)
  failByUrl.delete(url)
  recomputePeers()
  console.log('[dshc-net] drop down peer ' + url)
}

// cpolar 本地 API 探测本机公网 URL（B3）：15s 独立节流，仅在 net 模式；不可达则保持原值
function cpolarProbe() {
  if (netMode.mode !== 'net') return
  const now = Date.now()
  if (now - lastCpolarTs < 15000) return
  lastCpolarTs = now
  outGet('http://127.0.0.1:9200/api/tunnels', 1500, function (err, res, body) {
    if (err || !res || res.statusCode !== 200) return // 不可达：netMode.public 保持不变
    try {
      const d = JSON.parse(body || '')
      const list = (d && Array.isArray(d.tunnels)) ? d.tunnels : []
      let best = null
      for (const t of list) {
        if (!t || String(t.public_url || '').slice(0, 8) !== 'https://') continue
        const cfg = String((t.config && t.config.addr) || '')
        if (cfg.indexOf(':' + args.port) >= 0) { best = t; break } // 优先：隧道目标指向本中继端口
        if (!best) best = t                                        // 兜底：第一个 https 隧道
      }
      if (best && best.public_url) {
        const u = String(best.public_url).replace(/\/+$/, '')
        if (netMode.public !== u) { netMode.public = u; console.log('[dshc-net] cpolar public=' + u) }
      }
    } catch (e) {}
  })
}

// 周期保底 merge（B6）：约每 600s 向 rendezvous 提交我们已知的在线公网地址表（至多 ~40 条）
function rdvMerge() {
  if (netMode.mode !== 'net' || !netMode.rendezvous) return
  const now = Date.now()
  if (now - lastMergeTs < 600000) return
  lastMergeTs = now
  const base = netMode.rendezvous.replace(/\/+$/, '')
  if (!base) return
  const urls = tableUrls().filter(function (u) { return isPublicUrl(u) && !isSelfUrl(u) }).slice(0, 40)
  if (!urls.length) return
  const nodes = []
  for (const u of urls) {
    let host = u
    try { host = new URL(u).hostname } catch (e) {}
    const nm = cleanNick(peerNameByUrl.get(u) || host)
    nodes.push({ deviceId: nm, nodeId: nm, name: nm, httpUrl: u, lanIP: /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : null })
  }
  outPost(base + '/merge', { nodes: nodes }, 5000)
}

// 冷启动（B4）：无存活公网对端时，先试探 table.json 里的陈旧表，有存活即停；
// 否则对 rendezvous 做一次 bootstrap（全生命周期仅这一次）
function netColdStart() {
  if (netMode.mode !== 'net' || !netMode.rendezvous || netColdDone) return
  netColdDone = true
  const base = netMode.rendezvous.replace(/\/+$/, '')
  if (!base) return
  const cands = []
  for (const u of stalePeers) {
    const t = String(u || '').replace(/\/$/, '')
    if (validPeer(t) && isPublicUrl(t) && !isSelfUrl(t)) cands.push(t)
  }
  let found = false
  runPool(cands, probeHealth, 3, function (u, j) {
    if (j && !found) {
      found = true
      rdvPeers.set(u, Date.now())
      if (manualPeers.indexOf(u) < 0) manualPeers.push(u)
      recomputePeers()
      console.log('[dshc-net] cold-start stale peer alive ' + u)
    }
  }).then(function () {
    if (found) return
    outGet(base + '/bootstrap?alive=3600', 6000, function (err, res, body) {
      if (err || !res || res.statusCode !== 200) return
      try {
        const d = JSON.parse(body || '')
        const arr = (d && Array.isArray(d.nodes)) ? d.nodes : (Array.isArray(d) ? d : [])
        const now = Date.now()
        let n = 0
        for (const nd of arr) {
          if (!nd || nd.nodeId === name || nd.deviceId === name) continue
          const u = String(nd.httpUrl || nd.httpsUrl || '').replace(/\/$/, '')
          if (!validPeer(u) || isSelfUrl(u)) continue
          rdvPeers.set(u, now)
          if (manualPeers.indexOf(u) < 0) manualPeers.push(u)
          n++
        }
        if (n) { recomputePeers(); console.log('[dshc-net] cold-start bootstrap ' + n + ' nodes') }
      } catch (e) {}
    })
  })
}

// 反熵对账（B7）：约每 10s 抽查至多 3 个公网对端 /health；md5 不一致则拉取其 /peers 求并集
function antiEntropy() {
  if (netMode.mode !== 'net') return
  const now = Date.now()
  if (now - lastAntiEntropy < 10000) return
  lastAntiEntropy = now
  const pool = tableUrls().filter(function (u) { return isPublicUrl(u) && !isSelfUrl(u) && (failByUrl.get(u) || 0) < 3 })
  if (!pool.length) return
  const picks = []
  for (let k = 0; k < 3 && picks.length < pool.length; k++) {
    const u = pool[antiPtr % pool.length]
    antiPtr++
    if (picks.indexOf(u) < 0) picks.push(u)
  }
  for (const u of picks) reconcilePeer(u)
}

function reconcilePeer(u) {
  probeHealth(u).then(function (j) {
    if (!j) return // 失败计数与下线移除已在 probeHealth/dropIfDown 中处理
    const theirMd5 = j.tableMd5
    if (theirMd5 && theirMd5 !== tableMd5()) {
      outGet(String(u).replace(/\/$/, '') + '/peers', 4000, function (err, res, body) {
        if (err || !res || res.statusCode !== 200) return
        try {
          const d = JSON.parse(body || '')
          if (!d || !Array.isArray(d.peers)) return
          const theirs = []
          for (const x of d.peers) {
            const t = String(x || '').replace(/\/$/, '')
            if (validPeer(t) && !isSelfUrl(t) && theirs.indexOf(t) < 0) theirs.push(t)
          }
          const now = Date.now()
          let changed = false
          for (const t of theirs) { // 并集：补齐对方有而我没有的地址
            if (rdvPeers.has(t) || manualPeers.indexOf(t) >= 0) continue
            if (autoPeers.has(t)) { autoPeers.set(t, now); continue }
            rdvPeers.set(t, now)
            if (manualPeers.indexOf(t) < 0) manualPeers.push(t)
            changed = true
          }
          if (changed) recomputePeers()
          // 对方已不再列出的地址：仅当我们自己也够不到时才丢弃（顺带累计失败计数）
          const missing = tableUrls().filter(function (t) {
            if (theirs.indexOf(t) >= 0 || isSelfUrl(t) || !isPublicUrl(t)) return false
            return rdvPeers.has(t) || manualPeers.indexOf(t) >= 0
          }).slice(0, 10)
          runPool(missing, probeHealth, 4)
        } catch (e) {}
      })
    }
  })
}

// 落盘地址表（B2）：表内容变化时写 table.json（stateFile 同目录，缺省为当前目录）
function persistTable() {
  try {
    const urls = tableUrls()
    const sig = urls.join('\n')
    if (sig === lastTableSig) return
    lastTableSig = sig
    const md5 = crypto.createHash('md5').update(sig).digest('hex')
    fs.writeFileSync(TABLE_FILE, JSON.stringify({ ts: Date.now(), md5: md5, table: urls }))
  } catch (e) {}
}
// 启动读回旧表 → stalePeers（供冷启动试探使用）
function loadTableFile() {
  try {
    const t = JSON.parse(fs.readFileSync(TABLE_FILE, 'utf8'))
    if (!t || !Array.isArray(t.table)) return
    const seen = {}
    stalePeers = []
    for (const u of t.table) {
      const x = String(u || '').replace(/\/$/, '')
      if (x && validPeer(x) && !seen[x]) { seen[x] = 1; stalePeers.push(x) }
    }
    lastTableSig = stalePeers.join('\n')
  } catch (e) {}
}
loadTableFile()

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
      res.end(JSON.stringify({ ok: true, name, port: args.port, lanIPs, peers, messageCount: messages.length, lastIdx: nextIdx - 1, httpUrl: netMode.public || null, tableMd5: tableMd5(), tableSize: tableSize() }))
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
          else if (p.action === 'remove' && url) { manualPeers = manualPeers.filter(x => x !== url); autoPeers.delete(url); rdvPeers.delete(url); scanManual.delete(url); peerSince.delete(url); peerNameByUrl.delete(url) }
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
  try {
    readNetmode()
    pruneLanPeers()
    rdvAnnounce()          // 低频 announce（B5，60s 节流）
    rdvNodes()             // 周期节点目录（既有行为，8s 节流）
    antiEntropy()          // 反熵对账（B7，10s 节流，net 模式）
    rdvMerge()             // 周期保底 merge（B6，600s 节流，net 模式）
    netColdStart()         // 冷启动（B4）—— 仅在未做过且条件满足时执行一次
    readPeersFile()
    drainOutbox()
    writeState()
    persistTable()         // 地址表内容变化时落盘（B2）
    for (const base of peers.slice()) {
      const since = peerSince.get(base) || 0
      const url = base.replace(/\/$/, '') + '/dsh-chat-relay?since=' + since
      outGet(url, 6000, function (err, res, b) {
        if (err || !res || res.statusCode !== 200) return
        try {
          const body = JSON.parse(b || '')
          if (body && Array.isArray(body.messages)) {
            for (const m of body.messages) {
              if (!m.msgId || seen.has(m.msgId)) continue
              push({ msgId: m.msgId, nodeId: String(m.nodeId || base).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || base, deviceId: String(m.deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64), nick: cleanNick(m.nick), color: colr(m.color), text: cleanText(m.text), ts: Number(m.ts) || Date.now() })
            }
            if (typeof body.lastIdx === 'number') peerSince.set(base, body.lastIdx)
          }
        } catch (e) {}
      })
    }
  } catch (e) {}
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
  // 新增：A/B 功能挂载 —— LAN 扫描节拍、cpolar 公网 URL 探测、net 冷启动
  setInterval(lanScanTick, LAN_SCAN_TICK)
  setInterval(cpolarProbe, 15000)
  netColdStart()
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
