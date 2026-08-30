// @eave_bounty/dsh-programmer-chatroom — web client (hand-validated bundle, no build step).
// Registers a 💬 chat overlay + sidebar action for the decentralized P2P chatroom.
// Talks to the host half over HTTP routes (/dsh-chat/*) that the host registers on the
// DSH webServer (the browser cannot call host.call from a shipped plugin).
const dshProgrammerChatroomFactory = (require) => {
  var module = { exports: {} }
  var exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const react = require('react')
  const { createElement, useEffect, useState } = react

  const NS = 'dsh-programmer-chatroom'
  const inject = ['slots', 'locale']

  const EMOJIS = ['😀','😄','😂','🤣','😊','😉','😍','😘','😜','🤪','😎','🥳','😭','😡','😱','🤔','🙄','😴','👍','👎','👌','🙏','👏','💪','🤝','❤️','💔','✨','🔥','💯','🎉','🚀','💡','✅','❌','🍺','☕','🎧','💻','🐛','🤖']
  const STICKERS = ['😂','🤣','😭','🥺','😤','🤗','😅','🤔','😮','🥳','😴','🤤','😡','👍','👏','💪','🙏','🔥','❤️','🎉','🚀','🐛','🤖','🧠','💾','🚨','⏰','🍕','☕','🎮','📦','🛠️','💻']
  const AVATAR_COLORS = ['#4D6BFE','#7C3AED','#0EA5E9','#10B981','#F59E0B','#EF4444','#EC4899','#14B8A6']
  const colorOf = (s) => { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + (s || '').charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }
  const avatarText = (n) => String(n || '?').slice(0, 1).toUpperCase()

  const css = `
:root{--dshc-brand:#4D6BFE;--dshc-brand2:#8B5CF6;--dshc-grad:linear-gradient(135deg,#4D6BFE,#8B5CF6);--dshc-bg:#0E1117;--dshc-panel:#161B24;--dshc-panel2:#1C2230;--dshc-border:#252D3D;--dshc-fg:#E6EAF2;--dshc-fg2:#9AA3B5;--dshc-bubble-other:#232B3B;--dshc-bubble-self:linear-gradient(135deg,#4D6BFE,#6D5BD0);}
.dshc-wrap{position:fixed;right:16px;bottom:16px;width:420px;max-width:calc(100vw - 32px);height:620px;max-height:calc(100vh - 32px);background:var(--dshc-panel);color:var(--dshc-fg);border:1px solid var(--dshc-border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;font-size:13.5px;overflow:hidden;z-index:999;pointer-events:auto;font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;}
.dshc-h{background:var(--dshc-grad);padding:12px 16px;display:flex;align-items:center;gap:10px;color:#fff;}
.dshc-title{flex:1;min-width:0;}.dshc-title b{display:block;font-size:15px;}.dshc-title span{font-size:11px;opacity:.9;}
.dshc-tabs{display:flex;gap:2px;background:rgba(0,0,0,.16);border-radius:9px;padding:2px;}
.dshc-tab{padding:4px 10px;border-radius:7px;cursor:pointer;font-size:12px;border:none;background:transparent;color:rgba(255,255,255,.8);}.dshc-tab.on{background:rgba(255,255,255,.2);color:#fff;font-weight:600;}
.dshc-close{background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;}
.dshc-body{flex:1;overflow-y:auto;padding:14px 12px;background:var(--dshc-bg);}
.dshc-relaybar{padding:7px 12px;background:rgba(77,107,254,.08);border-bottom:1px solid var(--dshc-border);font-size:12px;color:var(--dshc-fg2);}
.dshc-row{display:flex;align-items:flex-end;margin-bottom:14px;}.dshc-row.mine{flex-direction:row-reverse;}
.dshc-avatar{width:36px;height:36px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;}
.dshc-col{max-width:72%;margin:0 8px;display:flex;flex-direction:column;}
.dshc-nick{font-size:11px;color:var(--dshc-fg2);margin:0 2px 4px;}.dshc-row.mine .dshc-nick{text-align:right;}
.dshc-bubble{padding:9px 13px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}
.dshc-row.other .dshc-bubble{background:var(--dshc-bubble-other);border-top-left-radius:4px;}
.dshc-row.mine .dshc-bubble{background:var(--dshc-bubble-self);color:#fff;border-top-right-radius:4px;}
.dshc-sticker{font-size:46px;line-height:1;padding:6px;}
.dshc-status{color:#F59E0B;font-size:12px;padding:8px 16px 0;}
.dshc-foot{border-top:1px solid var(--dshc-border);padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dshc-panel2);}
.dshc-toolbar{display:flex;align-items:center;gap:2px;}
.dshc-tbtn{width:32px;height:32px;border-radius:8px;background:transparent;border:none;color:var(--dshc-fg2);font-size:19px;cursor:pointer;}.dshc-tbtn.on{background:rgba(77,107,254,.16);}
.dshc-inputrow{display:flex;gap:8px;align-items:center;}
.dshc-input{flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--dshc-border);background:var(--dshc-bg);color:var(--dshc-fg);outline:none;font-size:13.5px;}
.dshc-send{padding:9px 18px;border-radius:10px;border:none;background:var(--dshc-grad);color:#fff;cursor:pointer;font-weight:600;}
.dshc-picker{position:absolute;right:12px;bottom:128px;width:300px;max-height:240px;overflow-y:auto;background:var(--dshc-panel2);border:1px solid var(--dshc-border);border-radius:12px;padding:10px;box-shadow:0 12px 36px rgba(0,0,0,.5);display:grid;grid-template-columns:repeat(8,1fr);gap:2px;z-index:1000;}
.dshc-picker.stickers{grid-template-columns:repeat(6,1fr);}
.dshc-pe{font-size:22px;padding:5px;text-align:center;border-radius:8px;cursor:pointer;}.dshc-pe.st{font-size:34px;}
.dshc-mod{border-left:3px solid #F87171;padding:7px 10px;margin-bottom:8px;background:rgba(248,113,113,.08);border-radius:8px;}.dshc-mod b{color:#F87171;}.dshc-mod .reason{color:var(--dshc-fg2);font-size:12px;margin-top:2px;}
.dshc-peers{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.dshc-peer{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 4px;border-radius:20px;background:var(--dshc-panel2);border:1px solid var(--dshc-border);font-size:12px;}
.dshc-peeradd{display:flex;gap:6px;margin-top:8px;align-items:center;}.dshc-peeradd input{flex:1;padding:6px 10px;border-radius:8px;border:1px solid var(--dshc-border);background:var(--dshc-bg);color:var(--dshc-fg);outline:none;font-size:12px;}.dshc-peeradd button{padding:6px 12px;border-radius:8px;border:none;background:var(--dshc-brand);color:#fff;cursor:pointer;font-size:12px;}
.dshc-empty{color:var(--dshc-fg2);text-align:center;margin-top:40px;}.dshc-empty .big{font-size:44px;display:block;margin-bottom:8px;}
`

  function ChatPanel(props) {
    const { open, openSet, subscribe } = props
    const [state, setState] = useState({ msgs: [], modLog: [], peers: [], seq: 0, modId: 0, input: '', status: '', tab: 'chat', picker: null, peerInput: '', info: null, nick: '程序员' + Math.random().toString(36).slice(2, 5) })
    const [, force] = useState(0)
    const patch = (p) => setState((s) => ({ ...s, ...p }))

    // Re-render when the sidebar toggle flips the shared open flag.
    useEffect(() => subscribe(() => force((x) => x + 1)), [subscribe])

    useEffect(() => {
      if (!open) return
      const tick = setInterval(async () => {
        try {
          const r = await fetch('/dsh-chat/poll?afterSeq=' + state.seq + '&afterMod=' + state.modId)
          const d = await r.json()
          const upd = {}
          if (Array.isArray(d.messages)) upd.msgs = state.msgs.concat(d.messages)
          if (Array.isArray(d.modLog)) upd.modLog = state.modLog.concat(d.modLog)
          if (Array.isArray(d.peers)) upd.peers = d.peers
          if (typeof d.lastSeq === 'number') upd.seq = d.lastSeq
          if (typeof d.lastMod === 'number') upd.modId = d.lastMod
          patch(upd)
        } catch (e) {}
      }, 1500)
      fetch('/dsh-chat/info').then(r => r.json()).then(d => patch({ info: d })).catch(() => {})
      return () => clearInterval(tick)
    }, [open])

    const send = async () => {
      const text = state.input.trim(); if (!text) return
      try {
        const r = await fetch('/dsh-chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick: state.nick, text }) })
        const d = await r.json()
        patch({ input: '', picker: null, status: d.blocked ? ('内容被拦截: ' + ((d.flags && d.flags[0] && d.flags[0].reason) || '违规')) : '' })
      } catch (e) { patch({ status: '发送失败' }) }
    }
    const addPeer = () => { const url = state.peerInput.trim(); if (!url) return; fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers, peerInput: '' }) }).catch(() => {}) }
    const removePeer = (url) => fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers }) }).catch(() => {})

    if (!open) return null
    const msgs = state.msgs.map((m, i) => {
      const mine = m.nodeId === 'local'
      const isSticker = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(m.text) && m.text.length <= 4
      const bubble = isSticker ? createElement('div', { className: 'dshc-sticker' }, m.text) : createElement('div', { className: 'dshc-bubble' }, m.text)
      return createElement('div', { key: m.msgId || m.idx || i, className: 'dshc-row ' + (mine ? 'mine' : 'other') },
        createElement('div', { className: 'dshc-avatar', style: { background: colorOf(m.nodeId || m.nick) } }, avatarText(m.nick)),
        createElement('div', { className: 'dshc-col' }, createElement('div', { className: 'dshc-nick' }, mine ? '我' : (m.nick + ' · ' + m.nodeId)), bubble))
    })
    const mods = state.modLog.map((e, i) => createElement('div', { key: e.id || i, className: 'dshc-mod' }, createElement('b', null, e.blocked ? '⛔ 拦截' : '⚠️ 提示'), ' ', createElement('span', null, (e.nick || '?') + ': ' + e.text.slice(0, 80)), createElement('div', { className: 'reason' }, (e.flags || []).map((f) => f.category + ' · ' + (f.reason || '')).join('；'))))
    const peers = state.peers.map((p) => createElement('span', { key: p, className: 'dshc-peer' }, p.replace(/^https?:\/\//, ''), createElement('span', { style: { cursor: 'pointer', color: '#F87171' }, onClick: () => removePeer(p) }, ' ✕')))
    const picker = state.picker === 'emoji' ? createElement('div', { className: 'dshc-picker' }, EMOJIS.map((e, i) => createElement('span', { key: 'e' + i, className: 'dshc-pe', onClick: () => patch({ input: state.input + e }) }, e))) : (state.picker === 'sticker' ? createElement('div', { className: 'dshc-picker stickers' }, STICKERS.map((s, i) => createElement('span', { key: 's' + i, className: 'dshc-pe st', onClick: () => patch({ input: state.input + s }) }, s))) : null)
    const relayBar = createElement('div', { className: 'dshc-relaybar' }, state.info && state.info.relay ? ('🟢 伴生中继已启用 · 同局域网填 http://<本机IP>:' + state.info.relayPort) : '⚪ 伴生中继未启用（本机模式）')
    let body
    if (state.tab === 'chat') {
      body = msgs.length
        ? createElement('div', { className: 'dshc-body' }, [createElement('div', { className: 'dshc-relaybar', key: 'day' }, '去中心化 mesh · 每台机器都是服务器 · 记录仅存于在线机器内存')].concat(msgs, createElement('div', { key: 'pw', style: { marginTop: 10, borderTop: '1px solid var(--dshc-border)', paddingTop: 8 } }, createElement('div', { style: { color: 'var(--dshc-fg2)', fontSize: 12, marginBottom: 4 } }, '已连接中继节点'), createElement('div', { className: 'dshc-peers' }, peers.length ? peers : createElement('span', { style: { color: 'var(--dshc-fg2)', fontSize: 12 } }, '暂无')), createElement('div', { className: 'dshc-peeradd' }, createElement('input', { value: state.peerInput, placeholder: 'http://其它机器IP:3932x', onInput: (e) => patch({ peerInput: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') addPeer() } }), createElement('button', { onClick: addPeer }, '添加节点')))))
        : createElement('div', { className: 'dshc-body' }, createElement('div', { className: 'dshc-empty' }, createElement('span', { className: 'big' }, '👋'), '还没有消息'))
    } else {
      body = createElement('div', { className: 'dshc-body' }, mods.length ? mods : createElement('div', { className: 'dshc-empty' }, '暂无监控记录'))
    }
    return createElement('div', { className: 'dshc-wrap' },
      createElement('div', { className: 'dshc-h' },
        createElement('div', { className: 'dshc-title' }, createElement('b', null, 'DeepSeek 群聊'), createElement('span', null, state.peers.length + ' 台在线中继 · 去中心化 mesh')),
        createElement('div', { className: 'dshc-tabs' }, createElement('button', { className: 'dshc-tab' + (state.tab === 'chat' ? ' on' : ''), onClick: () => patch({ tab: 'chat', picker: null }) }, '聊天'), createElement('button', { className: 'dshc-tab' + (state.tab === 'mon' ? ' on' : ''), onClick: () => patch({ tab: 'mon', picker: null }) }, '监控')),
        createElement('button', { className: 'dshc-close', onClick: () => openSet(false) }, '✕')),
      relayBar,
      body,
      state.status ? createElement('div', { className: 'dshc-status' }, state.status) : null,
      picker,
      createElement('div', { className: 'dshc-foot' },
        createElement('div', { className: 'dshc-toolbar' }, createElement('button', { className: 'dshc-tbtn' + (state.picker === 'emoji' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'emoji' ? null : 'emoji' }) }, '😊'), createElement('button', { className: 'dshc-tbtn' + (state.picker === 'sticker' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'sticker' ? null : 'sticker' }) }, '🖼️'), createElement('button', { className: 'dshc-tbtn', onClick: () => patch({ input: state.input + ' ✨ Enjoy! ' }) }, '✨Enjoy')),
        createElement('div', { className: 'dshc-inputrow' }, createElement('input', { className: 'dshc-input', value: state.input, placeholder: '输入消息，Enter 发送', onInput: (e) => patch({ input: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') send() } }), createElement('button', { className: 'dshc-send', onClick: send }, '发送'))))
  }

  // Shared UI state between the sidebar toggle and the overlay panel. The two slots are
  // independent React roots, so they cannot share a single useState; a module-level store
  // with a tiny subscription lets the button flip the panel's open flag and the panel re-render.
  const ui = { open: false, listeners: new Set() }
  const uiSet = (open) => { ui.open = !!open; ui.listeners.forEach((fn) => fn()) }
  const uiSubscribe = (fn) => { ui.listeners.add(fn); return () => ui.listeners.delete(fn) }

  function ToggleButton() {
    const [, force] = useState(0)
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])
    return createElement('button', {
      onClick: () => uiSet(!ui.open),
      title: '群聊',
      style: { border: '1px solid var(--dshc-border,#333)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', background: ui.open ? 'linear-gradient(135deg,#4D6BFE,#8B5CF6)' : 'transparent', color: ui.open ? '#fff' : 'inherit' }
    }, ui.open ? '✕ 群聊' : '💬 群聊')
  }

  const apply = (ctx) => {
    if (!ctx.slots) return
    // `styles` is not a standard client service and is not declared in inject;
    // inject CSS via document instead (below).
    if (typeof document !== 'undefined') {
      try {
        const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el)
        ctx.effect(() => () => { try { document.head.removeChild(el) } catch (e) {} })
      } catch (e) {}
    }
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dshc-chat-panel', order: 100 }, () => createElement(ChatPanel, { open: ui.open, openSet: uiSet, subscribe: uiSubscribe })))
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dshc-chat-toggle', order: 50, label: () => '群聊' }, () => createElement(ToggleButton)))
  }

  exports.inject = inject
  exports.apply = apply
  return module.exports
}
if (typeof window !== 'undefined' && window.__ModuleLoader__) {
  window.__ModuleLoader__.load({ id: '@eave_bounty/dsh-programmer-chatroom', factory: dshProgrammerChatroomFactory })
  window.__ModuleLoader__.load({ id: 'dsh-programmer-chatroom', factory: dshProgrammerChatroomFactory })
}
