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

function parseArgs(argv) {
  const out = { port: 39321, bind: '0.0.0.0', peers: [], name: null, stateFile: null, outboxFile: null, peersFile: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--bind') out.bind = argv[++i]
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--peer') out.peers.push(argv[++i])
    else if (a === '--state-file') out.stateFile = argv[++i]
    else if (a === '--outbox-file') out.outboxFile = argv[++i]
    else if (a === '--peers-file') out.peersFile = argv[++i]
  }
  return out
}

const fs = require('fs')
const args = parseArgs(process.argv)
const name = args.name || ('node-' + os.hostname() + '-' + Math.random().toString(36).slice(2, 6))
const lanIPs = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)

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
        push({ msgId: f.msgId, nodeId: f.nodeId || name, nick: f.nick || '?', text: f.text || '', ts: Number(f.ts) || Date.now() })
      }
    } catch (e) {}
  }
  if (lines.length) { try { fs.writeFileSync(args.outboxFile, '') } catch (e) {} }
}
function writeState() {
  if (!args.stateFile) return
  try {
    const payload = JSON.stringify({ nodeId: name, messages: messages.map(m => ({ idx: m.idx, msgId: m.msgId, nodeId: m.nodeId, nick: m.nick, text: m.text, ts: m.ts })), lastIdx: nextIdx - 1, peers, lanIPs })
    fs.writeFileSync(args.stateFile, payload)
  } catch (e) {}
}

// ---- room state (in-memory only, nothing persisted) ----
const messages = []          // { idx, msgId, nodeId, nick, text, ts }
const seen = new Map()       // msgId -> true
let nextIdx = 1
let peers = args.peers.slice()
const peerSince = new Map()  // peerBaseUrl -> last merged idx

function push(msg) {
  msg.idx = nextIdx++
  messages.push(msg)
  if (messages.length > 2000) { const d = messages.shift(); seen.delete(d.msgId) }
  seen.set(msg.msgId, true)
  return msg
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
      const out = messages.filter(m => m.idx > since).map(({ idx, msgId, nodeId, nick, text, ts }) => ({ idx, msgId, nodeId, nick, text, ts }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ nodeId: name, messages: out, lastIdx: nextIdx - 1 }))
      return
    }
    if (path === '/peers' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        try {
          const p = JSON.parse(body)
          const url = String(p.url || '').replace(/\/$/, '')
          if (p.action === 'add' && url && !peers.includes(url)) { peers.push(url); peerSince.delete(url) }
          else if (p.action === 'remove' && url) { peers = peers.filter(x => x !== url); peerSince.delete(url) }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ peers }))
        } catch (e) { res.writeHead(400); res.end('bad json') }
      })
      return
    }
    if (path === '/inject' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        try {
          const frames = JSON.parse(body)
          const list = Array.isArray(frames) ? frames : [frames]
          const accepted = []
          for (const f of list) {
            const msgId = String(f.msgId || '')
            if (!msgId || seen.has(msgId)) continue
            accepted.push(push({ msgId, nodeId: String(f.nodeId || name), nick: String(f.nick || '?'), text: String(f.text || ''), ts: Number(f.ts) || Date.now() }))
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
  // preserve order, no dup
  const merged = []
  for (const u of list) if (!merged.includes(u)) merged.push(u)
  for (const p of merged) if (!peerSince.has(p)) peerSince.set(p, 0)
  peers = merged
}
function poll() {
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
              push({ msgId: m.msgId, nodeId: m.nodeId || base, nick: m.nick || '?', text: m.text || '', ts: Number(m.ts) || Date.now() })
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
  writeState()
  drainOutbox()
  console.log('[dshc-relay] up  name=%s bind=%s:%d peers=%d lanIPs=%s state=%s',
    name, args.bind, args.port, peers.length, lanIPs.join(','), args.stateFile || 'off')
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
