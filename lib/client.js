// @eave_bounty/dsh-programmer-chatroom — web client (hand-validated bundle, no build step).
// Registers a 💬 chat overlay + sidebar action for the decentralized P2P chatroom.
//
// Theme: the panel reads the shell's live `--dsw-alias-*` theme tokens, so it follows
// DeepSeek's own dark/light appearance automatically (dark → current palette, light → white/blue).
//
// Identity: each machine gets a stable deviceId + auto-assigned nickname & avatar color
// (registered via /dsh-chat/me, collision-avoided on the host). Settings tab lets the user
// edit nick + avatar color. No monitoring tab, no image/media, history stays in memory.
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

  // --- identity (per machine, persisted in localStorage; nothing on the network side) ---
  const ID_KEY = 'dshc.identity'
  function loadMe() { try { const raw = localStorage.getItem(ID_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.deviceId) return o } } catch (e) {} return null }
  function saveMe(m) { try { localStorage.setItem(ID_KEY, JSON.stringify(m)) } catch (e) {} }
  function genDeviceId() { return 'dev-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36) }
  function randColor() { return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] }
  function randNick() { return NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + Math.floor(Math.random() * 90 + 10) }

  const css = `
:root{
  --dshc-brand:#4D6BFE; --dshc-brand2:#7C3AED;
  --dshc-grad:linear-gradient(135deg,#4D6BFE,#7C3AED);
  /* follow the shell theme; DeepSeek dark -> current palette, light -> white/blue */
  --dshc-bg:var(--dsw-alias-bg-base,#0E1117);
  --dshc-panel:var(--dsw-alias-bg-layer-2,#161B24);
  --dshc-panel2:var(--dsw-alias-bg-layer-1,#1C2230);
  --dshc-border:var(--dsw-alias-border-l1,#252D3D);
  --dshc-fg:var(--dsw-alias-label-primary,#E6EAF2);
  --dshc-fg2:var(--dsw-alias-label-secondary,#9AA3B5);
  --dshc-bubble-other:var(--dsw-alias-bg-layer-1,#232B3B);
  --dshc-bubble-self:linear-gradient(135deg,var(--dsw-alias-brand-primary,#4D6BFE),#6D5BD0);
  --dshc-err:var(--dsw-alias-state-error-primary,#F87171);
  --dshc-ok:var(--dsw-alias-state-success-primary,#34D399);
  --dshc-warn:var(--dsw-alias-state-warn-primary,#F59E0B);
}
.dshc-wrap{position:fixed;right:16px;bottom:16px;width:430px;max-width:calc(100vw - 32px);height:640px;max-height:calc(100vh - 32px);background:var(--dshc-panel);color:var(--dshc-fg);border:1px solid var(--dshc-border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;font-size:13.5px;overflow:hidden;z-index:999;pointer-events:auto;font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;}
.dshc-h{background:var(--dshc-grad);padding:12px 14px;display:flex;align-items:center;gap:10px;color:#fff;}
.dshc-title{flex:1;min-width:0;}.dshc-title b{display:block;font-size:15px;}.dshc-title span{font-size:11px;opacity:.92;}
.dshc-tabs{display:flex;gap:2px;background:rgba(0,0,0,.16);border-radius:9px;padding:2px;}
.dshc-tab{padding:4px 10px;border-radius:7px;cursor:pointer;font-size:12px;border:none;background:transparent;color:rgba(255,255,255,.85);}.dshc-tab.on{background:rgba(255,255,255,.22);color:#fff;font-weight:600;}
.dshc-close{background:transparent;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;width:28px;height:28px;border-radius:8px;}.dshc-close:hover{background:rgba(255,255,255,.18);}
.dshc-body{flex:1;overflow-y:auto;padding:14px 12px;background:var(--dshc-bg);}
.dshc-relaybar{padding:7px 12px;background:rgba(77,107,254,.07);border-bottom:1px solid var(--dshc-border);font-size:12px;color:var(--dshc-fg2);}
.dshc-row{display:flex;align-items:flex-end;margin-bottom:14px;}.dshc-row.mine{flex-direction:row-reverse;}
.dshc-avatar{width:36px;height:36px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;}
.dshc-col{max-width:72%;margin:0 8px;display:flex;flex-direction:column;}
.dshc-nick{font-size:11px;color:var(--dshc-fg2);margin:0 2px 4px;}.dshc-row.mine .dshc-nick{text-align:right;}
.dshc-bubble{padding:9px 13px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}
.dshc-row.other .dshc-bubble{background:var(--dshc-bubble-other);border-top-left-radius:4px;}
.dshc-row.mine .dshc-bubble{background:var(--dshc-bubble-self);color:#fff;border-top-right-radius:4px;}
.dshc-sticker{font-size:46px;line-height:1;padding:6px;}
.dshc-status{color:var(--dshc-warn);font-size:12px;padding:8px 16px 0;}
.dshc-foot{border-top:1px solid var(--dshc-border);padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dshc-panel2);}
.dshc-toolbar{display:flex;align-items:center;gap:2px;}
.dshc-tbtn{width:32px;height:32px;border-radius:8px;background:transparent;border:none;color:var(--dshc-fg2);font-size:19px;cursor:pointer;}.dshc-tbtn.on{background:rgba(77,107,254,.16);}
.dshc-inputrow{display:flex;gap:8px;align-items:center;}
.dshc-input{flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--dshc-border);background:var(--dshc-bg);color:var(--dshc-fg);outline:none;font-size:13.5px;}
.dshc-send{padding:9px 18px;border-radius:10px;border:none;background:var(--dshc-grad);color:#fff;cursor:pointer;font-weight:600;}
.dshc-picker{position:absolute;right:12px;bottom:128px;width:300px;max-height:240px;overflow-y:auto;background:var(--dshc-panel2);border:1px solid var(--dshc-border);border-radius:12px;padding:10px;box-shadow:0 12px 36px rgba(0,0,0,.5);display:grid;grid-template-columns:repeat(8,1fr);gap:2px;z-index:1000;}
.dshc-picker.stickers{grid-template-columns:repeat(6,1fr);}
.dshc-pe{font-size:22px;padding:5px;text-align:center;border-radius:8px;cursor:pointer;}.dshc-pe.st{font-size:34px;}
.dshc-empty{color:var(--dshc-fg2);text-align:center;margin-top:40px;}.dshc-empty .big{font-size:44px;display:block;margin-bottom:8px;}
.dshc-peers{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.dshc-peer{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 4px;border-radius:20px;background:var(--dshc-panel2);border:1px solid var(--dshc-border);font-size:12px;}
.dshc-peeradd{display:flex;gap:6px;margin-top:8px;align-items:center;}.dshc-peeradd input{flex:1;padding:6px 10px;border-radius:8px;border:1px solid var(--dshc-border);background:var(--dshc-bg);color:var(--dshc-fg);outline:none;font-size:12px;}.dshc-peeradd button{padding:6px 12px;border-radius:8px;border:none;background:var(--dshc-brand);color:#fff;cursor:pointer;font-size:12px;}
/* members tab */
.dshc-members{display:flex;flex-direction:column;gap:8px;}
.dshc-member{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:var(--dshc-panel2);border:1px solid var(--dshc-border);}
.dshc-member .mname{flex:1;font-size:13px;}
.dshc-member .mtag{font-size:11px;color:var(--dshc-fg2);}
/* settings tab */
.dshc-settings{display:flex;flex-direction:column;gap:14px;}
.dshc-card{background:var(--dshc-panel2);border:1px solid var(--dshc-border);border-radius:12px;padding:12px;}
.dshc-card h4{margin:0 0 10px;font-size:13px;color:var(--dshc-fg);}
.dshc-me{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
.dshc-srow{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.dshc-srow label{font-size:12px;color:var(--dshc-fg2);width:56px;flex:none;}
.dshc-srow input{flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--dshc-border);background:var(--dshc-bg);color:var(--dshc-fg);outline:none;font-size:13px;}
.dshc-swatches{display:flex;flex-wrap:wrap;gap:8px;}
.dshc-swatch{width:26px;height:26px;border-radius:8px;cursor:pointer;border:2px solid transparent;}.dshc-swatch.on{border-color:var(--dshc-fg);}
.dshc-save{padding:8px 18px;border-radius:9px;border:none;background:var(--dshc-grad);color:#fff;cursor:pointer;font-weight:600;font-size:13px;}
.dshc-cmd{display:flex;align-items:center;gap:8px;}
.dshc-cmd code{flex:1;padding:8px 10px;border-radius:8px;background:var(--dshc-bg);border:1px solid var(--dshc-border);font-size:11.5px;color:var(--dshc-fg);word-break:break-all;}
.dshc-copy{padding:6px 12px;border-radius:8px;border:none;background:var(--dshc-brand);color:#fff;cursor:pointer;font-size:12px;}
.dshc-tunnelbtn{padding:8px 14px;border-radius:9px;border:none;cursor:pointer;font-weight:600;font-size:13px;}
.dshc-tunnelbtn.on{background:var(--dshc-err);color:#fff;}
.dshc-tunnelbtn.off{background:var(--dshc-grad);color:#fff;}
.dshc-hint{font-size:11.5px;color:var(--dshc-fg2);line-height:1.6;margin-top:6px;}
.dshc-urllink{color:var(--dshc-brand);word-break:break-all;}
`

  function ChatPanel() {
    const [state, setState] = useState({
      msgs: [], peers: [], seq: 0, members: [], input: '', status: '', tab: 'chat', picker: null,
      peerInput: '', info: null, tunnel: null, tunnelBusy: false,
      nick: '', color: '', meReady: false
    })
    // Shared open flag lives in the module store; this panel subscribes to it directly
    // (NOT via a captured prop), so the ✕ close button reliably flips it.
    const [open, setOpen] = useState(ui.open)
    const [, force] = useState(0)
    const patch = (p) => setState((s) => ({ ...s, ...p }))
    const me = state.meReady ? { nick: state.nick, color: state.color } : (loadMe() || {})

    useEffect(() => uiSubscribe(() => setOpen(ui.open)), [])
    // Re-render on other store changes too (cheap; keeps peers/count in sync).
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])

    // Identity: ensure a deviceId, then register with the host for a unique nick + color.
    useEffect(() => {
      if (!open) return
      let me2 = loadMe()
      if (!me2) { me2 = { deviceId: genDeviceId(), nick: randNick(), color: randColor() }; saveMe(me2); patch({ nick: me2.nick, color: me2.color, meReady: true }) }
      else patch({ nick: me2.nick, color: me2.color, meReady: true })
      const d = me2.deviceId
      fetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: d, nick: me2.nick, color: me2.color }) })
        .then(r => r.json()).then(r => { if (r && r.nick) { saveMe({ deviceId: d, nick: r.nick, color: r.color }); patch({ nick: r.nick, color: r.color }) } }).catch(() => {})
    }, [open])

    // Polling + tunnel status refresh.
    useEffect(() => {
      if (!open) return
      const tick = setInterval(async () => {
        try {
          const r = await fetch('/dsh-chat/poll?afterSeq=' + state.seq)
          const d = await r.json()
          const upd = {}
          if (Array.isArray(d.messages)) upd.msgs = state.msgs.concat(d.messages)
          if (Array.isArray(d.peers)) upd.peers = d.peers
          if (typeof d.lastSeq === 'number') upd.seq = d.lastSeq
          if (Array.isArray(d.members)) upd.members = d.members
          patch(upd)
        } catch (e) {}
      }, 1500)
      fetch('/dsh-chat/info').then(r => r.json()).then(d => patch({ info: d })).catch(() => {})
      fetch('/dsh-chat/tunnel').then(r => r.json()).then(d => patch({ tunnel: d })).catch(() => {})
      return () => clearInterval(tick)
    }, [open])

    const send = async () => {
      const text = state.input.trim(); if (!text) return
      const me2 = me
      try {
        const r = await fetch('/dsh-chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: me2.deviceId || 'local', nick: me2.nick || '匿名', color: me2.color, text }) })
        const d = await r.json()
        // Blocked messages are dropped with zero user-visible feedback (silent moderation).
        patch({ input: '', picker: null })
      } catch (e) { patch({ status: '发送失败' }) }
    }
    const addPeer = () => { const url = state.peerInput.trim(); if (!url) return; fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers, peerInput: '' }) }).catch(() => {}) }
    const removePeer = (url) => fetch('/dsh-chat/peers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', url }) }).then(r => r.json()).then(d => { if (Array.isArray(d.peers)) patch({ peers: d.peers }) }).catch(() => {})
    const saveProfile = () => {
      const me2 = { deviceId: (loadMe() || {}).deviceId || genDeviceId(), nick: (state.nick || '匿名').trim() || '匿名', color: state.color || randColor() }
      saveMe(me2); patch({ meReady: true, status: '已保存' })
      fetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: me2.deviceId, nick: me2.nick, color: me2.color }) }).then(r => r.json()).then(r => { if (r && r.nick) { saveMe({ deviceId: me2.deviceId, nick: r.nick, color: r.color }); patch({ nick: r.nick, color: r.color, status: '已保存' }) } }).catch(() => {})
    }
    const toggleTunnel = () => {
      if (state.tunnelBusy) return
      patch({ tunnelBusy: true })
      const action = state.tunnel && state.tunnel.running ? 'stop' : 'start'
      fetch('/dsh-chat/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
        .then(r => r.json()).then(d => { patch({ tunnel: d, tunnelBusy: false }); if (d.running && d.publicUrl) patch({ status: '公网地址: ' + d.publicUrl }) }).catch(() => { patch({ tunnelBusy: false, status: '隧道操作失败' }) })
    }
    const copyText = (t) => { try { if (navigator && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}) } catch (e) {} }

    if (!open) return null
    const meN = me.nick || '我'
    const msgs = state.msgs.map((m, i) => {
      const mine = m.nodeId === 'local' || (m.deviceId && me.deviceId && m.deviceId === me.deviceId)
      const isSticker = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(m.text) && m.text.length <= 4
      const bubble = isSticker ? createElement('div', { className: 'dshc-sticker' }, m.text) : createElement('div', { className: 'dshc-bubble' }, m.text)
      return createElement('div', { key: m.msgId || m.idx || i, className: 'dshc-row ' + (mine ? 'mine' : 'other') },
        createElement('div', { className: 'dshc-avatar', style: { background: m.color || colorOf(m.nodeId || m.nick) } }, avatarText(m.nick)),
        createElement('div', { className: 'dshc-col' }, createElement('div', { className: 'dshc-nick' }, mine ? '我' : (m.nick + ' · ' + (m.nodeId === 'local' ? '本机' : m.nodeId))), bubble))
    })
    const peers = state.peers.map((p) => createElement('span', { key: p, className: 'dshc-peer' }, p.replace(/^https?:\/\//, ''), createElement('span', { style: { cursor: 'pointer', color: 'var(--dshc-err)' }, onClick: () => removePeer(p) }, ' ✕')))
    const picker = state.picker === 'emoji' ? createElement('div', { className: 'dshc-picker' }, EMOJIS.map((e, i) => createElement('span', { key: 'e' + i, className: 'dshc-pe', onClick: () => patch({ input: state.input + e }) }, e))) : (state.picker === 'sticker' ? createElement('div', { className: 'dshc-picker stickers' }, STICKERS.map((s, i) => createElement('span', { key: 's' + i, className: 'dshc-pe st', onClick: () => patch({ input: state.input + s }) }, s))) : null)

    // --- tabs ---
    let body
    if (state.tab === 'chat') {
      let listContent
      if (msgs.length) {
        const peerRow = createElement('div', { key: 'pw', style: { marginTop: 10, borderTop: '1px solid var(--dshc-border)', paddingTop: 8 } },
          createElement('div', { style: { color: 'var(--dshc-fg2)', fontSize: 12, marginBottom: 4 } }, '已连接的节点'),
          createElement('div', { className: 'dshc-peers' }, peers.length ? peers : createElement('span', { style: { color: 'var(--dshc-fg2)', fontSize: 12 } }, '暂无')),
          createElement('div', { className: 'dshc-peeradd' }, createElement('input', { value: state.peerInput, placeholder: 'http://其它机器IP:端口', onInput: (e) => patch({ peerInput: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') addPeer() } }), createElement('button', { onClick: addPeer }, '添加节点')))
        listContent = createElement('div', { key: 'list' }, msgs, peerRow)
      } else {
        listContent = createElement('div', { key: 'empty', className: 'dshc-empty' }, createElement('span', { className: 'big' }, '👋'), '还没有消息')
      }
      body = createElement('div', { className: 'dshc-body' },
        createElement('div', { key: 'day', className: 'dshc-relaybar' }, '去中心化 mesh · 每台机器都是服务器，直接互连(填对方 http://IP:端口) · 记录仅存于在线机器内存'),
        listContent)
    } else if (state.tab === 'members') {
      const list = state.members.map((mb) => createElement('div', { key: mb.deviceId || mb.nodeId, className: 'dshc-member' },
        createElement('div', { className: 'dshc-avatar', style: { width: 30, height: 30, borderRadius: 8, background: mb.color || '#666' } }, avatarText(mb.nick)),
        createElement('span', { className: 'mname' }, mb.nick),
        createElement('span', { className: 'mtag' }, mb.deviceId && me.deviceId && mb.deviceId === me.deviceId ? '我' : '在线')))
      body = createElement('div', { className: 'dshc-body' }, createElement('div', { className: 'dshc-members' }, list.length ? list : createElement('div', { className: 'dshc-empty' }, '暂无成员')))
    } else {
      const relayPort = state.info && state.info.relayPort
      const lanUrl = (state.info && state.info.lanIP && relayPort) ? ('http://' + state.info.lanIP + ':' + relayPort) : null
      const cpolarCmd = relayPort ? ('cpolar http 127.0.0.1:' + relayPort) : 'cpolar http <端口>'
      body = createElement('div', { className: 'dshc-body' }, createElement('div', { className: 'dshc-settings' },
        createElement('div', { className: 'dshc-card' },
          createElement('h4', null, '我的资料'),
          createElement('div', { className: 'dshc-me' }, createElement('div', { className: 'dshc-avatar', style: { width: 44, height: 44, borderRadius: 12, background: state.color || me.color || '#666' } }, avatarText(state.nick || meN)), createElement('div', null, createElement('div', { style: { fontWeight: 600 } }, state.nick || meN), createElement('div', { style: { fontSize: 11, color: 'var(--dshc-fg2)' } }, '自动分配，可修改'))),
          createElement('div', { className: 'dshc-srow' }, createElement('label', null, '昵称'), createElement('input', { value: state.nick || '', placeholder: '输入昵称', onInput: (e) => patch({ nick: e.target.value }) })),
          createElement('div', { className: 'dshc-srow', style: { alignItems: 'flex-start' } }, createElement('label', null, '颜色'), createElement('div', { className: 'dshc-swatches' }, AVATAR_COLORS.map((c) => createElement('span', { key: c, className: 'dshc-swatch' + ((state.color || me.color) === c ? ' on' : ''), style: { background: c }, onClick: () => patch({ color: c }) })))),
          createElement('div', { style: { marginTop: 10 } }, createElement('button', { className: 'dshc-save', onClick: saveProfile }, '保存'))),
        createElement('div', { className: 'dshc-card' },
          createElement('h4', null, '内网穿透 (cpolar)'),
          createElement('div', { className: 'dshc-srow' }, createElement('label', null, '安装'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, 'npm i -g cpolar'), createElement('button', { className: 'dshc-copy', onClick: () => copyText('npm i -g cpolar') }, '复制'))),
          createElement('div', { className: 'dshc-srow' }, createElement('label', null, '启动'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, cpolarCmd), createElement('button', { className: 'dshc-copy', onClick: () => copyText(cpolarCmd) }, '复制'))),
          createElement('div', { style: { marginTop: 10 } }, createElement('button', { className: 'dshc-tunnelbtn ' + (state.tunnel && state.tunnel.running ? 'on' : 'off'), onClick: toggleTunnel, disabled: state.tunnelBusy }, state.tunnel && state.tunnel.running ? '■ 停止穿透' : '▶ 一键启动穿透')),
          state.tunnel && state.tunnel.running ? createElement('div', { className: 'dshc-hint' }, '公网地址: ', createElement('span', { className: 'dshc-urllink' }, state.tunnel.publicUrl || '获取中…'), '　把这个地址发给其它机器，它们添加到节点即可跨内网互通。关闭群聊/插件会自动停止穿透。') : createElement('div', { className: 'dshc-hint' }, '需先安装 cpolar 并登录(免费账号获取 authtoken: cpolar authtoken <你的token>)。启动后插件自动管理进程，群聊关闭即自动暂停穿透。')),
        createElement('div', { className: 'dshc-card' },
          createElement('h4', null, '本机信息'),
          createElement('div', { className: 'dshc-hint' }, lanUrl ? ('同局域网内，让其它机器添加节点: ' + lanUrl) : '未获取到本机局域网地址。'),
          state.info && state.info.relay ? createElement('div', { className: 'dshc-hint' }, '伴生中继运行中 (端口 ' + relayPort + ')，每台机器都是一个服务器，别人只要知道你的 IP:端口 就能直连。') : createElement('div', { className: 'dshc-hint' }, '伴生中继未启用，本机模式下仅自己可见。'))
      ))
    }
    return createElement('div', { className: 'dshc-wrap' },
      createElement('div', { className: 'dshc-h' },
        createElement('div', { className: 'dshc-title' }, createElement('b', null, 'DeepSeek 群聊'), createElement('span', null, state.peers.length + ' 台在线节点 · 去中心化 P2P mesh')),
        createElement('div', { className: 'dshc-tabs' }, createElement('button', { className: 'dshc-tab' + (state.tab === 'chat' ? ' on' : ''), onClick: () => patch({ tab: 'chat', picker: null }) }, '聊天'), createElement('button', { className: 'dshc-tab' + (state.tab === 'members' ? ' on' : ''), onClick: () => patch({ tab: 'members', picker: null }) }, '成员'), createElement('button', { className: 'dshc-tab' + (state.tab === 'settings' ? ' on' : ''), onClick: () => patch({ tab: 'settings', picker: null }) }, '设置')),
        createElement('button', { className: 'dshc-close', onClick: () => uiSet(false), title: '关闭' }, '✕')),
      body,
      state.status ? createElement('div', { className: 'dshc-status' }, state.status) : null,
      picker,
      createElement('div', { className: 'dshc-foot' },
        createElement('div', { className: 'dshc-toolbar' }, createElement('button', { className: 'dshc-tbtn' + (state.picker === 'emoji' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'emoji' ? null : 'emoji' }) }, '😊'), createElement('button', { className: 'dshc-tbtn' + (state.picker === 'sticker' ? ' on' : ''), onClick: () => patch({ picker: state.picker === 'sticker' ? null : 'sticker' }) }, '🖼️'), createElement('button', { className: 'dshc-tbtn', onClick: () => patch({ input: state.input + ' ✨ Enjoy! ' }) }, '✨Enjoy')),
        createElement('div', { className: 'dshc-inputrow' }, createElement('input', { className: 'dshc-input', value: state.input, placeholder: '输入消息，Enter 发送', onInput: (e) => patch({ input: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') send() } }), createElement('button', { className: 'dshc-send', onClick: send }, '发送'))))
  }

  // Shared UI state between the sidebar toggle and the overlay panel. The two slots are
  // independent React roots, so they cannot share a single useState; a module-level store
  // with a tiny subscription lets the button flip the panel's open flag and the panel reads
  // it from the store itself (fixes the ✕ close being a no-op when passed as a captured prop).
  const ui = { open: false, listeners: new Set() }
  const uiSet = (open) => { ui.open = !!open; ui.listeners.forEach((fn) => fn()) }
  const uiSubscribe = (fn) => { ui.listeners.add(fn); return () => ui.listeners.delete(fn) }

  // Deterministic hash-color fallback for peers that don't carry a color.
  function colorOf(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + (s || '').charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }

  function ToggleButton() {
    const [, force] = useState(0)
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])
    return createElement('button', {
      onClick: () => uiSet(!ui.open),
      title: '群聊',
      style: { border: '1px solid var(--dshc-border,#333)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', background: ui.open ? 'var(--dshc-grad,linear-gradient(135deg,#4D6BFE,#8B5CF6))' : 'transparent', color: ui.open ? '#fff' : 'inherit' }
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
