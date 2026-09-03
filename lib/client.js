// @eave_bounty/dsh-programmer-chatroom — web client (hand-validated bundle, no build step).
//
// Force DeepSeek-style BLUE-WHITE (light) theme so the chat always reads as a clean light panel.
// The Chat view shows ONLY messages (no node/peer chatter that distracts the conversation).
// Settings tab lets the user pick a network mode (LAN / Internet rendezvous), adjust font size,
// bubble spacing & letter spacing, and edit profile. Node management lives in Settings, not Chat.
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
  const AVATAR_COLORS = ['#4D6BFE','#7C3AED','#0EA5E9','#10B981','#F59E0B','#EF4444','#EC4899','#14B8A6','#8B5CF6','#3B82F6','#F97316','#06B6D4']
  const NICK_POOL = ['星野','墨客','流云','山鬼','竹马','青崖','孤舟','拾光','小满','白泽','阿远','拾遗','青梧','望舒','弄月','听雨','观澜','逐风','听雪','青禾','未名','知白']
  const avatarText = (n) => String(n || '?').slice(0, 1).toUpperCase()

  // --- per-machine identity (localStorage; network side only sees nick/color) ---
  const ID_KEY = 'dshc.identity'
  function loadMe() { try { const raw = localStorage.getItem(ID_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.deviceId) return o } } catch (e) {} return null }
  function saveMe(m) { try { localStorage.setItem(ID_KEY, JSON.stringify(m)) } catch (e) {} }
  function genDeviceId() { return 'dev-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36) }
  function randColor() { return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] }
  function randNick() { return NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + Math.floor(Math.random() * 90 + 10) }

  // --- display preferences (font size / bubble spacing / letter spacing) ---
  const DISPLAY_KEY = 'dshc.display'
  const DEFAULT_DISPLAY = { fontSize: 13.5, bubbleGap: 14, letterSpacing: 0 }
  function loadDisplay() { try { const raw = localStorage.getItem(DISPLAY_KEY); if (raw) { const o = JSON.parse(raw); return { fontSize: Number(o.fontSize) || DEFAULT_DISPLAY.fontSize, bubbleGap: Number(o.bubbleGap) || DEFAULT_DISPLAY.bubbleGap, letterSpacing: (typeof o.letterSpacing === 'number') ? o.letterSpacing : 0 } } } catch (e) {} return DEFAULT_DISPLAY }
  function saveDisplay(d) { try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(d)) } catch (e) {} }

  // Blue-white (light) DeepSeek palette — intentionally fixed (not following shell theme).
  const css = `
:root{
  --dshc-brand:#4D6BFE; --dshc-brand2:#6D5BD0;
  --dshc-grad:linear-gradient(135deg,#4D6BFE,#6D5BD0);
  --dshc-bg:#F7F9FD; --dshc-panel:#FFFFFF; --dshc-panel2:#F1F5FB;
  --dshc-border:#E2E8F4; --dshc-fg:#1E2A44; --dshc-fg2:#64748B;
  --dshc-bubble-other:#EFF3FC;
  --dshc-bubble-self:linear-gradient(135deg,#4D6BFE,#6D5BD0);
  --dshc-err:#EF4444; --dshc-ok:#16A34A; --dshc-warn:#D97706;
  --dshc-fs:13.5px; --dshc-bgap:14px; --dshc-ls:0px;
}
.dshc-wrap{position:fixed;right:16px;bottom:16px;width:440px;max-width:calc(100vw - 32px);height:650px;max-height:calc(100vh - 32px);background:var(--dshc-panel);color:var(--dshc-fg);border:1px solid var(--dshc-border);border-radius:16px;box-shadow:0 18px 50px rgba(31,42,68,.20);display:flex;flex-direction:column;overflow:hidden;z-index:999;pointer-events:auto;font-size:var(--dshc-fs,13.5px);font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;}
.dshc-h{background:var(--dshc-grad);padding:12px 14px;display:flex;align-items:center;gap:10px;color:#fff;flex:none;}
.dshc-title{flex:1;min-width:0;}.dshc-title b{display:block;font-size:15px;}.dshc-title .chip{display:inline-block;font-size:10.5px;margin-top:3px;padding:1px 7px;border-radius:20px;background:rgba(255,255,255,.22);}
.dshc-tabs{display:flex;gap:2px;background:rgba(0,0,0,.14);border-radius:9px;padding:2px;}
.dshc-tab{padding:4px 11px;border-radius:7px;cursor:pointer;font-size:12px;border:none;background:transparent;color:rgba(255,255,255,.9);}.dshc-tab.on{background:rgba(255,255,255,.24);color:#fff;font-weight:600;}
.dshc-close{background:transparent;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;width:28px;height:28px;border-radius:8px;}.dshc-close:hover{background:rgba(255,255,255,.2);}
.dshc-body{flex:1;overflow-y:auto;padding:16px 14px;background:var(--dshc-bg);}
.dshc-row{display:flex;align-items:flex-end;margin-bottom:var(--dshc-bgap,14px);}.dshc-row.mine{flex-direction:row-reverse;}
.dshc-avatar{width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;}
.dshc-col{max-width:74%;margin:0 8px;display:flex;flex-direction:column;}
.dshc-nick{font-size:11px;color:var(--dshc-fg2);margin:0 2px 3px;}.dshc-row.mine .dshc-nick{text-align:right;}
.dshc-bubble{padding:8px 13px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;letter-spacing:var(--dshc-ls,0px);}
.dshc-row.other .dshc-bubble{background:var(--dshc-bubble-other);border-top-left-radius:4px;}
.dshc-row.mine .dshc-bubble{background:var(--dshc-bubble-self);color:#fff;border-top-right-radius:4px;}
.dshc-sticker{font-size:46px;line-height:1;padding:4px;}
.dshc-status{color:var(--dshc-warn);font-size:12px;padding:6px 16px 0;}
.dshc-foot{border-top:1px solid var(--dshc-border);padding:9px 12px;display:flex;flex-direction:column;gap:7px;background:var(--dshc-panel);flex:none;}
.dshc-toolbar{display:flex;align-items:center;gap:2px;}
.dshc-tbtn{width:32px;height:32px;border-radius:8px;background:transparent;border:none;color:var(--dshc-fg2);font-size:19px;cursor:pointer;}.dshc-tbtn.on{background:rgba(77,107,254,.14);}
.dshc-inputrow{display:flex;gap:8px;align-items:center;}
.dshc-input{flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--dshc-border);background:var(--dshc-panel);color:var(--dshc-fg);outline:none;font-size:var(--dshc-fs,13.5px);}
.dshc-send{padding:9px 18px;border-radius:10px;border:none;background:var(--dshc-grad);color:#fff;cursor:pointer;font-weight:600;}
.dshc-picker{position:absolute;right:12px;bottom:120px;width:300px;max-height:240px;overflow-y:auto;background:#fff;border:1px solid var(--dshc-border);border-radius:12px;padding:10px;box-shadow:0 12px 36px rgba(31,42,68,.2);display:grid;grid-template-columns:repeat(8,1fr);gap:2px;z-index:1000;}
.dshc-picker.stickers{grid-template-columns:repeat(6,1fr);}
.dshc-pe{font-size:22px;padding:5px;text-align:center;border-radius:8px;cursor:pointer;}.dshc-pe.st{font-size:34px;}
.dshc-empty{color:var(--dshc-fg2);text-align:center;margin-top:44px;}.dshc-empty .big{font-size:44px;display:block;margin-bottom:8px;}
.dshc-members{display:flex;flex-direction:column;gap:8px;}
.dshc-member{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#fff;border:1px solid var(--dshc-border);}
.dshc-member .mname{flex:1;font-size:13px;}
.dshc-member .mtag{font-size:11px;color:var(--dshc-fg2);}
/* settings */
.dshc-settings{display:flex;flex-direction:column;gap:12px;}
.dshc-card{background:#fff;border:1px solid var(--dshc-border);border-radius:12px;padding:12px;}
.dshc-card h4{margin:0 0 10px;font-size:13px;color:var(--dshc-fg);}
.dshc-me{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
.dshc-srow{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.dshc-srow label{font-size:12px;color:var(--dshc-fg2);width:62px;flex:none;}
.dshc-srow input[type=text]{flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--dshc-border);background:#fff;color:var(--dshc-fg);outline:none;font-size:13px;}
.dshc-swatches{display:flex;flex-wrap:wrap;gap:8px;}
.dshc-swatch{width:26px;height:26px;border-radius:8px;cursor:pointer;border:2px solid transparent;}.dshc-swatch.on{border-color:var(--dshc-fg);}
.dshc-slider{flex:1;display:flex;align-items:center;gap:8px;}
.dshc-slider input[type=range]{flex:1;}
.dshc-slider .val{font-size:12px;color:var(--dshc-fg2);width:52px;text-align:right;}
.dshc-save{padding:8px 18px;border-radius:9px;border:none;background:var(--dshc-grad);color:#fff;cursor:pointer;font-weight:600;font-size:13px;}
.dshc-seg{display:flex;gap:6px;margin-bottom:10px;}
.dshc-seg button{flex:1;padding:8px 0;border-radius:9px;border:1px solid var(--dshc-border);background:#fff;color:var(--dshc-fg2);cursor:pointer;font-size:13px;font-weight:600;}
.dshc-seg button.on{background:var(--dshc-grad);color:#fff;border-color:transparent;}
.dshc-cmd{display:flex;align-items:center;gap:8px;}
.dshc-cmd code{flex:1;padding:7px 10px;border-radius:8px;background:var(--dshc-bg);border:1px solid var(--dshc-border);font-size:11px;color:var(--dshc-fg);word-break:break-all;}
.dshc-copy{padding:6px 12px;border-radius:8px;border:none;background:var(--dshc-brand);color:#fff;cursor:pointer;font-size:12px;flex:none;}
.dshc-tunnelbtn{padding:8px 16px;border-radius:9px;border:none;cursor:pointer;font-weight:600;font-size:13px;}
.dshc-tunnelbtn.on{background:var(--dshc-err);color:#fff;}
.dshc-tunnelbtn.off{background:var(--dshc-grad);color:#fff;}
.dshc-hint{font-size:11.5px;color:var(--dshc-fg2);line-height:1.6;margin-top:6px;}
.dshc-urllink{color:var(--dshc-brand);word-break:break-all;}
.dshc-nodes{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;}
.dshc-node{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:20px;background:var(--dshc-bg);border:1px solid var(--dshc-border);font-size:11.5px;}
`

  function ChatPanel() {
    const [state, setState] = useState({
      msgs: [], peers: [], seq: 0, members: [], input: '', status: '', tab: 'chat', picker: null,
      peerInput: '', info: null, tunnel: null, tunnelBusy: false, display: loadDisplay(),
      mode: 'lan', rendezvous: '', meReady: false, nick: '', color: '', deviceId: ''
    })
    const [open, setOpen] = useState(ui.open)
    const [, force] = useState(0)
    const patch = (p) => setState((s) => ({ ...s, ...p }))
    const me = state.meReady ? { deviceId: state.deviceId, nick: state.nick, color: state.color } : (loadMe() || {})

    useEffect(() => uiSubscribe(() => setOpen(ui.open)), [])
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])

    // Identity: ensure a deviceId, register with host for unique nick/color, read network mode.
    useEffect(() => {
      if (!open) return
      let me2 = loadMe()
      if (!me2) { me2 = { deviceId: genDeviceId(), nick: randNick(), color: randColor() }; saveMe(me2) }
      patch({ deviceId: me2.deviceId, nick: me2.nick, color: me2.color, meReady: true })
      const d = me2.deviceId
      fetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: d, nick: me2.nick, color: me2.color }) })
        .then(r => r.json()).then(r => { if (r && r.nick) { saveMe({ deviceId: d, nick: r.nick, color: r.color }); patch({ nick: r.nick, color: r.color }) } }).catch(() => {})
      fetch('/dsh-chat/net').then(r => r.json()).then(d2 => { if (d2) patch({ mode: d2.mode === 'net' ? 'net' : 'lan', rendezvous: d2.rendezvous || '' }) }).catch(() => {})
    }, [open])

    // Polling + periodic status refresh.
    useEffect(() => {
      if (!open) return
      const tick = setInterval(async () => {
        try {
          const r = await fetch('/dsh-chat/poll?afterSeq=' + state.seq)
          const d = await r.json()
          const upd = {}
          if (Array.isArray(d.messages)) { const mm = state.msgs.concat(d.messages); upd.msgs = mm.length > 600 ? mm.slice(mm.length - 600) : mm }
          if (Array.isArray(d.peers)) upd.peers = d.peers
          if (typeof d.lastSeq === 'number') upd.seq = d.lastSeq
          if (Array.isArray(d.members)) upd.members = d.members
          patch(upd)
        } catch (e) {}
      }, 1500)
      const t2 = setInterval(() => { fetch('/dsh-chat/tunnel').then(r => r.json()).then(d => patch({ tunnel: d })).catch(() => {}) }, 3000)
      return () => { clearInterval(tick); clearInterval(t2) }
    }, [open])

    const send = async () => {
      const text = state.input.trim(); if (!text) return
      try {
        await fetch('/dsh-chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: me.deviceId || 'local', nick: me.nick || '匿名', color: me.color, text }) })
        patch({ input: '', picker: null })
      } catch (e) { patch({ status: '发送失败' }) }
    }
    const saveProfile = () => {
      const me2 = { deviceId: me.deviceId || genDeviceId(), nick: (state.nick || '匿名').trim() || '匿名', color: state.color || randColor() }
      saveMe(me2); patch({ meReady: true, deviceId: me2.deviceId, status: '已保存' })
      fetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: me2.deviceId, nick: me2.nick, color: me2.color }) }).then(r => r.json()).then(r => { if (r && r.nick) { saveMe({ deviceId: me2.deviceId, nick: r.nick, color: r.color }); patch({ nick: r.nick, color: r.color, status: '已保存' }) } }).catch(() => {})
    }
    const setDisplay = (k, v) => { const d = { ...state.display, [k]: v }; saveDisplay(d); patch({ display: d }) }
    const setNetMode = (mode) => {
      patch({ mode, status: mode === 'net' ? '正在连接公网…' : '' })
      fetch('/dsh-chat/net', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, rendezvous: state.rendezvous }) }).then(r => r.json()).then(d => { if (d) patch({ mode: d.mode === 'net' ? 'net' : 'lan', status: '' }) }).catch(() => patch({ status: '模式设置失败' }))
    }
    const saveRendezvous = () => {
      fetch('/dsh-chat/net', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: state.mode, rendezvous: state.rendezvous.trim() }) }).then(r => r.json()).then(d => { if (d) patch({ status: '已保存站点地址' }) }).catch(() => patch({ status: '保存失败' }))
    }
    const addPeer = () => { const url = state.peerInput.trim(); if (!url) return; fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers, peerInput: '' }) }).catch(() => {}) }
    const removePeer = (url) => fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers }) }).catch(() => {})
    const toggleTunnel = () => {
      if (state.tunnelBusy) return
      patch({ tunnelBusy: true })
      const action = state.tunnel && state.tunnel.running ? 'stop' : 'start'
      fetch('/dsh-chat/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
        .then(r => r.json()).then(d => { patch({ tunnel: d, tunnelBusy: false }) }).catch(() => { patch({ tunnelBusy: false, status: '隧道操作失败' }) })
    }
    const copyText = (t) => { try { if (navigator && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}) } catch (e) {} }

    if (!open) return null
    const meN = me.nick || '我'
    const dp = state.display
    const wrapStyle = { '--dshc-fs': dp.fontSize + 'px', '--dshc-bgap': dp.bubbleGap + 'px', '--dshc-ls': dp.letterSpacing + 'px' }

    // ---- CHAT view: messages only ----
    let chatList
    if (state.msgs.length) {
      const rows = state.msgs.map((m, i) => {
        const mine = m.nodeId === 'local' || (m.deviceId && me.deviceId && m.deviceId === me.deviceId)
        const isSticker = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(m.text) && m.text.length <= 4
        const bubble = isSticker ? createElement('div', { className: 'dshc-sticker' }, m.text) : createElement('div', { className: 'dshc-bubble' }, m.text)
        return createElement('div', { key: m.msgId || m.idx || i, className: 'dshc-row ' + (mine ? 'mine' : 'other') },
          createElement('div', { className: 'dshc-avatar', style: { background: m.color || colorOf(m.nodeId || m.nick) } }, avatarText(m.nick)),
          createElement('div', { className: 'dshc-col' }, createElement('div', { className: 'dshc-nick' }, mine ? '我' : (m.nick + ' · ' + m.nodeId)), bubble))
      })
      chatList = createElement('div', null, rows)
    } else {
      chatList = createElement('div', { className: 'dshc-empty' }, createElement('span', { className: 'big' }, '👋'), '还没有消息')
    }

    // ---- MEMBERS view ----
    let memberList
    if (state.members.length) {
      const list = state.members.map((mb) => createElement('div', { key: mb.deviceId || mb.nodeId, className: 'dshc-member' },
        createElement('div', { className: 'dshc-avatar', style: { width: 30, height: 30, borderRadius: 8, background: mb.color || '#9AA3B5' } }, avatarText(mb.nick)),
        createElement('span', { className: 'mname' }, mb.nick),
        createElement('span', { className: 'mtag' }, (me.deviceId && mb.deviceId === me.deviceId) ? '我' : '在线')))
      memberList = createElement('div', { className: 'dshc-members' }, list)
    } else {
      memberList = createElement('div', { className: 'dshc-empty' }, '暂无成员')
    }

    // ---- SETTINGS view ----
    const relayPort = state.info && state.info.relayPort
    const cpolarCmd = relayPort ? ('cpolar http 127.0.0.1:' + relayPort) : 'cpolar http <端口>'
    const nodeEls = state.peers.map((p) => createElement('span', { key: p, className: 'dshc-node' }, p.replace(/^https?:\/\//, '').slice(0, 34), createElement('span', { style: { cursor: 'pointer', color: 'var(--dshc-err)' }, onClick: () => removePeer(p) }, ' ✕')))
    const cards = []
    // 1) Network mode
    cards.push(createElement('div', { key: 'c-net', className: 'dshc-card' },
      createElement('h4', null, '网络模式'),
      createElement('div', { className: 'dshc-seg' },
        createElement('button', { className: state.mode === 'lan' ? 'on' : '', onClick: () => setNetMode('lan') }, '局域网'),
        createElement('button', { className: state.mode === 'net' ? 'on' : '', onClick: () => setNetMode('net') }, '互联网')),
      state.mode === 'net'
        ? createElement('div', null,
            createElement('div', { className: 'dshc-srow' }, createElement('label', null, '站点'), createElement('input', { type: 'text', value: state.rendezvous, placeholder: 'https://你的-workers.workers.dev', onInput: (e) => patch({ rendezvous: e.target.value }) })),
            createElement('div', { style: { display: 'flex', gap: 8 } }, createElement('button', { className: 'dshc-save', onClick: saveRendezvous }, '保存'), createElement('button', { className: 'dshc-copy', onClick: () => copyText(state.rendezvous) }, '复制')),
            createElement('div', { className: 'dshc-hint' }, '互联网模式需要：① 在下方启动本机 cpolar 穿透拿到公网地址；② 把公网地址上报到你的 Cloudflare Workers 站点（自动）；③ 站点会返回其它在线节点的公网地址供直连。'))
        : createElement('div', null,
            createElement('div', { className: 'dshc-hint' }, '局域网模式：插件自动在局域网内广播信标并发现同网段的其它 DSH 节点，发现即尝试连接。也可以手动添加节点：'),
            createElement('div', { className: 'dshc-nodes' }, nodeEls.length ? nodeEls : createElement('span', { className: 'dshc-hint', style: { margin: 0 } }, '暂未连接其它节点')),
            createElement('div', { className: 'dshc-srow' }, createElement('input', { type: 'text', value: state.peerInput, placeholder: 'http://其它机器IP:端口', onInput: (e) => patch({ peerInput: e.target.value }) }), createElement('button', { className: 'dshc-save', onClick: addPeer }, '添加')))))
    // 2) Display
    cards.push(createElement('div', { key: 'c-disp', className: 'dshc-card' },
      createElement('h4', null, '显示设置'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '字号'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: 11, max: 18, step: 0.5, value: dp.fontSize, onInput: (e) => setDisplay('fontSize', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.fontSize + 'px'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '气泡间距'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: 6, max: 28, step: 1, value: dp.bubbleGap, onInput: (e) => setDisplay('bubbleGap', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.bubbleGap + 'px'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '字距'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: -1, max: 4, step: 0.5, value: dp.letterSpacing, onInput: (e) => setDisplay('letterSpacing', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.letterSpacing + 'px')))))
    // 3) Profile
    cards.push(createElement('div', { key: 'c-me', className: 'dshc-card' },
      createElement('h4', null, '我的资料'),
      createElement('div', { className: 'dshc-me' }, createElement('div', { className: 'dshc-avatar', style: { width: 44, height: 44, borderRadius: 12, background: state.color || me.color || '#9AA3B5' } }, avatarText(state.nick || meN)), createElement('div', null, createElement('div', { style: { fontWeight: 600 } }, state.nick || meN), createElement('div', { style: { fontSize: 11, color: 'var(--dshc-fg2)' } }, '随机分配，可修改'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '昵称'), createElement('input', { type: 'text', value: state.nick || '', placeholder: '输入昵称', onInput: (e) => patch({ nick: e.target.value }) })),
      createElement('div', { className: 'dshc-srow', style: { alignItems: 'flex-start' } }, createElement('label', null, '颜色'), createElement('div', { className: 'dshc-swatches' }, AVATAR_COLORS.map((c) => createElement('span', { key: c, className: 'dshc-swatch' + ((state.color || me.color) === c ? ' on' : ''), style: { background: c }, onClick: () => patch({ color: c }) })))),
      createElement('div', { style: { marginTop: 8 } }, createElement('button', { className: 'dshc-save', onClick: saveProfile }, '保存'))))
    // 4) Device id
    cards.push(createElement('div', { key: 'c-dev', className: 'dshc-card' },
      createElement('h4', null, '我的设备'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '设备ID'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, me.deviceId || '…'), createElement('button', { className: 'dshc-copy', onClick: () => copyText(me.deviceId || '') }, '复制'))),
      createElement('div', { className: 'dshc-hint' }, '每台机器一个稳定设备号，本地保证同机不重复；将来接入站点可据此限制“一人多号”。')))
    // 5) cpolar tunnel
    cards.push(createElement('div', { key: 'c-tun', className: 'dshc-card' },
      createElement('h4', null, '内网穿透 (cpolar)'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '安装'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, 'npm i -g cpolar'), createElement('button', { className: 'dshc-copy', onClick: () => copyText('npm i -g cpolar') }, '复制'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '启动'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, cpolarCmd), createElement('button', { className: 'dshc-copy', onClick: () => copyText(cpolarCmd) }, '复制'))),
      createElement('div', { style: { marginTop: 8 } }, createElement('button', { className: 'dshc-tunnelbtn ' + (state.tunnel && state.tunnel.running ? 'on' : 'off'), onClick: toggleTunnel, disabled: state.tunnelBusy }, state.tunnel && state.tunnel.running ? '■ 停止穿透' : '▶ 一键启动穿透')),
      state.tunnel && state.tunnel.running ? createElement('div', { className: 'dshc-hint' }, '公网地址: ', createElement('span', { className: 'dshc-urllink' }, state.tunnel.publicUrl || '获取中…')) : createElement('div', { className: 'dshc-hint' }, '互联网模式必备：穿透后插件会把公网地址自动上报到站点。关闭群聊/插件会自动停止穿透。')))

    const settingsView = createElement('div', { className: 'dshc-body' }, createElement('div', { className: 'dshc-settings' }, cards))

    let body
    if (state.tab === 'chat') body = createElement('div', { className: 'dshc-body' }, chatList)
    else if (state.tab === 'members') body = createElement('div', { className: 'dshc-body' }, memberList)
    else body = settingsView

    const modeChip = state.mode === 'net' ? '互联网' : '局域网'
    const picker = state.picker === 'emoji' ? createElement('div', { className: 'dshc-picker' }, EMOJIS.map((e, i) => createElement('span', { key: 'e' + i, className: 'dshc-pe', onClick: () => patch({ input: state.input + e }) }, e))) : (state.picker === 'sticker' ? createElement('div', { className: 'dshc-picker stickers' }, STICKERS.map((s, i) => createElement('span', { key: 's' + i, className: 'dshc-pe st', onClick: () => patch({ input: state.input + s }) }, s))) : null)

    return createElement('div', { className: 'dshc-wrap', style: wrapStyle },
      createElement('div', { className: 'dshc-h' },
        createElement('div', { className: 'dshc-title' }, createElement('b', null, 'DeepSeek 群聊'), createElement('span', { className: 'chip' }, modeChip)),
        createElement('div', { className: 'dshc-tabs' }, createElement('button', { className: 'dshc-tab' + (state.tab === 'chat' ? ' on' : ''), onClick: () => patch({ tab: 'chat', picker: null }) }, '聊天'), createElement('button', { className: 'dshc-tab' + (state.tab === 'members' ? ' on' : ''), onClick: () => patch({ tab: 'members', picker: null }) }, '成员'), createElement('button', { className: 'dshc-tab' + (state.tab === 'settings' ? ' on' : ''), onClick: () => patch({ tab: 'settings', picker: null }) }, '设置')),
        createElement('button', { className: 'dshc-close', onClick: () => uiSet(false), title: '关闭' }, '✕')),
      body,
      state.status ? createElement('div', { className: 'dshc-status' }, state.status) : null,
      picker,
      createElement('div', { className: 'dshc-foot' },
        createElement('div', { className: 'dshc-toolbar' }, createElement('button', { className: 'dshc-tbtn' + (state.picker === 'emoji' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'emoji' ? null : 'emoji' }) }, '😊'), createElement('button', { className: 'dshc-tbtn' + (state.picker === 'sticker' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'sticker' ? null : 'sticker' }) }, '🖼️'), createElement('button', { className: 'dshc-tbtn', onClick: () => patch({ input: state.input + ' ✨ Enjoy! ' }) }, '✨Enjoy')),
        createElement('div', { className: 'dshc-inputrow' }, createElement('input', { className: 'dshc-input', value: state.input, placeholder: '输入消息，Enter 发送', onInput: (e) => patch({ input: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') send() } }), createElement('button', { className: 'dshc-send', onClick: send }, '发送'))))
  }

  // Shared UI state between the sidebar toggle and the overlay panel (independent React roots).
  const ui = { open: false, listeners: new Set() }
  const uiSet = (open) => { ui.open = !!open; ui.listeners.forEach((fn) => fn()) }
  const uiSubscribe = (fn) => { ui.listeners.add(fn); return () => ui.listeners.delete(fn) }

  function colorOf(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + (s || '').charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }

  function ToggleButton() {
    const [, force] = useState(0)
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])
    return createElement('button', {
      onClick: () => uiSet(!ui.open),
      title: '群聊',
      style: { border: '1px solid var(--dshc-border,#d8dde9)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', background: ui.open ? 'var(--dshc-grad,linear-gradient(135deg,#4D6BFE,#6D5BD0))' : 'transparent', color: ui.open ? '#fff' : 'inherit' }
    }, ui.open ? '✕ 群聊' : '💬 群聊')
  }

  const apply = (ctx) => {
    if (!ctx.slots) return
    if (typeof document !== 'undefined') {
      try {
        const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el)
        ctx.effect(() => () => { try { document.head.removeChild(el) } catch (e) {} })
      } catch (e) {}
    }
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dshc-chat-panel', order: 100 }, () => createElement(ChatPanel)))
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
