// ============================================================================
// dsh-programmer-chatroom —— 会合点（Rendezvous）后端
//
// 作用：维护一份“在线节点”短时目录。每台机器上的伴随中继进程（Node）
//       周期性地 POST /announce 上报自己的公网 / 局域网地址，并用
//       GET /nodes 拉取当前在线的其它节点，从而在 P2P 直连前先“互找”。
//
// 接口一览（全部返回 JSON，并带 CORS 头，浏览器 / 中继均可直连）：
//   POST   /announce        上报 / 刷新在线状态（设备 + 节点信息）
//   DELETE /announce        下线（优雅断开）
//   GET    /nodes?alive=60  获取最近 alive 秒内仍“在线”的节点列表
//   OPTIONS *               CORS 预检，供浏览器跨域调用
//
// 依赖：一个 Cloudflare KV 命名空间，wrangler 绑定名必须是 RENDEZVOUS
//       （详见同目录 wrangler.example.toml）。
// 说明：v1 是开放式目录，无密钥、无鉴权；“设备唯一性”由客户端本地保证。
//       纯请求驱动（按需触发），不需要 Cron / scheduler。
// ============================================================================

// ---------------- 常量 ----------------
const KV_PREFIX = 'node:';    // KV 键前缀，与其它可能的数据区分开
const KV_TTL = 300;           // 每条记录在 KV 中的存活秒数（过期自动清理）

const ALIVE_DEFAULT = 60;     // GET /nodes 默认“多少秒算在线”
const ALIVE_MIN = 10;         // alive 参数下限（秒）
const ALIVE_MAX = 600;        // alive 参数上限（秒）

// 基础限流：单 IP 15 秒滑动窗口内最多放行 3 次 announce（允许小 burst）
const RL_WINDOW_MS = 15 * 1000;
const RL_BURST = 3;
const RL_MAX_IPS = 10000;     // 内存表上限，超出后顺手回收空条目

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

// 进程内限流表：CF-Connecting-IP -> 最近若干次 announce 的时间戳。
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

// 解析并校验 JSON 请求体：不是合法 JSON / 不是普通对象时返回 null
async function readJsonBody(request) {
  let data = null;
  try {
    data = await request.json();
  } catch {
    return null;
  }
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

// 限流判定：返回 false 表示超限，应回 429。
function announceAllowed(ip) {
  if (!ip || ip === 'unknown') return true; // 取不到来源 IP 时不拦
  const now = Date.now();
  let hits = rateHits.get(ip);
  if (!hits) {
    hits = [];
    rateHits.set(ip, hits);
  }
  // 滑出窗口的旧时间戳作废
  while (hits.length && now - hits[0] >= RL_WINDOW_MS) hits.shift();
  if (hits.length >= RL_BURST) return false; // burst 已满
  hits.push(now);
  // 表太大时回收已清空的条目，防止内存无限增长
  if (rateHits.size > RL_MAX_IPS) {
    for (const [key, arr] of rateHits) {
      while (arr.length && now - arr[0] >= RL_WINDOW_MS) arr.shift();
      if (arr.length === 0) rateHits.delete(key);
    }
  }
  return true;
}

// ---------------- 入口 ----------------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      // ---- CORS 预检：浏览器跨域请求前先发 OPTIONS ----
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // ---- POST /announce：上报 / 刷新在线状态 ----
      if (request.method === 'POST' && path === '/announce') {
        if (!announceAllowed(ip)) {
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

        // 以 deviceId 为键 upsert（同机再次上报即覆盖刷新），带 TTL 自动过期
        await env.RENDEZVOUS.put(KV_PREFIX + deviceId, JSON.stringify(record), {
          expirationTtl: KV_TTL,
        });
        return json({ ok: true });
      }

      // ---- DELETE /announce：优雅下线 ----
      if (request.method === 'DELETE' && path === '/announce') {
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

      // ---- GET /nodes：返回最近 alive 秒内“仍在线”的节点列表 ----
      if (request.method === 'GET' && path === '/nodes') {
        // alive 参数：默认 60 秒，夹取到 [10, 600]
        let alive = ALIVE_DEFAULT;
        const rawAlive = Number.parseInt(url.searchParams.get('alive'), 10);
        if (!Number.isNaN(rawAlive)) {
          alive = clampInt(rawAlive, ALIVE_MIN, ALIVE_MAX, ALIVE_DEFAULT);
        }
        const cutoff = Date.now() - alive * 1000;

        // 小规模场景：先按前缀列出键，再逐个读取即可
        const listing = await env.RENDEZVOUS.list({ prefix: KV_PREFIX });
        const nodes = [];
        for (const key of listing.keys) {
          let rec = null;
          try {
            const rawValue = await env.RENDEZVOUS.get(key.name);
            if (rawValue) rec = JSON.parse(rawValue);
          } catch {
            rec = null; // 读坏数据时跳过该条
          }
          if (!rec || typeof rec !== 'object') continue;
          const ts = typeof rec.ts === 'number' ? rec.ts : 0;
          if (ts <= cutoff) continue; // 超出在线窗口，丢弃
          // 只挑协议里定义过的字段回传，避免透传脏数据
          nodes.push({
            deviceId: String(rec.deviceId ?? ''),
            nodeId: String(rec.nodeId ?? ''),
            name: String(rec.name ?? ''),
            httpUrl: typeof rec.httpUrl === 'string' ? rec.httpUrl : null,
            lanIP: typeof rec.lanIP === 'string' ? rec.lanIP : null,
            ts,
          });
        }
        nodes.sort((a, b) => b.ts - a.ts); // 最近上报的排前面
        return json({ nodes });
      }

      // ---- GET /：信息页，方便在浏览器里确认部署成功 ----
      if (request.method === 'GET' && path === '/') {
        return json({
          ok: true,
          service: 'dsh-programmer-chatroom rendezvous',
          endpoints: ['POST /announce', 'DELETE /announce', 'GET /nodes?alive=60'],
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
