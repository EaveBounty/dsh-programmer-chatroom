// @eave_bounty/dsh-programmer-chatroom — web client (hand-validated bundle, no build step).
//
// Force DeepSeek-style BLUE-WHITE (light) theme so the chat always reads as a clean light panel.
// The Chat view shows ONLY messages (no node/peer chatter that distracts the conversation).
// Settings tab: 显示设置 (font/bubble/letter sliders), 我的资料 (dual-scope 局域网/互联网
// nick & color) and 内网穿透. The network-mode toggle (局域网/互联网) lives in the Chat
// view so the message list stays clean.
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
  // Stable device id + per-scope profiles: each network scope (局域网 lan / 互联网 inet)
  // keeps its own nick/color under its own key; the last network mode chosen is remembered.
  const DEVICE_KEY = 'dshc.deviceId'
  const NETMODE_KEY = 'dshc.netmode'
  const LAN_PROF_KEY = 'dshc.profile.lan'
  const NET_PROF_KEY = 'dshc.profile.inet'
  function loadDeviceId() { try { return localStorage.getItem(DEVICE_KEY) } catch (e) {} return null }
  function saveDeviceId(id) { try { localStorage.setItem(DEVICE_KEY, String(id)) } catch (e) {} }
  function loadLocalMode() { try { return localStorage.getItem(NETMODE_KEY) === 'net' ? 'net' : 'lan' } catch (e) {} return 'lan' }
  function saveLocalMode(m) { try { localStorage.setItem(NETMODE_KEY, m === 'net' ? 'net' : 'lan') } catch (e) {} }
  function loadProfile(key) { try { const raw = localStorage.getItem(key); if (raw) { const o = JSON.parse(raw); if (o && typeof o.nick === 'string') return { nick: o.nick, color: /^#[0-9a-fA-F]{6}$/.test(String(o.color || '')) ? o.color : '#4D6BFE' } } } catch (e) {} return null }
  function persistProfile(key, p) { try { localStorage.setItem(key, JSON.stringify({ nick: String(p.nick || ''), color: p.color })) } catch (e) {} }
  function genDeviceId() { return 'dev-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36) }
  function randColor() { return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] }
  function randNick() { return NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + Math.floor(Math.random() * 90 + 10) }
  function defaultProfile() { return { nick: randNick(), color: randColor() } }
  // --- fetch wrapped with a timeout (AbortController), so a hung host can never wedge a call ---
  function jfetch(url, opts, ms) {
    const o = Object.assign({}, opts)
    const timeout = (ms && ms > 0) ? ms : 6000
    if (typeof AbortController !== 'undefined') {
      const ctl = new AbortController()
      o.signal = ctl.signal
      const timer = setTimeout(() => { try { ctl.abort() } catch (e) {} }, timeout)
      return fetch(url, o).then((r) => { clearTimeout(timer); return r }, (e) => { clearTimeout(timer); throw e })
    }
    return fetch(url, o)
  }

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
.dshc-cmd{display:flex;align-items:center;gap:8px;}
.dshc-cmd code{flex:1;padding:7px 10px;border-radius:8px;background:var(--dshc-bg);border:1px solid var(--dshc-border);font-size:11px;color:var(--dshc-fg);word-break:break-all;}
.dshc-copy{padding:6px 12px;border-radius:8px;border:none;background:var(--dshc-brand);color:#fff;cursor:pointer;font-size:12px;flex:none;}
.dshc-hint{font-size:11.5px;color:var(--dshc-fg2);line-height:1.6;margin-top:6px;}
.dshc-urllink{color:var(--dshc-brand);word-break:break-all;}
/* chat-view network-mode toggle (slim bar under the header) */
.dshc-chatview{display:flex;flex-direction:column;flex:1;min-height:0;}
.dshc-modetoggle{display:flex;gap:8px;align-items:center;justify-content:center;padding:7px 10px;background:var(--dshc-panel);border-bottom:1px solid var(--dshc-border);flex:none;}
.dshc-mode{display:inline-flex;align-items:center;gap:5px;padding:5px 16px;border-radius:16px;border:1px solid var(--dshc-border);background:transparent;color:var(--dshc-fg2);font-size:12px;font-weight:600;cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease,box-shadow .2s ease;}
.dshc-mode:hover{color:var(--dshc-brand);border-color:var(--dshc-brand);}
.dshc-mode .ico{display:inline-block;font-size:14px;}
.dshc-mode.on{background:var(--dshc-grad);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(77,107,254,.35);animation:dshcPop .32s ease;}
.dshc-mode.on .ico{animation:dshcPopIco .32s ease;}
@keyframes dshcPop{0%{transform:scale(.86);opacity:.35;}60%{transform:scale(1.04);opacity:1;}100%{transform:scale(1);opacity:1;}}
@keyframes dshcPopIco{0%{transform:scale(.5) translateY(4px);opacity:0;}100%{transform:scale(1) translateY(0);opacity:1;}}
/* send lock */
.dshc-send:disabled{opacity:.65;cursor:not-allowed;}
/* dual-scope profile groups (我的资料) */
.dshc-grp{padding:10px;border:1px solid var(--dshc-border);border-radius:10px;background:var(--dshc-bg);margin-bottom:12px;}
.dshc-grp .dshc-srow{margin-bottom:8px;}
.dshc-grp .dshc-srow:last-child{margin-bottom:0;}
.dshc-grpt{font-size:12px;font-weight:700;color:var(--dshc-fg);margin:0 0 8px;}
.dshc-grp.disabled{opacity:.55;}
.dshc-grp.disabled input[type=text]{cursor:not-allowed;}
.dshc-errline{color:var(--dshc-err);font-size:12px;line-height:1.5;margin-top:6px;}
`

  function ChatPanel() {
    const [state, setState] = useState({
      msgs: [], peers: [], seq: 0, members: [], input: '', status: '', tab: 'chat', picker: null,
      info: null, tunnel: null, display: loadDisplay(),
      mode: loadLocalMode(), pubDraft: '', sending: false, nickErr: ''
    })
    const [open, setOpen] = useState(ui.open)
    const [, force] = useState(0)
    const patch = (p) => setState((s) => (typeof p === 'function' ? p(s) : { ...s, ...p }))
    // The ACTIVE scope follows the current network mode: 局域网 -> 'lan', 互联网 -> 'inet'.
    // Profile drafts ALWAYS come from the module-level `prof` store (never React state), so
    // they survive any re-render / re-mount of this panel by the shell overlay.
    const me = { deviceId: prof.deviceId, nick: state.mode === 'net' ? (prof.inet.nick || '匿名') : (prof.lan.nick || '匿名'), color: state.mode === 'net' ? prof.inet.color : prof.lan.color }
    // Internet mode is only usable once a cpolar public URL is stored (the host refuses
    // 'net' without one), so the client derives the gate purely from the tunnel state.
    const hasPublic = !!(state.tunnel && state.tunnel.publicUrl)

    useEffect(() => uiSubscribe(() => setOpen(ui.open)), [])
    useEffect(() => uiSubscribe(() => force((x) => x + 1)), [])
    // Re-render whenever a profile draft changes in the module store.
    useEffect(() => profSub(() => force((x) => x + 1)), [])

    // Identity comes from the module-level `prof` store (initialized once at module scope —
    // never re-seeded or overwritten here). When the panel opens, register the ACTIVE scope
    // with the host so we show up in the members list, and reconcile the network mode (host
    // wins, mirrored back into localStorage dshc.netmode).
    useEffect(() => {
      if (!open) return
      let done = false
      const reg = (mode) => {
        const p = mode === 'net' ? prof.inet : prof.lan
        jfetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: prof.deviceId, nick: (p.nick || '').trim() || '匿名', color: p.color || '#4D6BFE' }) }, 6000).then(() => {}).catch(() => {})
      }
      // Host is authoritative for the current mode; prefer it over localStorage.
      jfetch('/dsh-chat/net', {}, 6000).then(r => r.json()).then(d2 => {
        if (done) return
        const hm = (d2 && d2.mode === 'net') ? 'net' : 'lan'
        patch({ mode: hm })
        saveLocalMode(hm)
        reg(hm)
      }).catch(() => { if (!done) reg(state.mode === 'net' ? 'net' : 'lan') })
      // Prefill the 公网地址 draft from the stored public URL only while the draft is empty.
      jfetch('/dsh-chat/tunnel', {}, 6000).then(r => r.json()).then(d3 => {
        if (done || !d3) return
        patch((s) => {
          const upd = { tunnel: d3 }
          const cur = d3.publicUrl || ''
          if (cur && !(s.pubDraft && s.pubDraft.trim())) upd.pubDraft = cur
          return { ...s, ...upd }
        })
      }).catch(() => {})
      return () => { done = true }
    }, [open])

    // Polling + periodic status refresh. The message poll is skipped while the user is on
    // the Settings tab so an in-progress profile edit is never disturbed by re-renders;
    // seq is monotonic, so the chat/members views catch up as soon as the tab is left.
    useEffect(() => {
      if (!open) return
      const tick = setInterval(async () => {
        if (state.tab === 'settings') return
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
      // Light tunnel fetch keeps on running in its own interval; it only ever sets
      // state.tunnel (never profile/draft fields), so it cannot disturb an edit.
      const t2 = setInterval(() => { jfetch('/dsh-chat/tunnel', {}, 6000).then(r => r.json()).then(d => { if (d) patch({ tunnel: d }) }).catch(() => {}) }, 3000)
      return () => { clearInterval(tick); clearInterval(t2) }
    }, [open, state.tab])

    const send = async () => {
      if (state.sending) return
      const text = state.input.trim(); if (!text) return
      patch({ sending: true })
      try {
        // The timeout helper guarantees the POST settles; the `finally` below always
        // releases the lock, so the button can never stay stuck on 发送中 even if the
        // host hangs or the request is aborted.
        await jfetch('/dsh-chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: prof.deviceId, nick: me.nick || '匿名', color: me.color, text }) }, 6000)
        patch({ input: '', picker: null })
      } catch (e) { patch({ status: (e && e.name === 'AbortError') ? '发送超时，请重试' : '发送失败，请重试' }) } finally { patch({ sending: false }) }
    }
    const saveProfile = async () => {
      const scope = state.mode === 'net' ? 'inet' : 'lan'
      const scopeWord = state.mode === 'net' ? '互联网' : '局域网'
      const typed = ((scope === 'inet' ? prof.inet.nick : prof.lan.nick) || '').trim()
      // Uniqueness check applies to the ACTIVE scope only: compare the typed nick against
      // the other online members (exclude this device), using the freshest members list.
      let members = Array.isArray(state.members) ? state.members : []
      try { const r = await jfetch('/dsh-chat/members', {}, 6000); const d = await r.json(); if (Array.isArray(d.members)) members = d.members } catch (e) {}
      const dup = typed && members.some((mb) => mb && mb.deviceId && mb.deviceId !== prof.deviceId && mb.nick === typed)
      if (dup) { patch({ status: '', nickErr: '该昵称在当前〈' + scopeWord + '〉已存在，请换一个' }); return }
      // Persist each scope separately (normalized), then register the ACTIVE scope. Only
      // this function and the user's own edits may ever write prof.lan / prof.inet.
      const lan = { nick: (prof.lan.nick || '').trim() || '匿名', color: prof.lan.color || '#4D6BFE' }
      const inet = { nick: (prof.inet.nick || '').trim() || '匿名', color: prof.inet.color || '#4D6BFE' }
      persistProfile(LAN_PROF_KEY, lan); persistProfile(NET_PROF_KEY, inet)
      profSet({ lan, inet })
      patch({ nickErr: '', status: '已保存' })
      const act = scope === 'inet' ? inet : lan
      jfetch('/dsh-chat/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: prof.deviceId, nick: act.nick, color: act.color }) }, 6000).then(() => {}).catch(() => {})
    }
    const setDisplay = (k, v) => { const d = { ...state.display, [k]: v }; saveDisplay(d); patch({ display: d }) }
    const setNetMode = (mode) => {
      const m = mode === 'net' ? 'net' : 'lan'
      if (m === state.mode) return
      // The host refuses 'net' without a stored public URL, so gate BEFORE switching or
      // POSTing: keep mode 'lan' and tell the user where to paste the URL.
      if (m === 'net' && !hasPublic) {
        patch({ status: '请先在 设置 → 内网穿透 里填入 cpolar 公网地址' })
        return
      }
      patch({ mode: m, status: m === 'net' ? '正在连接公网…' : '已切换至局域网' })
      saveLocalMode(m)
      // The rendezvous lives inside the host (with its own default); the client never
      // sends or reveals one.
      jfetch('/dsh-chat/net', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) }, 6000).then(r => r.json()).then(d => { if (d) { const hm = d.mode === 'net' ? 'net' : 'lan'; patch({ mode: hm, status: '' }); saveLocalMode(hm) } }).catch(() => patch({ status: '模式设置失败' }))
    }
    const saveTunnel = async () => {
      const url = (state.pubDraft || '').trim()
      if (!url) { patch({ status: '请先粘贴 cpolar 公网地址' }); return }
      try {
        const r = await jfetch('/dsh-chat/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', publicUrl: url }) }, 6000)
        const d = await r.json()
        // The response carries the canonical tunnel state (incl. publicUrl); sync the
        // draft to it and clear any previous status/errors.
        patch({ tunnel: d, pubDraft: (d && d.publicUrl) || '', status: '', nickErr: '' })
      } catch (e) { patch({ status: '公网地址保存失败' }) }
    }
    const clearTunnel = async () => {
      try {
        const r = await jfetch('/dsh-chat/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) }, 6000)
        const d = await r.json()
        patch({ tunnel: d, pubDraft: '', status: '公网地址已清除', nickErr: '' })
        // Without a public URL the host falls back to LAN; mirror that back locally so the
        // client never stays on 'net' while gated off.
        jfetch('/dsh-chat/net', {}, 6000).then(r2 => r2.json()).then(d2 => {
          const hm = (d2 && d2.mode === 'net') ? 'net' : 'lan'
          patch({ mode: hm })
          saveLocalMode(hm)
        }).catch(() => {})
      } catch (e) { patch({ status: '清除失败' }) }
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

    // ---- SETTINGS view (显示设置 / 我的资料 / 内网穿透; 网络模式 selector lives in Chat) ----
    const relayPort = state.info && state.info.relayPort
    const cpolarCmd = 'cpolar http 127.0.0.1:' + (relayPort || 39321)
    // Internet profile is only editable once a cpolar public URL is stored — there is no
    // plugin-side tunnel process anymore, the user pastes the URL from their own run.
    const inetLocked = !hasPublic
    const scopeWord = state.mode === 'net' ? '互联网' : '局域网'
    const activeColor = state.mode === 'net' ? (prof.inet.color || '#4D6BFE') : (prof.lan.color || '#4D6BFE')
    const cards = []
    // 1) Display
    cards.push(createElement('div', { key: 'c-disp', className: 'dshc-card' },
      createElement('h4', null, '显示设置'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '字号'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: 11, max: 18, step: 0.5, value: dp.fontSize, onInput: (e) => setDisplay('fontSize', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.fontSize + 'px'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '气泡间距'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: 6, max: 28, step: 1, value: dp.bubbleGap, onInput: (e) => setDisplay('bubbleGap', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.bubbleGap + 'px'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '字距'), createElement('div', { className: 'dshc-slider' }, createElement('input', { type: 'range', min: -1, max: 4, step: 0.5, value: dp.letterSpacing, onInput: (e) => setDisplay('letterSpacing', Number(e.target.value)) }), createElement('span', { className: 'val' }, dp.letterSpacing + 'px')))))
    // 2) Profile — dual scope. 局域网 always editable; 互联网 disabled without the tunnel.
    //    Inputs/swatches read & write the module-level `prof` store (profSet), so typing
    //    survives panel re-renders/re-mounts; 保存 commits the drafts to localStorage + host.
    cards.push(createElement('div', { key: 'c-me', className: 'dshc-card' },
      createElement('h4', null, '我的资料'),
      createElement('div', { className: 'dshc-me' }, createElement('div', { className: 'dshc-avatar', style: { width: 44, height: 44, borderRadius: 12, background: activeColor } }, avatarText(meN)), createElement('div', null, createElement('div', { style: { fontWeight: 600 } }, meN), createElement('div', { style: { fontSize: 11, color: 'var(--dshc-fg2)' } }, '当前〈' + scopeWord + '〉昵称 · 发送消息时使用'))),
      createElement('div', { className: 'dshc-grp' },
        createElement('div', { className: 'dshc-grpt' }, '🏠 局域网 昵称 / 颜色'),
        createElement('div', { className: 'dshc-srow' }, createElement('label', null, '昵称'), createElement('input', { type: 'text', value: prof.lan.nick || '', placeholder: '输入局域网昵称', onInput: (e) => { profSet({ lan: { ...prof.lan, nick: e.target.value } }); patch({ nickErr: '' }) } })),
        createElement('div', { className: 'dshc-srow', style: { alignItems: 'flex-start' } }, createElement('label', null, '颜色'), createElement('div', { className: 'dshc-swatches' }, AVATAR_COLORS.map((c) => createElement('span', { key: 'lc' + c, className: 'dshc-swatch' + ((prof.lan.color || '#4D6BFE') === c ? ' on' : ''), style: { background: c }, onClick: () => profSet({ lan: { ...prof.lan, color: c } }) }))))),
      createElement('div', { className: 'dshc-grp' + (inetLocked ? ' disabled' : '') },
        createElement('div', { className: 'dshc-grpt' }, '🌐 互联网 昵称 / 颜色'),
        createElement('div', { className: 'dshc-srow' }, createElement('label', null, '昵称'), createElement('input', { type: 'text', value: prof.inet.nick || '', placeholder: '输入互联网昵称', disabled: inetLocked, onInput: (e) => { profSet({ inet: { ...prof.inet, nick: e.target.value } }); patch({ nickErr: '' }) } })),
        createElement('div', { className: 'dshc-srow', style: { alignItems: 'flex-start' } }, createElement('label', null, '颜色'), createElement('div', { className: 'dshc-swatches' }, AVATAR_COLORS.map((c) => createElement('span', { key: 'ic' + c, className: 'dshc-swatch' + ((prof.inet.color || '#4D6BFE') === c ? ' on' : ''), style: { background: c }, onClick: () => { if (!inetLocked) profSet({ inet: { ...prof.inet, color: c } }) } })))),
        inetLocked ? createElement('div', { className: 'dshc-hint' }, '🔒 在 设置 → 内网穿透 里保存 cpolar 公网地址后，即可设置互联网昵称') : null),
      state.nickErr ? createElement('div', { className: 'dshc-errline' }, state.nickErr) : null,
      createElement('div', { style: { marginTop: 8 } }, createElement('button', { className: 'dshc-save', onClick: saveProfile }, '保存'))))
    // 3) cpolar tunnel — manual: the user runs cpolar in their own terminal and pastes the
    //    resulting public URL here. No in-app spawn/stop; internet mode is gated on hasPublic.
    //    The rendezvous / 站点地址 is managed internally by the host — never shown in the UI.
    const storedPub = (state.tunnel && state.tunnel.publicUrl) || ''
    cards.push(createElement('div', { key: 'c-tun', className: 'dshc-card' },
      createElement('h4', null, '内网穿透 (cpolar)'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '安装'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, 'npm i -g cpolar'), createElement('button', { className: 'dshc-copy', onClick: () => copyText('npm i -g cpolar') }, '复制'))),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '启动'), createElement('div', { className: 'dshc-cmd' }, createElement('code', null, cpolarCmd), createElement('button', { className: 'dshc-copy', onClick: () => copyText(cpolarCmd) }, '复制'))),
      createElement('div', { className: 'dshc-hint' }, '在你自己终端里运行上面的启动命令（本页不会自动启动）。运行后把输出的公网地址（形如 https://xxx.cpolar.top）粘贴到下面并保存：'),
      createElement('div', { className: 'dshc-srow' }, createElement('label', null, '公网地址'), createElement('input', { type: 'text', value: state.pubDraft || '', placeholder: 'https://xxx.cpolar.top', onInput: (e) => patch({ pubDraft: e.target.value, status: '', nickErr: '' }) })),
      createElement('div', { className: 'dshc-srow', style: { marginBottom: 0 } },
        createElement('button', { className: 'dshc-save', onClick: saveTunnel }, '保存'),
        createElement('button', { onClick: clearTunnel, style: { marginLeft: 8, padding: '8px 14px', borderRadius: 9, border: '1px solid var(--dshc-border)', background: 'transparent', color: 'var(--dshc-fg2)', cursor: 'pointer', fontSize: 13 } }, '清除'),
        createElement('div', { style: { flex: 1, textAlign: 'right', fontSize: 11.5, color: 'var(--dshc-fg2)' } }, storedPub ? '当前已存: ' : '未设置公网地址', storedPub ? createElement('span', { className: 'dshc-urllink' }, storedPub) : null))))

    const settingsView = createElement('div', { className: 'dshc-body' }, createElement('div', { className: 'dshc-settings' }, cards))

    // Chat view carries a slim, animated network-mode toggle (🏠 局域网 / 🌐 互联网).
    // Each pill is keyed by its active state so switching remounts the active pill and
    // re-runs the dshcPop keyframe — a single click toggles the mode exactly once.
    const modeBtn = (m, icon, label) => {
      const on = state.mode === m
      return createElement('button', { key: m + (on ? '-on' : '-off'), className: 'dshc-mode' + (on ? ' on' : ''), onClick: () => setNetMode(m), title: m === 'net' ? '切到互联网模式' : '切到局域网模式' }, createElement('span', { className: 'ico' }, icon), label)
    }
    const modeToggle = createElement('div', { className: 'dshc-modetoggle' }, modeBtn('lan', '🏠', '局域网'), modeBtn('net', '🌐', '互联网'))
    let body
    if (state.tab === 'chat') body = createElement('div', { className: 'dshc-chatview' }, modeToggle, createElement('div', { className: 'dshc-body' }, chatList))
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
        createElement('div', { className: 'dshc-inputrow' }, createElement('input', { className: 'dshc-input', value: state.input, placeholder: '输入消息，Enter 发送', onInput: (e) => patch({ input: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') send() } }), createElement('button', { className: 'dshc-send', onClick: send, disabled: state.sending }, state.sending ? '发送中…' : '发送'))))
  }

  // Shared UI state between the sidebar toggle and the overlay panel (independent React roots).
  const ui = { open: false, listeners: new Set() }
  const uiSet = (open) => { ui.open = !!open; ui.listeners.forEach((fn) => fn()) }
  const uiSubscribe = (fn) => { ui.listeners.add(fn); return () => ui.listeners.delete(fn) }

  // Editable 我的资料 drafts live at MODULE scope (same pattern as the `ui` store above):
  // the shell overlay can re-mount ChatPanel at any time, which would reset React useState
  // and wipe whatever the user is typing. Keeping drafts here makes edits survive any
  // re-render/re-mount until 保存 commits them. Initialized ONCE at module load — never
  // re-seeded from localStorage on open, and never overwritten by polling/effects.
  const prof = {
    deviceId: (loadDeviceId() || genDeviceId()),
    lan: loadProfile(LAN_PROF_KEY) || defaultProfile(),
    inet: loadProfile(NET_PROF_KEY) || defaultProfile(),
    listeners: new Set()
  }
  saveDeviceId(prof.deviceId)
  const profSet = (p) => { Object.assign(prof, p); prof.listeners.forEach((fn) => fn()) }
  const profSub = (fn) => { prof.listeners.add(fn); return () => prof.listeners.delete(fn) }

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
