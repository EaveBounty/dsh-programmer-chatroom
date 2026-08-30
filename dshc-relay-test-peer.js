#!/usr/bin/env node
/**
 * Test peer for the "Programmer P2P Chatroom" DSH plugin's raw-socket relay.
 *
 * The Host registers an upgrade route at  ws-dsh://<host>:<port>/dsh-chat-relay.
 * Because the Host half has no `crypto`/`ws`/`Buffer`, the relay speaks a
 * minimal newline-delimited JSON protocol over a raw upgraded TCP socket:
 *
 *   1. Connect TCP to the DSH web port.
 *   2. Send an HTTP upgrade request for /dsh-chat-relay.
 *   3. Receive HTTP/1.1 101 Switching Protocols.
 *   4. Exchange newline-delimited JSON frames (join / message / leave / push).
 *
 * Frames from peer -> relay:
 *   {"type":"join","peerId":"alice","nick":"Alice"}
 *   {"type":"message","text":"hello everyone"}
 *   {"type":"leave"}
 *
 * Frames relay -> peer:
 *   {"type":"welcome","peerId":"...","history":[...]}
 *   {"type":"message","message":{...}}
 *   {"type":"mod","entry":{...}}
 *
 * Usage:
 *   node dshc-relay-test-peer.js [nick] [text1] [text2] ...
 *   # if no text given, stays connected and prints incoming pushes for 5s.
 */
const net = require('net')

const HOST = process.env.DSHC_HOST || '127.0.0.1'
const PORT = Number(process.env.DSHC_PORT || 3080)

const nick = process.argv[2] || 'test-peer'
const peerId = 'test-' + Math.random().toString(36).slice(2, 8)
const messages = process.argv.slice(3).filter(Boolean)

const socket = net.connect(PORT, HOST, () => {
  socket.write([
    `GET /dsh-chat-relay HTTP/1.1`,
    `Host: ${HOST}:${PORT}`,
    `Connection: Upgrade`,
    `Upgrade: dshchat`,
    ``,
    ``
  ].join('\r\n'))
  // join
  socket.write(JSON.stringify({ type: 'join', peerId, nick }) + '\n')
  console.log(`[${nick}] connected to ${HOST}:${PORT}, joined as ${peerId}`)
  if (messages.length) {
    for (const m of messages) {
      socket.write(JSON.stringify({ type: 'message', text: m }) + '\n')
      console.log(`[${nick}] sent: ${m}`)
    }
    // stay a moment to observe push, then leave
    setTimeout(() => { socket.write(JSON.stringify({ type: 'leave' }) + '\n'); socket.end() }, 600)
  }
})

let inHttp = true
let buffer = ''
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  if (inHttp) {
    const sep = buffer.indexOf('\r\n\r\n')
    if (sep === -1) return
    const header = buffer.slice(0, sep)
    buffer = buffer.slice(sep + 4)
    inHttp = false
    if (!/101/.test(header)) {
      console.log('[relay] unexpected HTTP response:\n' + header)
      socket.destroy()
      return
    }
    console.log('[relay] upgrade accepted (101)')
    if (!messages.length) console.log('[relay] listening for pushes for 5s...')
  }
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).replace(/\r$/, '')
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      const frame = JSON.parse(line)
      if (frame.type === 'welcome') {
        console.log(`[relay] welcome peerId=${frame.peerId}, history=${Array.isArray(frame.history) ? frame.history.length : 0} msgs`)
      } else if (frame.type === 'message') {
        const m = frame.message || {}
        console.log(`[relay] msg #${m.seq} ${m.nick}: ${m.text}`)
      } else if (frame.type === 'mod') {
        const e = frame.entry || {}
        console.log(`[relay] MOD ${e.blocked ? 'BLOCKED' : 'flag'} #${e.id} ${e.nick}: ${e.text} -> ${(e.flags || []).map(f => f.category).join(',')}`)
      } else {
        console.log('[relay] frame:', JSON.stringify(frame))
      }
    } catch (e) {
      console.log('[relay] unparsed:', line)
    }
  }
})

socket.on('close', () => { console.log(`[${nick}] disconnected`) })
socket.on('error', (e) => { console.error(`[${nick}] error:`, e.message) })

if (!messages.length) setTimeout(() => { socket.destroy() }, 5000)
