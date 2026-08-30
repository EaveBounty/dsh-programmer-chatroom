// @eave_bounty/dsh-programmer-chatroom — host half (standard DSH Cordis plugin).
// Decentralized P2P group chat for DeepSeek Harness.
//
// Responsibilities:
//   - maintain an in-memory room (nothing persisted)
//   - DFA sensitive-word moderation (embedded Chinese lexicon) on every message
//   - spawn the companion relay (dshc-relay.js) via the host `subprocess` service
//     so every machine is a real 0.0.0.0 server (the plugin sandbox has no net/dgram)
//   - file-based IPC with the relay (outbox.ndjson / state.json / peers.txt) since
//     some deployments disable web.fetch
//   - expose `harness.handle` RPC for the browser client

const name = 'dsh-programmer-chatroom'
const inject = ['subprocess', 'fs', 'timer', 'webServer', 'sandboxPolicy']

// Embedded companion relay source. Kept as a string so the plugin can write it to a
// relay dir and spawn it (the sandbox cannot resolve external files reliably).
const RELAY_SOURCE = String.raw`#!/usr/bin/env node
const http=require('http');
const os=require('os');
const fs=require('fs');
const dgram=require('dgram');
function parseArgs(argv){const out={port:39321,bind:'0.0.0.0',peers:[],name:null,stateFile:null,outboxFile:null,peersFile:null,stun:null,turn:null,turnUser:null,turnPass:null,rendezvous:null};for(let i=2;i<argv.length;i++){const a=argv[i];if(a==='--port')out.port=Number(argv[++i]);else if(a==='--bind')out.bind=argv[++i];else if(a==='--name')out.name=argv[++i];else if(a==='--peer')out.peers.push(argv[++i]);else if(a==='--state-file')out.stateFile=argv[++i];else if(a==='--outbox-file')out.outboxFile=argv[++i];else if(a==='--peers-file')out.peersFile=argv[++i];else if(a==='--stun')out.stun=argv[++i];else if(a==='--turn')out.turn=argv[++i];else if(a==='--turn-user')out.turnUser=argv[++i];else if(a==='--turn-pass')out.turnPass=argv[++i];else if(a==='--rendezvous')out.rendezvous=argv[++i];}return out;}
const args=parseArgs(process.argv);
const name=args.name||('node-'+os.hostname()+'-'+Math.random().toString(36).slice(2,6));
const lanIPs=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);
const STUN_MAGIC=0x2112A442;
function stunBindingRequest(){const txn=Buffer.alloc(12);txn.writeUInt16BE(0x0001,0);txn.writeUInt16BE(0,2);txn.writeUInt32BE(STUN_MAGIC,4);for(let i=8;i<12;i++)txn[i]=Math.floor(Math.random()*256);return txn;}
function parseStunResponse(msg){if(msg.length<20||msg.readUInt16BE(0)!==0x0101)return null;let pos=20;while(pos+4<=msg.length){const type=msg.readUInt16BE(pos);const len=msg.readUInt16BE(pos+2);if(type===0x0001){const family=msg.readUInt8(pos+4+1);if(family===0x01){const port=msg.readUInt16BE(pos+4+2);const ip=msg[pos+4+4]+'.'+msg[pos+4+5]+'.'+msg[pos+4+6]+'.'+msg[pos+4+7];return{ip,port};}}pos+=4+len;}return null;}
function stunProbe(server){return new Promise(resolve=>{const[shost,sportStr='3478']=String(server).split(':');const port=Number(sportStr);const sock=dgram.createSocket('udp4');const timer=setTimeout(()=>{try{sock.close()}catch(e){}resolve(null)},4000);sock.on('message',msg=>{clearTimeout(timer);try{sock.close()}catch(e){}resolve(parseStunResponse(msg))});sock.on('error',()=>{clearTimeout(timer);try{sock.close()}catch(e){}resolve(null)});sock.send(stunBindingRequest(),port,shost,err=>{if(err){clearTimeout(timer);try{sock.close()}catch(e){}resolve(null)}});});}
let punchSocket=null;
function openUDPPunch(){punchSocket=dgram.createSocket('udp4');punchSocket.on('error',()=>{});punchSocket.bind(args.port);}
async function initNAT(){let mapped=null;if(args.stun){mapped=await stunProbe(args.stun);if(mapped)console.log('[dshc-nat] STUN mapped='+mapped.ip+':'+mapped.port+' via '+args.stun);else console.log('[dshc-nat] STUN probe failed via '+args.stun);}if(args.rendezvous){try{const body=JSON.stringify({nodeId:name,lanIPs,mapped});const req=http.request(args.rendezvous,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},()=>{});req.on('error',()=>{});req.write(body);req.end();console.log('[dshc-nat] announced to rendezvous '+args.rendezvous);}catch(e){}}if(args.turn)console.log('[dshc-nat] TURN configured '+args.turn+' (allocation hook)');return mapped;}
function drainOutbox(){if(!args.outboxFile)return;let txt;try{txt=fs.readFileSync(args.outboxFile,'utf8');}catch(e){return;}const lines=String(txt||'').split('\n').filter(Boolean);for(const line of lines){try{const f=JSON.parse(line);if(f&&f.msgId&&!seen.has(f.msgId)){push({msgId:f.msgId,nodeId:f.nodeId||name,nick:f.nick||'?',color:f.color||'#4D6BFE',text:f.text||'',ts:Number(f.ts)||Date.now()});}}catch(e){}}if(lines.length){try{fs.writeFileSync(args.outboxFile,'');}catch(e){}}}
function writeState(){if(!args.stateFile)return;try{const payload=JSON.stringify({nodeId:name,messages:messages.map(m=>({idx:m.idx,msgId:m.msgId,nodeId:m.nodeId,nick:m.nick,color:m.color,text:m.text,ts:m.ts})),lastIdx:nextIdx-1,peers,lanIPs});fs.writeFileSync(args.stateFile,payload);}catch(e){}}
function readPeersFile(){if(!args.peersFile)return;let txt;try{txt=fs.readFileSync(args.peersFile,'utf8');}catch(e){return;}const list=String(txt||'').split('\n').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean);const merged=[];for(const u of list)if(!merged.includes(u))merged.push(u);for(const p of merged)if(!peerSince.has(p))peerSince.set(p,0);peers=merged;}
const messages=[];const seen=new Map();let nextIdx=1;let peers=args.peers.slice();const peerSince=new Map();
function push(msg){msg.idx=nextIdx++;messages.push(msg);if(messages.length>2000){const d=messages.shift();seen.delete(d.msgId);}seen.set(msg.msgId,true);return msg;}
const server=http.createServer((req,res)=>{try{const u=new URL(req.url||'/','http://x');const path=u.pathname;
if(path==='/peers'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({peers}));return;}
if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,name,port:args.port,lanIPs,peers,messageCount:messages.length,lastIdx:nextIdx-1}));return;}
if(path==='/dsh-chat-relay'){const since=Number(u.searchParams.get('since')||0);const out=messages.filter(m=>m.idx>since).map(({idx,msgId,nodeId,nick,color,text,ts})=>({idx,msgId,nodeId,nick,color,text,ts}));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({nodeId:name,messages:out,lastIdx:nextIdx-1}));return;}
if(path==='/peers'&&req.method==='POST'){let body='';req.on('data',c=>{body+=c;});req.on('end',()=>{try{const p=JSON.parse(body);const url=String(p.url||'').replace(/\/$/,'');if(p.action==='add'&&url&&!peers.includes(url)){peers.push(url);peerSince.delete(url);}else if(p.action==='remove'&&url){peers=peers.filter(x=>x!==url);peerSince.delete(url);}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({peers}));}catch(e){res.writeHead(400);res.end('bad json');}});return;}
if(path==='/inject'&&req.method==='POST'){let body='';req.on('data',c=>{body+=c;});req.on('end',()=>{try{const frames=JSON.parse(body);const list=Array.isArray(frames)?frames:[frames];const accepted=[];for(const f of list){const msgId=String(f.msgId||'');if(!msgId||seen.has(msgId))continue;accepted.push(push({msgId,nodeId:String(f.nodeId||name),nick:String(f.nick||'?'),color:String(f.color||'#4D6BFE'),text:String(f.text||''),ts:Number(f.ts)||Date.now()}));}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({accepted:accepted.length,lastIdx:nextIdx-1}));}catch(e){res.writeHead(400);res.end('bad json');}});return;}
res.writeHead(404);res.end('not found');}catch(e){try{res.writeHead(500);res.end('err');}catch(_){}}});
function poll(){readPeersFile();drainOutbox();writeState();for(const base of peers.slice()){const since=peerSince.get(base)||0;const url=base.replace(/\/$/,'')+'/dsh-chat-relay?since='+since;http.get(url,(r)=>{let b='';r.on('data',c=>{b+=c;});r.on('end',()=>{try{const body=JSON.parse(b);if(body&&Array.isArray(body.messages)){for(const m of body.messages){if(!m.msgId||seen.has(m.msgId))continue;push({msgId:m.msgId,nodeId:m.nodeId||base,nick:m.nick||'?',color:m.color||'#4D6BFE',text:m.text||'',ts:Number(m.ts)||Date.now()});}if(typeof body.lastIdx==='number')peerSince.set(base,body.lastIdx);}}catch(e){}});}).on('error',()=>{});}writeState();}
setInterval(poll,2000);poll();
server.listen(args.port,args.bind,()=>{writeState();drainOutbox();console.log('[dshc-relay] up name=%s bind=%s:%d peers=%d state=%s',name,args.bind,args.port,peers.length,args.stateFile||'off');openUDPPunch();initNAT();});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
`

const apply = (ctx) => {
  const messages = []
  const seen = new Map()
  let nextIdx = 1
  // Silent moderation: we only count blocked/violating items. No per-record log is ever
  // exposed to users or the UI (requirement: intercept quietly, give users no feedback loop).
  let modCount = 0
  let peers = []
  // Member registry (deviceId -> identity). Only the assigning machine sees it; identities
  // also ride on each message (nick + color) so every node renders consistently.
  const members = new Map()
  const sendTimes = new Map() // nodeId -> recent send timestamps (rate limit)

  // --- hardening: sanitize & limits ---
  const MAX_TEXT = 4000
  const MAX_NICK = 32
  const cleanText = (s) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_TEXT)
  const cleanNick = (s) => String(s || '匿名').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().slice(0, MAX_NICK) || '匿名'
  const validPeer = (u) => { const s = String(u || ''); return /^https?:\/\/[^\s\/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(s) && !/@/.test(s) && !/^(file|ftp|javascript|unix|data|ws|wss):/i.test(s) }
  const rateOk = (nodeId) => { const now = Date.now(); let arr = sendTimes.get(nodeId) || []; arr = arr.filter((t) => now - t < 5000); if (arr.length >= 20) { sendTimes.set(nodeId, arr); return false } arr.push(now); sendTimes.set(nodeId, arr); return true }

  const LEXICON = [
    '法轮功','政治谣言','颠覆国家','分裂国家','邪教','恐怖主义','恐怖袭击','极端组织',
    '冰毒','海洛因','大麻','可卡因','摇头丸','毒品','制毒','k粉','冰壶',
    '赌博','博彩','洗钱','刷单','电信诈骗','杀猪盘','资金盘','网络诈骗','跑分','开盘',
    '色情','裸聊','约炮','卖淫','嫖娼','援交','黄色网站',
    '杀人','砍死','灭口','威胁','人肉搜索','诽谤','歧视','仇恨','轻生',
    '木马','勒索病毒','盗号','撞库','钓鱼网站','ddos','破解','夺号',
    '枪支','弹药','走私','伪造证件','购毒','违禁品','欺诈','赌博机'
  ]
  function buildTrie(words) { const root = {}; for (const w of words) { let n = root; for (const ch of w) { if (!n[ch]) n[ch] = {}; n = n[ch] } n.$ = true } return root }
  const trie = buildTrie(LEXICON)
  function scan(text) { const hits = []; const s = String(text || ''); for (let i = 0; i < s.length; i++) { let n = trie, j = i, word = ''; while (j < s.length && n[s[j]]) { word += s[j]; n = n[s[j]]; if (n.$) { hits.push(word); break } j++ } } return hits }
  function moderate(text) {
    const flags = []
    for (const w of scan(text)) flags.push({ category: 'sensitive', word: w, reason: '命中敏感词: ' + w })
    if (/sk-[A-Za-z0-9_-]{20,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{16,}/i.test(text)) flags.push({ category: 'credential', word: '', reason: '疑似泄露 API 密钥/口令' })
    if (/[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/.test(text)) flags.push({ category: 'idcard', word: '', reason: '疑似身份证号泄露' })
    if (/(^|[^\d])(1[3-9]\d{9})($|[^\d])/.test(text)) flags.push({ category: 'phone', word: '', reason: '疑似手机号泄露(提示)' })
    const blocked = flags.some((f) => f.category !== 'phone')
    return { blocked, flags }
  }

  function push(msg) { msg.idx = nextIdx++; messages.push(msg); if (messages.length > 500) { const d = messages.shift(); seen.delete(d.msgId) } seen.set(msg.msgId, true) }

  const AVATAR_COLORS = ['#4D6BFE','#7C3AED','#0EA5E9','#10B981','#F59E0B','#EF4444','#EC4899','#14B8A6','#8B5CF6','#3B82F6','#F97316','#06B6D4']
  const NICK_POOL = ['星野','墨客','流云','山鬼','竹马','青崖','孤舟','拾光','小满','白泽','阿远','拾遗','青梧','望舒','弄月','听雨','观澜','逐风','听雪','青禾','未名','知白']
  const membersList = () => Array.from(members.values()).map((m) => ({ deviceId: m.deviceId, nick: m.nick, color: m.color, nodeId: m.nodeId }))
  function registerMember(deviceId, wantNick, wantColor) {
    const id = String(deviceId || ''); if (!id) return null
    const existing = members.get(id)
    const usedNicks = new Set(Array.from(members.values()).map((m) => m.nick))
    const usedColors = new Set(Array.from(members.values()).map((m) => m.color))
    // nickname: prefer requested, else assign a unique random one (avoid collision by appending a number)
    let nick = cleanNick(wantNick)
    if (existing && existing.nick) nick = existing.nick
    else if (!nick || nick === '匿名') { let cand; do { cand = NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + Math.floor(Math.random() * 90 + 10) } while (usedNicks.has(cand)); nick = cand }
    else if (usedNicks.has(nick)) { nick = nick + Math.floor(Math.random() * 90 + 10) }
    // color: prefer requested, else pick an unused one (different colored avatars per member)
    let color = /^#[0-9a-fA-F]{6}$/.test(wantColor || '') ? wantColor : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
    if (existing && existing.color) color = existing.color
    else if (usedColors.has(color)) { const free = AVATAR_COLORS.find((c) => !usedColors.has(c)); if (free) color = free }
    const rec = { deviceId: id, nodeId: existing ? existing.nodeId : ('node-' + id.slice(-6)), nick, color, seenAt: Date.now() }
    members.set(id, rec); return rec
  }

  // Silent moderation: blocked items just increment the counter; nothing is logged for the user.
  function acceptLocal(deviceId, nick, text) {
    const m = moderate(text)
    const msgId = 'm' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    if (m.blocked) { modCount++; return { blocked: true } }
    const rec = registerMember(deviceId, nick, '')
    const nn = (rec && rec.nick) || cleanNick(nick)
    const cc = (rec && rec.color) || '#4D6BFE'
    push({ msgId, nodeId: 'local', deviceId: String(deviceId || ''), nick: nn, color: cc, text: cleanText(text), ts: Date.now() })
    outboxPush({ msgId, nodeId: 'local', deviceId: String(deviceId || ''), nick: nn, color: cc, text: cleanText(text), ts: Date.now() })
    return { blocked: false }
  }
  function acceptRemote(f) {
    const msgId = String(f.msgId || '')
    if (!msgId || seen.has(msgId)) return
    const text = cleanText(f.text); const m = moderate(text)
    if (m.blocked) { modCount++; return }
    const nick = cleanNick(f.nick); const color = /^#[0-9a-fA-F]{6}$/.test(String(f.color || '')) ? f.color : '#4D6BFE'
    push({ msgId, nodeId: String(f.nodeId || '?'), deviceId: String(f.deviceId || ''), nick, color, text, ts: Number(f.ts) || Date.now() })
  }

  const subprocess = ctx.get('subprocess')
  const fss = ctx.get('fs')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  let relayPort = null
  let relayProc = null
  let relayDir = null
  let statePath = null
  let outboxPath = null
  let peersPath = null
  let relayPollDispose = null
  let lanIP = null
  // cpolar tunnel state (one-click NAT traversal; auto-stopped with the plugin)
  let tunnelProc = null
  let tunnelUrl = null
  let tunnelLogFile = null

  function tunnelStatus() { return { running: !!tunnelProc, publicUrl: tunnelUrl, port: relayPort } }
  async function tunnelStart() {
    if (tunnelProc) return tunnelStatus()
    if (!subprocess || !subprocess.spawn || !relayPort) return { running: false, error: '伴生中继未运行或无法启动子进程' }
    try {
      let nodeBin = 'node'
      if (subprocess.resolveExecutable) { try { nodeBin = await subprocess.resolveExecutable('node') } catch (e) { nodeBin = 'node' } }
      const base = homeRoot()
      tunnelLogFile = base + '/.dshc-relay-' + relayPort + '/cpolar.log'
      await writeFile(tunnelLogFile, '')
      // Run cpolar via a tiny node wrapper so we can capture its stdout to a log file and
      // auto-extract the public URL. Falls back gracefully if cpolar isn't installed.
      const handle = subprocess.spawn({
        argv: [nodeBin, '-e', 'const{spawn}=require("child_process");const fs=require("fs");const p=spawn(process.platform==="win32"?"cpolar.cmd":"cpolar",["http","127.0.0.1:"+process.argv[1]],{stdio:["ignore","pipe","pipe"]});p.stdout.on("data",d=>{try{fs.appendFileSync(process.argv[2],d)}catch(e){}});p.stderr.on("data",d=>{try{fs.appendFileSync(process.argv[2],d)}catch(e){}});p.on("exit",()=>process.exit(0));p.on("error",()=>process.exit(1));', String(relayPort), tunnelLogFile],
        cwd: base,
        stdio: { stdin: 'ignore', stdout: { mode: 'ignore' }, stderr: { mode: 'ignore' } },
        graceMs: 3000
      })
      tunnelProc = handle
      const timer = ctx.get('timer')
      if (timer && fss) {
        timer.interval(async () => {
          const t = await readFile(tunnelLogFile)
          if (t) { const m = String(t).match(/https?:\/\/[^\s'"]+/i); if (m) tunnelUrl = m[0].replace(/[),;]+$/, '') }
        }, 1500)
      }
      return { running: true, publicUrl: tunnelUrl, port: relayPort, note: '公网地址会自动抓取(几秒内)' }
    } catch (e) { return { running: false, error: String(e) } }
  }
  function tunnelStop() { if (tunnelProc && tunnelProc.terminate) { try { tunnelProc.terminate() } catch (e) {} } tunnelProc = null; tunnelUrl = null; return { running: false } }

  function homeRoot() { return sandboxPolicy && sandboxPolicy.workspaceRoot ? sandboxPolicy.workspaceRoot : '.' }
  async function writeFile(p, c) { if (!fss || !fss.writeText) return; try { const t = await fss.resolve(p, { cwd: homeRoot() }); await fss.writeText(t, c) } catch (e) {} }
  async function readFile(p) { if (!fss || !fss.readText) return null; try { const t = await fss.resolve(p, { cwd: homeRoot() }); return await fss.readText(t) } catch (e) { return null } }

  function outboxPush(msg) { if (!outboxPath) return; readFile(outboxPath).then((cur) => writeFile(outboxPath, (cur || '') + JSON.stringify(msg) + '\n')) }
  function syncPeersFile() { if (peersPath) writeFile(peersPath, peers.join('\n')) }

  async function tryStartRelay() {
    relayPort = 39321 + Math.floor(Math.random() * 50)
    const base = homeRoot()
    relayDir = base + '/.dshc-relay-' + relayPort
    const relayScript = relayDir + '/relay.js'
    statePath = relayDir + '/state.json'
    outboxPath = relayDir + '/outbox.ndjson'
    peersPath = relayDir + '/peers.txt'
    await writeFile(outboxPath, '')
    await writeFile(peersPath, peers.join('\n'))
    await writeFile(relayScript, RELAY_SOURCE)
    if (!subprocess || !subprocess.spawn) { console.log('[dshc] subprocess unavailable, in-process relay'); return }
    try {
      let nodeBin = 'node'
      if (subprocess.resolveExecutable) { try { nodeBin = await subprocess.resolveExecutable('node') } catch (e) { nodeBin = 'node' } }
      const handle = subprocess.spawn({
        argv: [nodeBin, relayScript, '--port', String(relayPort), '--bind', '0.0.0.0', '--name', 'dshc-relay', '--state-file', statePath, '--outbox-file', outboxPath, '--peers-file', peersPath],
        cwd: base,
        stdio: { stdin: 'ignore', stdout: { mode: 'ignore' }, stderr: { mode: 'ignore' } },
        graceMs: 3000
      })
      relayProc = handle
      console.log('[dshc] spawned embedded relay on port', relayPort)
      const timer = ctx.get('timer')
      if (timer && fss) {
        relayPollDispose = timer.interval(async () => {
          const txt = await readFile(statePath)
          if (txt) { try { const body = JSON.parse(txt); if (body && Array.isArray(body.messages)) { for (const m of body.messages) acceptRemote(m) } if (body && Array.isArray(body.peers) && body.peers.length) peers = body.peers; if (body && Array.isArray(body.lanIPs) && body.lanIPs.length) lanIP = body.lanIPs[0] } catch (e) {} }
        }, 1200)
      }
    } catch (e) { console.log('[dshc] relay spawn failed, in-process relay', String(e)); relayPort = null; relayDir = null; statePath = null; outboxPath = null; peersPath = null }
  }

  const webServer = ctx.get('webServer')
  let disposeRoute
  let disposeRelayRoute
  if (webServer) {
    // Companion-relay-style endpoint so peers can pull from this node even without a companion.
    disposeRelayRoute = webServer.register({
      kind: 'exact',
      path: '/dsh-chat-relay',
      handler: (req, res) => {
        try {
          const q = String(req.url || ''); const qi = q.indexOf('?'); const qs = qi === -1 ? '' : q.slice(qi + 1)
          let since = 0; for (const pair of qs.split('&')) { if (pair.indexOf('since=') === 0) since = Number(decodeURIComponent(pair.slice(6)) || 0) }
          const out = messages.filter((m) => m.idx > since).map(({ idx, msgId, nodeId, deviceId, nick, color, text, ts }) => ({ idx, msgId, nodeId, deviceId, nick, color, text, ts }))
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ nodeId: 'plugin', messages: out, lastIdx: nextIdx - 1 }))
        } catch (e) { try { res.writeHead(500); res.end('err') } catch (_) {} }
      }
    })
    disposeRoute = webServer.register({
      kind: 'prefix',
      path: '/dsh-chat',
      handler: (req, res) => {
        try {
          const pathname = String(req.url || '').split('?')[0]
          const q = String(req.url || ''); const qi = q.indexOf('?'); const qs = qi === -1 ? '' : q.slice(qi + 1)
          const params = {}; for (const pair of qs.split('&')) { if (pair) { const eq = pair.indexOf('='); params[decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq))] = decodeURIComponent(eq === -1 ? '' : pair.slice(eq + 1)) } }
          const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

          if (pathname === '/dsh-chat/poll') {
            const after = Number(params.afterSeq || 0)
            return json(200, { messages: messages.filter((m) => m.idx > after).map((m) => ({ idx: m.idx, msgId: m.msgId, nodeId: m.nodeId, deviceId: m.deviceId, nick: m.nick, color: m.color, text: m.text })), lastSeq: nextIdx - 1, peers, members: membersList() })
          }
          if (pathname === '/dsh-chat/info') {
            return json(200, { relay: !!relayPort, relayPort, relayDir, lanIP, lanHint: relayPort ? ('伴生中继已绑定 0.0.0.0:' + relayPort + '，同局域网内请填 http://<本机IP>:' + relayPort) : '伴生中继未启用（本机模式）' })
          }
          if (pathname === '/dsh-chat/me' && req.method === 'POST') {
            let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
              try { const a = JSON.parse(body); const rec = registerMember(String(a.deviceId || ''), String(a.nick || ''), String(a.color || '')); json(200, rec || { err: 'no deviceId' }) } catch (e) { json(400, { err: 'bad json' }) }
            })
            return
          }
          if (pathname === '/dsh-chat/members') { return json(200, { members: membersList() }) }
          if (pathname === '/dsh-chat/tunnel' && req.method === 'GET') { return json(200, tunnelStatus()) }
          if (pathname === '/dsh-chat/tunnel' && req.method === 'POST') {
            let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
              try { const a = JSON.parse(body || '{}'); Promise.resolve(a.action === 'stop' ? tunnelStop() : tunnelStart()).then((r) => json(200, r)) } catch (e) { json(400, { err: 'bad json' }) }
            })
            return
          }
          if (pathname === '/dsh-chat/peers' && req.method === 'POST') {
            let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
              try { const a = JSON.parse(body); if (a.action === 'add' && validPeer(a.url)) { const u = String(a.url).replace(/\/$/, ''); if (!peers.includes(u)) { peers.push(u); syncPeersFile() } } else if (a.action === 'remove' && a.url) { const u = String(a.url).replace(/\/$/, ''); peers = peers.filter((p) => p !== u); syncPeersFile() } json(200, { peers }) } catch (e) { json(400, { err: 'bad json' }) }
            })
            return
          }
          if (pathname === '/dsh-chat/send' && req.method === 'POST') {
            let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
              try { const a = JSON.parse(body); if (!rateOk('local')) { json(429, { blocked: true, reason: '发送太频繁' }); return } json(200, acceptLocal(String(a.deviceId || ''), String(a.nick || ''), String(a.text || ''))) } catch (e) { json(400, { err: 'bad json' }) }
            })
            return
          }
          json(404, { err: 'not found' })
        } catch (e) { try { res.writeHead(500); res.end('err') } catch (_) {} }
      }
    })
  }

  tryStartRelay()

  const h = (ctx.get && ctx.get('harness')) || (typeof harness !== 'undefined' ? harness : null)
  if (h && h.handle) {
    h.handle('chat/send', (a) => { if (!rateOk('local')) return { blocked: true, reason: '发送太频繁' }; return acceptLocal(String((a && a.deviceId) || ''), String((a && a.nick) || ''), String((a && a.text) || '')) })
    h.handle('chat/poll', (a) => {
      const after = Number((a && a.afterSeq) || 0)
      return { messages: messages.filter((m) => m.idx > after).map((m) => ({ idx: m.idx, msgId: m.msgId, nodeId: m.nodeId, deviceId: m.deviceId, nick: m.nick, color: m.color, text: m.text })), lastSeq: nextIdx - 1, peers, members: membersList() }
    })
    h.handle('chat/me', (a) => registerMember(String((a && a.deviceId) || ''), String((a && a.nick) || ''), String((a && a.color) || '')))
    h.handle('chat/members', () => membersList())
    h.handle('chat/tunnel', (a) => { if (a && a.action === 'stop') return tunnelStop(); return tunnelStart() })
    h.handle('chat/peers', (a) => {
      if (a && a.action === 'add' && validPeer(a.url)) { const u = String(a.url).replace(/\/$/, ''); if (!peers.includes(u)) { peers.push(u); syncPeersFile() } }
      else if (a && a.action === 'remove' && a.url) { const u = String(a.url).replace(/\/$/, ''); peers = peers.filter((p) => p !== u); syncPeersFile() }
      return { peers }
    })
    h.handle('chat/info', () => ({ relay: !!relayPort, relayPort, relayDir, lanIP, lanHint: relayPort ? ('伴生中继已绑定 0.0.0.0:' + relayPort + '，同局域网内请填 http://<本机IP>:' + relayPort) : '伴生中继未启用（本机模式）' }))
    h.handle('chat/stats', () => ({ messageCount: messages.length, modCount, peerCount: peers.length, seq: nextIdx - 1, relay: !!relayPort, relayPort, tunnelRunning: !!tunnelProc }))
  }

  ctx.effect(() => () => {
    if (disposeRoute) disposeRoute()
    if (disposeRelayRoute) disposeRelayRoute()
    if (relayPollDispose) relayPollDispose()
    if (tunnelProc && tunnelProc.terminate) { try { tunnelProc.terminate() } catch (e) {} }
    if (relayProc && relayProc.terminate) { try { relayProc.terminate() } catch (e) {} }
  })
}

export { name, inject, apply }
