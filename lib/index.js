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
// Self-contained: binds 0.0.0.0, file IPC with the plugin, LAN UDP-beacon discovery,
// optional internet rendezvous. Kept in sync with dshc-relay.js by hand.
// IMPORTANT: nothing in this template may contain a backtick, "${" or a backslash escape.
const RELAY_SOURCE = String.raw`#!/usr/bin/env node
const http=require('http'),os=require('os'),fs=require('fs'),dgram=require('dgram');
function parseArgs(argv){const out={port:39321,bind:'0.0.0.0',peers:[],name:null,stateFile:null,outboxFile:null,peersFile:null,netmodeFile:null};for(let i=2;i<argv.length;i++){const a=argv[i];if(a==='--port')out.port=Number(argv[++i]);else if(a==='--bind')out.bind=argv[++i];else if(a==='--name')out.name=argv[++i];else if(a==='--peer')out.peers.push(argv[++i]);else if(a==='--state-file')out.stateFile=argv[++i];else if(a==='--outbox-file')out.outboxFile=argv[++i];else if(a==='--peers-file')out.peersFile=argv[++i];else if(a==='--netmode-file')out.netmodeFile=argv[++i];}return out;}
const args=parseArgs(process.argv);
const MACS=Object.values(os.networkInterfaces()).flat().filter(function(i){return i&&!i.internal&&i.mac&&i.mac!=='00:00:00:00:00:00'}).map(function(i){return i.mac});
const DEVSEED=(function(){let s=os.hostname()+'|'+((os.cpus&&os.cpus()[0])?os.cpus()[0].model:'')+'|'+(MACS[0]||'');let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h.toString(36)})();
const name=args.name||('d'+DEVSEED);
const lanIPs=Object.values(os.networkInterfaces()).flat().filter(function(i){return i&&i.family==='IPv4'&&!i.internal}).map(function(i){return i.address});
const MAX_TEXT=4000,MAX_NICK=32,MAX_BODY=64*1024;
const cleanText=function(s){return String(s||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,MAX_TEXT)};
const cleanNick=function(s){return String(s||'?').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g,'').trim().slice(0,MAX_NICK)||'?'};
const validPeer=function(s){return /^https?:\/\/[^\s\/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(String(s||''))&&!/@/.test(s)&&!/^(file|ftp|javascript|unix|data|ws|wss):/i.test(s)};
function collectBody(req,cb){let n=0,body='',done=false;const finish=function(err){if(done)return;done=true;cb(err,body)};req.on('data',function(c){n+=c.length;if(n>MAX_BODY)finish(new Error('body too large'));else body+=c});req.on('end',function(){finish(null)});req.on('error',function(){finish(new Error('stream error'))});}
const BEACON_PORT=39400;
const netMode={mode:'lan',rendezvous:'',public:''};
const autoPeers=new Map(),rdvPeers=new Map(),beaconLog=new Map();
let beaconSock=null,beaconTimer=null,lastAnnounce=0;
function readNetmode(){if(!args.netmodeFile)return;let txt;try{txt=fs.readFileSync(args.netmodeFile,'utf8');}catch(e){return;}for(const ln of String(txt||'').split('\n')){const i=ln.indexOf('=');if(i<0)continue;const k=ln.slice(0,i).trim(),v=ln.slice(i+1).trim();if(k==='mode')netMode.mode=(v==='net'?'net':'lan');else if(k==='rendezvous')netMode.rendezvous=v;else if(k==='public')netMode.public=v;}}
function startBeacon(){if(beaconSock)return;try{beaconSock=dgram.createSocket('udp4');beaconSock.on('error',function(){});beaconSock.on('message',function(msg,rinfo){try{const b=JSON.parse(String(msg));if(!b||b.t!=='dshc'||!b.httpPort||b.nodeId===name)return;const url='http://'+rinfo.address+':'+Number(b.httpPort);if(!autoPeers.has(url)){autoPeers.set(url,Date.now());if(!peers.includes(url)){peers.push(url);peerSince.delete(url);}if(!beaconLog.has(b.nodeId)){console.log('[dshc-lan] discovered '+url);beaconLog.set(b.nodeId,Date.now());}}else{autoPeers.set(url,Date.now());}}catch(e){}});beaconSock.bind(BEACON_PORT,'0.0.0.0',function(){try{beaconSock.setBroadcast(true);}catch(e){}});beaconTimer=setInterval(function(){if(netMode.mode!=='lan')return;const payload=JSON.stringify({t:'dshc',nodeId:name,httpPort:args.port,lanIPs});const buf=Buffer.from(payload);try{beaconSock.send(buf,0,buf.length,BEACON_PORT,'255.255.255.255');}catch(e){}},3000);}catch(e){}}
function pruneLanPeers(){if(!autoPeers.size)return;const now=Date.now();for(const [u,t] of Array.from(autoPeers)){if(now-t>25000){autoPeers.delete(u);peers=peers.filter(function(x){return x!==u});peerSince.delete(u);}}}
function rdvAnnounce(){if(netMode.mode!=='net'||!netMode.rendezvous)return;const now=Date.now();if(now-lastAnnounce<8000)return;lastAnnounce=now;const base=netMode.rendezvous.replace(/\/+$/,'');try{const body=JSON.stringify({deviceId:name,nodeId:name,name:name,httpUrl:netMode.public||null,lanIP:lanIPs[0]||null});const req=http.request(base+'/announce',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},function(res){res.resume()});req.on('error',function(){});req.write(body);req.end();}catch(e){}http.get(base+'/nodes?alive=90',function(r){let b='';r.on('data',function(c){b+=c});r.on('end',function(){try{const d=JSON.parse(b);const arr=(d&&Array.isArray(d.nodes))?d.nodes:[];const now2=Date.now();for(const n of arr){if(!n||n.deviceId===name||n.nodeId===name)continue;const u=String(n.httpUrl||n.httpsUrl||'').replace(/\/$/,'');if(!validPeer(u))continue;rdvPeers.set(u,now2);if(!peers.includes(u)){peers.push(u);peerSince.delete(u);}}for(const [u,t] of Array.from(rdvPeers)){if(now2-t>120000){rdvPeers.delete(u);peers=peers.filter(function(x){return x!==u});peerSince.delete(u);}}}catch(e){}});}).on('error',function(){});}
function drainOutbox(){if(!args.outboxFile)return;let txt;try{txt=fs.readFileSync(args.outboxFile,'utf8');}catch(e){return;}const lines=String(txt||'').split('\n').filter(Boolean);for(const line of lines){try{const f=JSON.parse(line);if(f&&f.msgId&&!seen.has(f.msgId)){push({msgId:f.msgId,nodeId:f.nodeId||name,nick:cleanNick(f.nick),color:/^#[0-9a-fA-F]{6}$/.test(String(f.color||''))?f.color:'#4D6BFE',text:cleanText(f.text),ts:Number(f.ts)||Date.now()});}}catch(e){}}if(lines.length){try{fs.writeFileSync(args.outboxFile,'');}catch(e){}}}
function writeState(){if(!args.stateFile)return;try{const payload=JSON.stringify({nodeId:name,messages:messages.map(function(m){return {idx:m.idx,msgId:m.msgId,nodeId:m.nodeId,deviceId:m.deviceId,nick:m.nick,color:m.color,text:m.text,ts:m.ts}}),lastIdx:nextIdx-1,peers,lanIPs});fs.writeFileSync(args.stateFile,payload);}catch(e){}}
function readPeersFile(){if(!args.peersFile)return;let txt;try{txt=fs.readFileSync(args.peersFile,'utf8');}catch(e){return;}const list=String(txt||'').split('\n').map(function(s){return s.trim().replace(/\/$/,'')}).filter(Boolean);const merged=[];for(const u of list)if(!merged.includes(u))merged.push(u);for(const p of merged)if(!peerSince.has(p))peerSince.set(p,0);peers=merged;}
const messages=[],seen=new Map();let nextIdx=1;let peers=args.peers.slice();const peerSince=new Map();
function push(msg){msg.idx=nextIdx++;messages.push(msg);if(messages.length>2000){const d=messages.shift();seen.delete(d.msgId);}seen.set(msg.msgId,true);return msg;}
const server=http.createServer(function(req,res){try{const u=new URL(req.url||'/','http://x');const path=u.pathname;
if(path==='/peers'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({peers}));return;}
if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,name,port:args.port,lanIPs,peers,messageCount:messages.length,lastIdx:nextIdx-1}));return;}
if(path==='/dsh-chat-relay'){const since=Number(u.searchParams.get('since')||0);const out=messages.filter(function(m){return m.idx>since}).map(function(m){return {idx:m.idx,msgId:m.msgId,nodeId:m.nodeId,deviceId:m.deviceId,nick:m.nick,color:m.color,text:m.text,ts:m.ts}});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({nodeId:name,messages:out,lastIdx:nextIdx-1}));return;}
if(path==='/peers'&&req.method==='POST'){collectBody(req,function(err,body){try{if(err){res.writeHead(413);res.end('too large');return;}const p=JSON.parse(body);const url=String(p.url||'').replace(/\/$/,'');if(p.action==='add'&&validPeer(url)&&!peers.includes(url)){peers.push(url);peerSince.delete(url);}else if(p.action==='remove'&&url){peers=peers.filter(function(x){return x!==url});peerSince.delete(url);}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({peers}));}catch(e){res.writeHead(400);res.end('bad json');}});return;}
if(path==='/inject'&&req.method==='POST'){collectBody(req,function(err,body){try{if(err){res.writeHead(413);res.end('too large');return;}const frames=JSON.parse(body);const list=Array.isArray(frames)?frames:[frames];const accepted=[];for(const f of list){const msgId=String(f.msgId||'');if(!msgId||seen.has(msgId))continue;accepted.push(push({msgId:msgId,nodeId:String(f.nodeId||name),deviceId:String(f.deviceId||''),nick:cleanNick(f.nick),color:/^#[0-9a-fA-F]{6}$/.test(String(f.color||''))?f.color:'#4D6BFE',text:cleanText(f.text),ts:Number(f.ts)||Date.now()}));}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({accepted:accepted.length,lastIdx:nextIdx-1}));}catch(e){res.writeHead(400);res.end('bad json');}});return;}
res.writeHead(404);res.end('not found');}catch(e){try{res.writeHead(500);res.end('err');}catch(_){}}});
function poll(){readNetmode();pruneLanPeers();rdvAnnounce();readPeersFile();drainOutbox();writeState();for(const base of peers.slice()){const since=peerSince.get(base)||0;const url=base.replace(/\/$/,'')+'/dsh-chat-relay?since='+since;http.get(url,function(r){let b='';r.on('data',function(c){b+=c});r.on('end',function(){try{const body=JSON.parse(b);if(body&&Array.isArray(body.messages)){for(const m of body.messages){if(!m.msgId||seen.has(m.msgId))continue;push({msgId:m.msgId,nodeId:m.nodeId||base,deviceId:m.deviceId||'',nick:cleanNick(m.nick),color:/^#[0-9a-fA-F]{6}$/.test(String(m.color||''))?m.color:'#4D6BFE',text:cleanText(m.text),ts:Number(m.ts)||Date.now()});}if(typeof body.lastIdx==='number')peerSince.set(base,body.lastIdx);}}catch(e){}});}).on('error',function(){});}writeState();}
setInterval(poll,2000);poll();
server.listen(args.port,args.bind,function(){writeState();drainOutbox();readNetmode();startBeacon();console.log('[dshc-relay] up name=%s bind=%s:%d peers=%d lanIPs=%s state=%s',name,args.bind,args.port,peers.length,lanIPs.join(','),args.stateFile||'off');});
process.on('SIGTERM',function(){server.close(function(){process.exit(0)})});
process.on('SIGINT',function(){server.close(function(){process.exit(0)})});
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

  // `seen` is intentionally never pruned during a session so re-read old relay history is skipped
  // (prevents duplicate re-ingest once the relay retains more history than the plugin's ring).
  function push(msg) { msg.idx = nextIdx++; messages.push(msg); if (messages.length > 500) messages.shift(); seen.set(msg.msgId, true) }

  const AVATAR_COLORS = ['#4D6BFE','#7C3AED','#0EA5E9','#10B981','#F59E0B','#EF4444','#EC4899','#14B8A6','#8B5CF6','#3B82F6','#F97316','#06B6D4']
  const NICK_POOL = ['星野','墨客','流云','山鬼','竹马','青崖','孤舟','拾光','小满','白泽','阿远','拾遗','青梧','望舒','弄月','听雨','观澜','逐风','听雪','青禾','未名','知白']
  const membersList = () => Array.from(members.values()).map((m) => ({ deviceId: m.deviceId, nick: m.nick, color: m.color, nodeId: m.nodeId }))
  function registerMember(deviceId, wantNick, wantColor) {
    const id = String(deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64); if (!id) return null
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
    const devId = String(deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64)
    const m = moderate(text)
    const msgId = 'm' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    if (m.blocked) { modCount++; return { blocked: true } }
    const rec = registerMember(devId, nick, '')
    const nn = (rec && rec.nick) || cleanNick(nick)
    const cc = (rec && rec.color) || '#4D6BFE'
    push({ msgId, nodeId: 'local', deviceId: devId, nick: nn, color: cc, text: cleanText(text), ts: Date.now() })
    outboxPush({ msgId, nodeId: 'local', deviceId: devId, nick: nn, color: cc, text: cleanText(text), ts: Date.now() })
    return { blocked: false }
  }
  function acceptRemote(f) {
    const msgId = String(f.msgId || '')
    if (!msgId || seen.has(msgId)) return
    const text = cleanText(f.text); const m = moderate(text)
    if (m.blocked) { modCount++; return }
    const nodeId = String(f.nodeId || '?').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || '?'
    const devId = String(f.deviceId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64)
    const nick = cleanNick(f.nick); const color = /^#[0-9a-fA-F]{6}$/.test(String(f.color || '')) ? f.color : '#4D6BFE'
    push({ msgId, nodeId, deviceId: devId, nick, color, text, ts: Number(f.ts) || Date.now() })
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
  // Network mode control (LAN beacon discovery vs internet rendezvous). The plugin writes a
  // tiny control file that the relay polls, so the mode can change at runtime.
  let netmode = 'lan'
  let rendezvous = ''
  let netmodePath = null
  function writeNetmode() { if (!netmodePath) return; writeFile(netmodePath, 'mode=' + netmode + '\nrendezvous=' + (rendezvous || '') + '\npublic=' + (tunnelUrl || '') + '\n') }

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
          if (t) { const m = String(t).match(/https?:\/\/[^\s'"]+/i); if (m) { tunnelUrl = m[0].replace(/[),;]+$/, ''); writeNetmode() } }
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
    netmodePath = relayDir + '/netmode.txt'
    await writeFile(outboxPath, '')
    await writeFile(peersPath, peers.join('\n'))
    await writeFile(relayScript, RELAY_SOURCE)
    writeNetmode()
    if (!subprocess || !subprocess.spawn) { console.log('[dshc] subprocess unavailable, in-process relay'); return }
    try {
      let nodeBin = 'node'
      if (subprocess.resolveExecutable) { try { nodeBin = await subprocess.resolveExecutable('node') } catch (e) { nodeBin = 'node' } }
      const handle = subprocess.spawn({
        argv: [nodeBin, relayScript, '--port', String(relayPort), '--bind', '0.0.0.0', '--state-file', statePath, '--outbox-file', outboxPath, '--peers-file', peersPath, '--netmode-file', netmodePath],
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
          // Reject non-JSON POSTs (a cross-origin page can only fire CORS-simple requests with
          // e.g. text/plain; requiring application/json stops drive-by actions on 127.0.0.1) and
          // cap body size to avoid a local memory-exhaustion DoS.
          const readJson = (req2, cb) => {
            if (!/application\/json/i.test(String((req2.headers && req2.headers['content-type']) || ''))) { cb(null, 'json only'); return }
            let n = 0, body = '', over = false, done = false
            req2.on('data', (c) => { if (done) return; n += c.length; if (n > 65536) over = true; else body += c })
            req2.on('end', () => { if (done) return; done = true; if (over) return cb(null, 'too large'); try { cb(JSON.parse(body || '{}'), null) } catch (e) { cb(null, 'bad json') } })
            req2.on('error', () => { if (done) return; done = true; cb(null, 'stream error') })
          }
          // rendezvous must be a plain http(s) URL with no whitespace (it is written into the
          // relay's line-based netmode control file; whitespace/CRLF could inject control lines).
          const sanitizeRendezvous = (v) => { const s = String(v || '').trim(); if (/[\s\u0000-\u001F]/.test(s)) return ''; return /^https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(s) ? s.slice(0, 300) : '' }
          const cleanDeviceId = (s) => String(s || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64)

          if (pathname === '/dsh-chat/poll') {
            const after = Number(params.afterSeq || 0)
            return json(200, { messages: messages.filter((m) => m.idx > after).map((m) => ({ idx: m.idx, msgId: m.msgId, nodeId: m.nodeId, deviceId: m.deviceId, nick: m.nick, color: m.color, text: m.text })), lastSeq: nextIdx - 1, peers, members: membersList() })
          }
          if (pathname === '/dsh-chat/info') {
            return json(200, { relay: !!relayPort, relayPort, relayDir, lanIP, netmode, rendezvous, lanHint: relayPort ? ('伴生中继已绑定 0.0.0.0:' + relayPort + '，同局域网内请填 http://<本机IP>:' + relayPort) : '伴生中继未启用（本机模式）' })
          }
          if (pathname === '/dsh-chat/net' && req.method === 'GET') {
            return json(200, { mode: netmode, rendezvous })
          }
          if (pathname === '/dsh-chat/net' && req.method === 'POST') {
            readJson(req, (a, err) => { if (err) return json(400, { err }); if (a.mode === 'lan' || a.mode === 'net') netmode = a.mode; rendezvous = sanitizeRendezvous(a.rendezvous); writeNetmode(); json(200, { mode: netmode, rendezvous }) })
            return
          }
          if (pathname === '/dsh-chat/me' && req.method === 'POST') {
            readJson(req, (a, err) => { if (err) return json(400, { err }); const rec = registerMember(cleanDeviceId(a.deviceId), String(a.nick || ''), String(a.color || '')); json(200, rec || { err: 'no deviceId' }) })
            return
          }
          if (pathname === '/dsh-chat/members') { return json(200, { members: membersList() }) }
          if (pathname === '/dsh-chat/tunnel' && req.method === 'GET') { return json(200, tunnelStatus()) }
          if (pathname === '/dsh-chat/tunnel' && req.method === 'POST') {
            readJson(req, (a, err) => { if (err) return json(400, { err }); Promise.resolve(a.action === 'stop' ? tunnelStop() : tunnelStart()).then((r) => json(200, r)) })
            return
          }
          if (pathname === '/dsh-chat/peers' && req.method === 'POST') {
            readJson(req, (a, err) => { if (err) return json(400, { err }); if (a.action === 'add' && validPeer(a.url)) { const u = String(a.url).replace(/\/$/, ''); if (!peers.includes(u)) { peers.push(u); syncPeersFile() } } else if (a.action === 'remove' && a.url) { const u = String(a.url).replace(/\/$/, ''); peers = peers.filter((p) => p !== u); syncPeersFile() } json(200, { peers }) })
            return
          }
          if (pathname === '/dsh-chat/send' && req.method === 'POST') {
            readJson(req, (a, err) => { if (err) return json(400, { err }); if (!rateOk('local')) { json(429, { blocked: true, reason: '发送太频繁' }); return } json(200, acceptLocal(cleanDeviceId(a.deviceId), String(a.nick || ''), String(a.text || ''))) })
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
    h.handle('chat/info', () => ({ relay: !!relayPort, relayPort, relayDir, lanIP, netmode, rendezvous, lanHint: relayPort ? ('伴生中继已绑定 0.0.0.0:' + relayPort + '，同局域网内请填 http://<本机IP>:' + relayPort) : '伴生中继未启用（本机模式）' }))
    h.handle('chat/net', (a) => { if (a && (a.mode === 'lan' || a.mode === 'net')) netmode = a.mode; if (a && typeof a.rendezvous === 'string') rendezvous = a.rendezvous.trim().slice(0, 300); writeNetmode(); return { mode: netmode, rendezvous } })
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
