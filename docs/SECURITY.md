# 安全审计与加固报告

> 针对「Programmer P2P Chatroom」的暴露面进行渗透/安全审查，并记录已实施的加固。
> 审计日期：v1.0.1 加固 + v1.1 红队攻防轮。

## 1. 暴露面（Attack Surface）

本插件有 **三层** 会对外暴露：

| # | 表面 | 绑定 | 可达范围 | 说明 |
|---|------|------|----------|------|
| 1 | 宿主 HTTP 路由 `/dsh-chat/*`、`/dsh-chat-relay` | `127.0.0.1:3080` | 仅本机 | DSH `webServer` 绑定 loopback，浏览器 UI 的唯一通道 |
| 2 | 伴生中继进程 `dshc-relay.js` | `0.0.0.0:39321~39370` | 局域网（含 `subprocess` 拉起的内嵌中继） | 「每台机器都是服务器」的设计目标 |
| 3 | cpolar 公网隧道 | 互联网随机域名 | 公网（当用户一键开启穿透后） | 把表面 2 暴露到公网 |
| 4 | Cloudflare Workers 站点 | 互联网 | 公网 | 仅存「在线节点目录」，不含消息内容 |

**结论**：能真正对外触碰的是表面 2（局域网）和表面 3/4（公网，仅在用户主动开启互联网模式时）。宿主路由仅 loopback。

## 2. 已发现的缺口与修复（已实施）

### 2.1 注入 / 清洗
- **问题**：`/inject`、`/send` 接收的 `nick`/`text` 可含控制字符（`\u0000-\u001F`）、HTML 尖括号、超长文本 → 可能污染日志、UI 渲染、跨站注入。
- **修复**：
  - 宿主 `lib/index.js`：`cleanText`（剥离控制字符，截断 4000）、`cleanNick`（剥离控制字符与 `<>`，截断 32）。
  - 伴生中继 `dshc-relay.js`：`cleanText` / `cleanNick` 同样应用在 `/inject`，纵深防御（真正的审核仍在插件侧）。

### 2.2 SSRF / 恶意 peer URL
- **问题**：`/peers` POST 可写入任意 URL，中继会 `http.get` 轮询该 URL → 可能被指向 `file://`、`javascript:`、内部服务，形成 SSRF。
- **修复**：`validPeer()` 仅放行 `http(s)://host[:port]`，禁止 `@` 与 `file|ftp|javascript|unix|data|ws|wss` 等 scheme。
- **已知局限**：`validPeer` 只校验 scheme 与语法，**不解析 IP**，因此 `127.0.0.1`、`169.254.169.254` 等仍可通过。局域网模式本质需要访问私网 peer，故不能一律封私网；mesh 轮询只发生在**用户主动添加的 peer** 或**其自有站点的目录**里。若部署到不可信公网，应加 peer 白名单 / 鉴权令牌。

### 2.3 消息洪泛 / DoS
- **问题**：无频率限制、无体积上限 → 单点可打爆消息环或拖垮内存。
- **修复**：
  - 宿主 `/send`：`rateOk`（每节点 5 秒内最多 20 条，超限返回 429）。
  - 中继：`MAX_BODY = 64KB` 的请求体上限（`collectBody`，超限 413 直接丢弃）。
  - 消息环内存上限 500 条（宿主）/ 2000 条（中继）。

### 2.4 敏感内容外泄
- **问题**：违规/违法内容（敏感词、API 密钥、身份证、手机号）可能经 mesh 传播。
- **修复（准确表述）**：宿主在 **写入 outbox 之前**（`acceptLocal`）和 **每次 ingest 时**（`acceptRemote`）都做 DFA + 正则审核。**凡经插件正常发送路径的消息**，违规即被丢弃，不会写入 outbox/中继/消息环，也不会扩散给任何 peer。
- **边界**：直连中继 HTTP `/inject`（局域网攻击者）可绕过此保证，把违规文本塞入中继环——各 peer 的插件在 ingest 时仍会逐条过滤、UI 不显示，但裸 HTTP 读取者/独立中继会看到。这不影响插件 UI 的安全性。
- **补充**：拦截**零体感**（不记录、不展示、发送者无任何提示），见需求「监控页面」。

### 2.5 历史隐私
- **设计**：消息仅存于在线机器内存，无磁盘持久化；节点关闭即清空。

### 2.6 v1.1 红队修复（本轮新增）
- **宿主 POST CSRF / 本地内存 DoS**：`/dsh-chat/*` 所有 POST 现要求 `Content-Type: application/json`（跨域页面只能发 CORS-simple 的 `text/plain`，故被挡）+ 请求体 64KB 上限；`rendezvous` 经 `sanitizeRendezvous` 校验为纯 http(s) URL（剥离空白/CRLF，防 netmode 控制文件行注入）。
- **重复消息风暴**：宿主 `seen` 去重集会话内不再随环淘汰而删除，防止中继保留历史 > 宿主环容量时重复重放；客户端消息数组截断到最近 600 条。
- **标识清洗**：`deviceId`/`nodeId` 统一限为 `[A-Za-z0-9._:-]` 且 ≤64，杜绝换行/特殊字符进入控制文件与 state。
- **relay 一致性**：独立中继 `dshc-relay.js` 补齐 `color`/`deviceId` 的端到端透传，与内嵌 relay 行为对齐（此前两者有漂移）。

## 3. 已评估并接受的残余风险（有意的设计取舍）

> 这些并非漏洞，而是「每台机器都是服务器 + 仅凭 IP:端口 直连」的设计结果，已在 README 明示。

| 风险 | 说明 | 缓解建议 |
|------|------|----------|
| 局域网/公网无鉴权 | 同网段（乃至经 cpolar 的公网）任何设备可调用 `/inject`、`/dsh-chat-relay`、`/health`、`/peers`，读取/注入聊天、伪造身份 | 仅在**可信局域网**启用；**互联网模式 = 把中继暴露给公网**，务必：cpolar 用 Basic Auth、不要把 URL 外传、站点目录不放内网敏感信息 |
| 身份可伪冒 / 目录劫持 | 中继 `/inject` 与站点 `/announce` 均无签名；公网攻击者可伪造 `nodeId` 或覆盖他人目录条目 | 群聊场景可接受；如需强身份，为 `/inject` 与 `/announce` 加共享令牌/HMAC、站点做首次注册绑定 IP |
| mesh SSRF（对不可信公网目录） | `validPeer` 不解析 IP，`127.0.0.1`/`169.254.169.254` 字面量仍可传入；仅影响**主动添加/自己站点目录**来源 | 不接公网不可信 peer；或加 peer 白名单、DNS 解析后校验 |
| 信息暴露（health/peers 泄露 IP/指纹） | `/health`、`/peers` 返回端口、局域网 IP 与稳定机器指纹 `d...`；站点目录公开 | 局域网可接受；公网模式建议去掉 `lanIPs`/指纹回显并加鉴权 |
| 公网隧道明文 | cpolar 免费版是 HTTP，无 TLS | 涉及敏感信息建议 cpolar 付费 TLS / 自建 HTTPS |

## 4. 复测清单

- [ ] `node --check` 通过：`lib/index.js`、`lib/client.js`、`dshc-relay.js`、`workers/rendezvous.js`
- [ ] 发送含 `sk-xxx` / 身份证 / 手机号文本 → 被静默拦截，不出现在任意节点，发送者无提示
- [ ] 跨域页用 `Content-Type: text/plain` POST `/dsh-chat/*` → 返回 400（CSRF 挡）
- [ ] `/dsh-chat/*` POST 超过 64KB body → 返回 400/413
- [ ] 发送含控制字符/超长文本 → 被截断清洗；`deviceId`/`nodeId` 含非法字符 → 被过滤
- [ ] `/peers` 添加 `file://x`、`javascript:alert(1)` → 被 `validPeer` 拒绝
- [ ] 5 秒内连发 20+ 条 → 第 21 条返回 429
- [ ] 长时间大量消息后 UI 不出现重复消息风暴、消息数组有界
- [ ] 关闭群聊/卸载插件 → 中继进程与 cpolar 隧道进程均被 `terminate`

