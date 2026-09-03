# 公网站点对接协议 + Cloudflare Workers 部署

「互联网聊天」模式需要一个**公网在线节点目录（rendezvous）**：插件把每台机器的公网地址上报到这里，再从
这里取回其它在线机器的公网地址，实现跨 NAT 直连。你用 Cloudflare Workers + KV 免费托管即可。

本仓库已带可直接部署的后端：`workers/rendezvous.js`（Cloudflare Worker）+ `workers/wrangler.example.toml`。

## 1. 部署（把 `workers/rendezvous.js` 复制到 Cloudflare）

### 方式 A：Wrangler CLI（推荐）
```bash
cd workers
wrangler login
# 先建一个 KV 命名空间，把返回的 id 填入 wrangler.toml 的 [[kv_namespaces]].id
wrangler kv namespace create RENDEZVOUS
# 复制示例并填入 namespace id 后部署
cp wrangler.example.toml wrangler.toml   # 编辑 id
wrangler deploy
```

### 方式 B：在线粘贴（最省事）
1. Cloudflare 控制台 → Workers & Pages → Create Worker → 粘贴 `workers/rendezvous.js` 内容 → Save & Deploy。
2. 在同页面绑定 KV 命名空间（Workers 设置 → KV → 添加 `RENDEZVOUS`）。
3. 记下部署后的 URL，例如 `https://your-name.workers.dev`，填入插件的「设置 → 网络模式 → 站点」。

> KV 需要在免费计划里新建一个命名空间绑定到 `RENDEZVOUS`（代码里写死的绑定名）。

## 2. HTTP 协议（v1，插件已按此实现）

| 方法与路径 | 请求 | 响应 |
|---|---|---|
| `POST /announce` | JSON `{deviceId,nodeId,name,httpUrl,lanIP}` | `{ok:true}`；按 `deviceId` 覆盖，KV 存 300 秒；按 IP 限流(15s/次) |
| `GET /nodes?alive=90` | `alive`=在线秒数(默认60,夹10..600) | `{nodes:[{deviceId,nodeId,name,httpUrl,lanIP,ts}]}`（只含存活节点，按 ts 降序） |
| `DELETE /announce` | JSON `{deviceId}` | `{ok:true}`（主动下线） |

- 全部响应 JSON + `Access-Control-Allow-Origin:*`。
- `httpUrl` 是节点上报的**公网可达地址**（通常是 cpolar 隧道，如 `https://xxx.cpolar.top`）；其它机器拿到后直接按它轮询 mesh。
- 无鉴权，KV 目录公开——这是「谁都能加入聊天」的应有行为。

## 3. 工作流（跨 NAT 两台机器）

```
机器A(内网)                         Cloudflare Workers              机器B(内网)
  cpolar 公网 https://a.cpolar.top       /announce 上报              cpolar 公网 https://b.cpolar.top
        ──────────  POST /announce ───────────►                          ▲
        ◄───────────── GET /nodes ───────────────                        │
        ────────────── 得到 b.cpolar.top ────────────────────────────────┘
  A ── HTTP 拉取 mesh ──► https://b.cpolar.top        B ◄── HTTP 拉取 mesh ── https://a.cpolar.top
```

即：两边都要先启动本机 cpolar 拿到公网地址，切到「互联网」模式并填站点地址，各自上报/拉取后即可互聊。
关闭群聊/插件时隧道与上报都会停止（节点目录 5 分钟内自动过期消失）。

## 4. 关于「一人多号」

当前按你确认采用**纯本地同机唯一**：每台机器由硬件指纹(hostname+CPU+网卡)派生稳定 `deviceId`，本地保证同机不重复。
目录按 `deviceId` 去重（同一设备反复上报只占一条）。若日后要在站点层防刷，可在 Worker 里加：按 `deviceId`
绑定注册（首次注册后需 email/验证码激活）、按 IP 更严限流、或上线时加一次性随机 nonce 防目录污染。

## 5. 字段与安全

- Worker 侧已做：字段长度上限、控制字符剥离、`httpUrl` 必须 `^https?://` 且无空白/`@`、body 上限、错误 500 不泄内部。
- 插件侧只把**审核通过后**的消息写入 mesh，违规内容永不外泄到任何节点/站点。
