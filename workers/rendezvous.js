// ============================================================================
// dsh-programmer-chatroom —— 会合点（Rendezvous）后端
//
// 作用：维护一份“在线节点”目录（保底 / 在线节点目录）。每台机器上的
//       伴随中继进程（Node）周期性地 POST /announce 上报自己的公网 /
//       局域网地址，并用 GET /nodes 拉取当前可见的其它节点，从而在
//       P2P 直连前先“互找”；另提供 POST /merge 供 3~4 台机器每隔
//       ~10 分钟批量刷新一次本目录，让冷启动机器可通过 GET /bootstrap
//       拿到完整保底目录。
//
// 接口一览（全部返回 JSON，并带 CORS 头，浏览器 / 中继均可直连）：
//   POST   /announce            上报 / 刷新在线状态（设备 + 节点信息）
//   POST   /merge               批量合并上报（保底目录刷新，可传 {nodes:[...]} 或裸数组）
//   DELETE /announce            下线（优雅断开）
//   GET    /nodes?alive=60      获取最近 alive 秒内仍“在线”的节点列表
//   GET    /bootstrap?alive=3600 保底目录别名（= /nodes 全量，冷启动机器专用）
//   OPTIONS *                   CORS 预检，供浏览器跨域调用
//
// 挂载说明：生产环境以 /machine_list/* 前缀对外（Worker 收到的 pathname
//           形如 /machine_list/announce）。本实现自动剥离开头的
//           machine_list 段，同时也兼容无前缀直连（wrangler dev 下直接
//           访问 /announce 等裸路径仍可用）。
//
// 依赖：一个 Cloudflare KV 命名空间，wrangler 绑定名必须是 RENDEZVOUS
//       （详见同目录 wrangler.example.toml）。
// 说明：v1 是开放式目录，无密钥、无鉴权；“设备唯一性”由客户端本地保证。
//       纯请求驱动（按需触发），不需要 Cron / scheduler。
// ============================================================================

// ---------------- 常量 ----------------
const KV_PREFIX = 'node:';    // KV 键前缀，与其它可能的数据区分开
const KV_TTL = 3600;          // 长 TTL：announce / merge 写入的条目存活 60 分钟。
                              // 只靠“停止刷新后被 TTL 自然过期”清理，不做任何激进删除。

const ALIVE_DEFAULT = 60;     // GET /nodes 默认“多少秒算在线”
const ALIVE_BOOTSTRAP = 3600; // GET /bootstrap 默认窗口：让冷启动机器也能看到长活条目
const ALIVE_MIN = 10;         // alive 参数下限（秒）
const ALIVE_MAX = 7200;       // alive 参数上限（秒）

// 基础限流（进程内滑动窗口，尽力而为，各端点独立计数）：
// announce 单 IP 15 秒内最多放行 3 次（允许小 burst）。
// merge 来自少数几台机器且约 10 分钟才一次，单独给更宽的预算，避免误伤。
const RL_WINDOW_MS = 15 * 1000;
const RL_BURST = 3;
const RL_MERGE_WINDOW_MS = 60 * 1000;
const RL_MERGE_BURST = 20;
const RL_MAX_IPS = 10000;       // 内存表上限，超出后顺手回收空条目
const RL_NOIP_KEY = 'no-cf-ip'; // 拿不到 CF-Connecting-IP 时共用的粗粒度桶

const MERGE_MAX = 200;          // 单次 /merge 最多合并的节点条数，超出部分丢弃

// 各字段最大长度（字符数）
const MAX_ID = 64;            // deviceId / nodeId
const MAX_NAME = 32;          // name
const MAX_LAN = 64;           // lanIP
const MAX_URL = 300;          // httpUrl

// OPTIONS 预检应答携带的 CORS 允许头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 进程内限流表：限流键 -> { win, hits:[时间戳...] }。
// 键形如 announce:<IP> / merge:<IP>；无 IP 时退化为 announce:no-cf-ip 等粗粒度键。
// 注意：Worker 的不同隔离实例之间不共享此表，属于“尽力而为”的基础限流。
const rateHits = new Map();

// ---------------- 小工具 ----------------

// 统一的 JSON 响应（自动附带 CORS 头；请求侧请勿携带敏感信息）
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

// 只做原始 JSON 解析（不限定形状）：/merge 需要同时接受 {nodes:[...]}
// 与裸数组两种结构；解析失败 / 空体一律返回 null。
async function readRawBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 解析并校验“普通对象”JSON 请求体：不是合法 JSON / 不是普通对象时返回 null
async function readJsonBody(request) {
  const data = await readRawBody(request);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data;
}

// 清洗任意字符串字段：剥掉控制字符、去首尾空白、截断到 maxLen；
// 传入非字符串时返回 null（调用方据此判定“缺失”）。
function cleanString(value, maxLen) {
  if (typeof value !== 'string') return null;
  let s = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// 清洗 httpUrl：只接受不含空白、不含 @ 的 http(s):// 地址。
// 不合法一律置为 null（按协议要求“拒绝则置空”，而不是报错）。
function cleanHttpUrl(value) {
  const s = cleanString(value, MAX_URL);
  if (!s) return null;
  if (/\s/.test(s) || s.includes('@')) return null;
  if (!/^https?:\/\//.test(s)) return null;
  return s;
}

// 把数值夹在 [min, max] 之间；非法值回退到 fallback
function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// 把 pathname 解析成接口名：
//  1) 按 '/' 拆段，丢弃空段（容忍结尾斜杠 / 连续斜杠 / 查询串）；
//  2) 循环剥掉开头的 machine_list 前缀段（当前以 /machine_list/* 挂载，
//     也兼容无前缀直连，如 wrangler dev 下的 /announce）；
//  3) 剩余 0 段 = 首页；恰好 1 段 = 接口名（大小写敏感，仅认小写）；
//     剩余多于 1 段视为未知路径。
// 例：/announce、/machine_list/announce、/machine_list/machine_list/announce
//     都会解析成 'announce'；/ANNOUNCE 不会（大小写敏感）。
function resolveRoute(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  while (segs.length && segs[0] === 'machine_list') segs.shift();
  if (segs.length === 0) return '';      // 首页（/ 或 /machine_list 等）
  if (segs.length === 1) return segs[0]; // 接口名
  return null;                            // 未知路径
}

// 从查询串解析 alive 秒数：缺失时用 fallback，合法数值夹取到 [ALIVE_MIN, ALIVE_MAX]
function parseAlive(url, fallback) {
  const raw = Number.parseInt(url.searchParams.get('alive'), 10);
  if (Number.isNaN(raw)) return fallback;
  return clampInt(raw, ALIVE_MIN, ALIVE_MAX, fallback);
}

// 取限流键前缀对应的源标识：有 CF-Connecting-IP 用它，否则退化为粗粒度全局桶
function sourceKey(ip) {
  return ip && ip !== 'unknown' ? ip : RL_NOIP_KEY;
}

// 拉取“最近 alive 秒内仍在线”的节点列表（/nodes 与 /bootstrap 共用）。
// 只回传协议里定义过的字段，避免透传脏数据；最近上报的排前面。
async function listAliveNodes(kv, alive) {
  const cutoff = Date.now() - alive * 1000;
  const listing = await kv.list({ prefix: KV_PREFIX });
  const nodes = [];
  for (const key of listing.keys) {
    let rec = null;
    try {
      const rawValue = await kv.get(key.name);
      if (rawValue) rec = JSON.parse(rawValue);
    } catch {
      rec = null; // 读坏数据时跳过该条
    }
    if (!rec || typeof rec !== 'object') continue;
    const ts = typeof rec.ts === 'number' ? rec.ts : 0;
    if (ts <= cutoff) continue; // 超出在线窗口，丢弃
    nodes.push({
      deviceId: String(rec.deviceId ?? ''),
      nodeId: String(rec.nodeId ?? ''),
      name: String(rec.name ?? ''),
      httpUrl: typeof rec.httpUrl === 'string' ? rec.httpUrl : null,
      lanIP: typeof rec.lanIP === 'string' ? rec.lanIP : null,
      ts,
    });
  }
  nodes.sort((a, b) => b.ts - a.ts);
  return nodes;
}

// 与 /announce 完全一致的逐条清洗：deviceId / nodeId 缺失返回 null（调用方跳过），
// 其余字段按协议规范化（name 空则空串、httpUrl 不合法则 null、lanIP 空则 null）。
function sanitizeNodeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const deviceId = cleanString(entry.deviceId, MAX_ID);
  const nodeId = cleanString(entry.nodeId, MAX_ID);
  if (!deviceId || !nodeId) return null;
  const name = cleanString(entry.name, MAX_NAME) || '';
  const httpUrl = cleanHttpUrl(entry.httpUrl);
  const lanIP = cleanString(entry.lanIP, MAX_LAN) || null;
  return { deviceId, nodeId, name, httpUrl, lanIP };
}

// 通用限流判定：返回 false 表示超限，应回 429。
// 每个 (key) 独立计数，窗口取该桶已用的较大值，保证多端点互不干扰；
// 无来源 IP 时共用 RL_NOIP_KEY 桶，退化为只限总量的粗粒度闸。
function rateAllow(key, windowMs, burst) {
  const now = Date.now();
  let bucket = rateHits.get(key);
  if (!bucket) {
    bucket = { win: windowMs, hits: [] };
    rateHits.set(key, bucket);
  }
  if (windowMs > bucket.win) bucket.win = windowMs;
  // 滑出窗口的旧时间戳作废
  while (bucket.hits.length && now - bucket.hits[0] >= bucket.win) bucket.hits.shift();
  if (bucket.hits.length >= burst) return false; // burst 已满
  bucket.hits.push(now);
  // 表太大时回收已滑出窗口的空条目，防止内存无限增长
  if (rateHits.size > RL_MAX_IPS) {
    for (const [k, b] of rateHits) {
      while (b.hits.length && now - b.hits[0] >= b.win) b.hits.shift();
      if (b.hits.length === 0) rateHits.delete(k);
    }
  }
  return true;
}

// ---------------- 入口 ----------------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      // 解析接口名：自动剥离 /machine_list 前缀（详情见 resolveRoute）
      const route = resolveRoute(url.pathname);

      // ---- CORS 预检：浏览器跨域请求前先发 OPTIONS ----
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // ---- POST /announce：上报 / 刷新在线状态 ----
      if (request.method === 'POST' && route === 'announce') {
        if (!rateAllow('announce:' + sourceKey(ip), RL_WINDOW_MS, RL_BURST)) {
          return json({ ok: false, error: 'too_many_announces' }, 429);
        }
        const body = await readJsonBody(request);
        if (!body) {
          return json({ ok: false, error: 'invalid_json_body' }, 400);
        }

        // deviceId / nodeId 必填，缺失即 400
        const deviceId = cleanString(body.deviceId, MAX_ID);
        const nodeId = cleanString(body.nodeId, MAX_ID);
        if (!deviceId || !nodeId) {
          return json({ ok: false, error: 'missing_device_id_or_node_id' }, 400);
        }

        // 其余字段可选：name 空则存空串；httpUrl 不合法则置 null；
        // lanIP 空则置 null（表示暂只有一种可达地址）。
        const name = cleanString(body.name, MAX_NAME) || '';
        const httpUrl = cleanHttpUrl(body.httpUrl);
        const lanIP = cleanString(body.lanIP, MAX_LAN) || null;

        const record = {
          deviceId,
          nodeId,
          name,
          httpUrl,
          lanIP,
          ts: Date.now(),
        };

        // 以 deviceId 为键 upsert（同机再次上报即覆盖刷新），带长 TTL 自动过期
        await env.RENDEZVOUS.put(KV_PREFIX + deviceId, JSON.stringify(record), {
          expirationTtl: KV_TTL,
        });
        return json({ ok: true });
      }

      // ---- POST /merge：批量合并上报（保底目录刷新）----
      // 体可为 { nodes: [...] } 或裸数组 [{deviceId,nodeId,name,httpUrl,lanIP}, ...]；
      // 逐条按 /announce 同规则清洗；缺 deviceId / nodeId 的条目跳过；
      // 数组过长时截断到 MERGE_MAX。写 KV 用与 /announce 一致的长 TTL。
      if (request.method === 'POST' && route === 'merge') {
        if (!rateAllow('merge:' + sourceKey(ip), RL_MERGE_WINDOW_MS, RL_MERGE_BURST)) {
          return json({ ok: false, error: 'too_many_merges' }, 429);
        }
        const raw = await readRawBody(request);
        if (!raw || typeof raw !== 'object') {
          return json({ ok: false, error: 'invalid_json_body' }, 400);
        }
        let entries = Array.isArray(raw) ? raw : raw.nodes;
        if (!Array.isArray(entries)) {
          return json({ ok: false, error: 'invalid_json_body' }, 400);
        }
        if (entries.length > MERGE_MAX) entries = entries.slice(0, MERGE_MAX);

        let merged = 0;
        for (const entry of entries) {
          const clean = sanitizeNodeEntry(entry);
          if (!clean) continue; // 缺 deviceId / nodeId 或不是对象：忽略该条
          const record = { ...clean, ts: Date.now() };
          await env.RENDEZVOUS.put(KV_PREFIX + clean.deviceId, JSON.stringify(record), {
            expirationTtl: KV_TTL,
          });
          merged++;
        }
        return json({ ok: true, merged });
      }

      // ---- DELETE /announce：优雅下线 ----
      if (request.method === 'DELETE' && route === 'announce') {
        const body = await readJsonBody(request);
        if (!body) {
          return json({ ok: false, error: 'invalid_json_body' }, 400);
        }
        const deviceId = cleanString(body.deviceId, MAX_ID);
        if (!deviceId) {
          return json({ ok: false, error: 'missing_device_id' }, 400);
        }
        await env.RENDEZVOUS.delete(KV_PREFIX + deviceId);
        return json({ ok: true });
      }

      // ---- GET /nodes：返回最近 alive 秒内仍“在线”的节点列表 ----
      if (request.method === 'GET' && route === 'nodes') {
        const alive = parseAlive(url, ALIVE_DEFAULT);
        const nodes = await listAliveNodes(env.RENDEZVOUS, alive);
        return json({ nodes });
      }

      // ---- GET /bootstrap：保底目录别名（= /nodes 全量）----
      // alive 默认取大窗口（ALIVE_BOOTSTRAP），让刚冷启动、尚未刷新到任何
      // 节点缓存的机器也能先看到这批长活条目；alive 查询参数同样可选。
      if (request.method === 'GET' && route === 'bootstrap') {
        const alive = parseAlive(url, ALIVE_BOOTSTRAP);
        const nodes = await listAliveNodes(env.RENDEZVOUS, alive);
        return json({ nodes });
      }

      // ---- GET /：信息页，方便在浏览器里确认部署成功 ----
      if (request.method === 'GET' && route === '') {
        return json({
          ok: true,
          service: 'dsh-programmer-chatroom rendezvous',
          endpoints: [
            'POST /announce',
            'POST /merge',
            'DELETE /announce',
            'GET /nodes?alive=60',
            'GET /bootstrap?alive=3600',
          ],
        });
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (err) {
      // 兜底：任何意外错误都回 500，绝不把内部信息透给调用方
      console.error('[rendezvous] unexpected error:', err && err.stack ? err.stack : err);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  },
};
