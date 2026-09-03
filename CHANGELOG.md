# Changelog

本项目版本遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/)。

## [Unreleased] (v1.2.1)

- 内网穿透改为「命令行 + 粘贴公网地址」：不再由插件一键 spawn cpolar（原方案会卡死/权限不足）；用户自己终端跑 `cpolar http 127.0.0.1:39321`，把输出的公网地址粘贴保存即可。
- 互联网模式门控：未设置公网地址前，禁止切到互联网模式、也不访问 Cloudflare；避免仅需局域网的用户浪费请求次数。
- 修复设置页自动闪回：资料草稿只在打开时播种一次（不再每秒被重置）；设置页停用消息轮询刷新。

## [1.2.0] - 2026-09-02

- 固定聊天端口 39321：所有机器一致，局域网扫描与互联网穿透都走它。
- 公网站点改挂 `https://chatroom.iloveljn.cn/machine_list`；Worker 新增 `/bootstrap`(保底)、`/merge`(批量刷新保底目录)、长 TTL、自动剥前缀。
- 去中心化地址表同步：伴生中继局域网 /24 固定端口扫描 + 机器间 ping/MD5 gossip 合并 + cpolar 本地 9200 探测公网地址 + Workers 冷启动/保底刷新。
- cpolar 一键启动改为直接 spawn（修复「点了没反应」）；公网地址由中继探测。
- 模式切换按钮移入聊天页（🏠局域网↔🌐互联网，带动画/图标，自动记忆上次）；发送按钮加锁去抖防重发。
- 设置页去掉「我的设备」「网络模式」卡；昵称分局域网/互联网两类、互联网未开穿透则置灰、保存时当前网络唯一性校验。
- 宿主 netmode/rendezvous 跨重启持久化（`~/.dshc-chatmode.json`）。
- 新增 `docs/DESIGN-v1.2.md`（v1.2 设计定稿）。

## [1.1.0] - 2026-09-02

- 网络模式：局域网(默认) UDP 信标自动发现同网段节点并尝试直连；互联网模式一键 cpolar 穿透 + 上报/拉取公网站点节点目录。
- 公网站点：新增 `workers/rendezvous.js`（Cloudflare Workers + KV 在线节点目录）+ `docs/RENDEZVOUS.md` 部署/协议。
- 稳定机器身份：伴生中继用硬件指纹(hostname+CPU+网卡)派生稳定 node id；成员 `deviceId` 本地同机唯一。
- 设置页：新增网络模式、气泡间距/字距/字号、我的设备(设备ID)。
- UI：面板固定 DeepSeek 白蓝浅色；聊天页只显示消息(去掉节点/中继提示)。
- 红队攻防轮加固：宿主 POST 强制 JSON 且限体 64KB(挡 loopback CSRF/本地 DoS)；`rendezvous` URL 校验防控制文件行注入；
  `deviceId/nodeId` 字符白名单；去重风暴修复(seen 会话内不淘汰 + 客户端数组截断)；独立/内嵌 relay 的 color/deviceId 对齐。
- 更新 `docs/SECURITY.md`(暴露面/残余风险如实重述)、`docs/RENDEZVOUS.md`(站点协议+部署)。

## [1.0.1] - 2026-09-01

### Added
- 主题自适应：面板改用 DSH `--dsw-alias-*` 主题令牌，深色沿用当前配色、日间自动切换为白蓝。
- 成员系统：每台机器分配稳定 `deviceId` + 自动分配**不同颜色头像 + 随机不撞名**（宿主登记去重）。
- 设置页：可编辑昵称与头像颜色，一键保存；新增「成员」页查看在线成员。
- 一键 cpolar 内网穿透：一键安装命令、一键启动/停止，插件自动管理进程、随群聊/插件关闭自动停止。
- `docs/SECURITY.md`：安全审计与加固报告。

### Changed
- 移除「监控」页，违规内容**静默拦截**（不记录、不展示、发送者无提示），不扩散到任何节点。
- 去中心化文案改为「每台机器都是服务器、直接互连(填对方 IP:端口)」，去掉误导性的「中继节点」措辞。

### Fixed
- 修复「✕ 关闭窗口无反应」：面板 open 状态改由模块级共享 store 内部订阅驱动，不再依赖被捕获的 props。
- 修复日间模式下配色不随系统主题变化的问题。
- 安全加固：注入清洗（控制字符/尖括号/长度截断）、peer URL scheme 校验（防 SSRF）、消息限流、请求体 64KB 上限。

## [1.0.0] - 2026-08-30

### Added
- 去中心化 mesh 群聊：每台 DSH 都是服务器 + 客户端，HTTP 拉取式 mesh，按全局 `msgId` 去重。
- 内容监控：内嵌 DFA 敏感词过滤 + 中文词库（拦截/提示两级），离线运行。
- 伴生中继进程 `dshc-relay.js`：绑定 `0.0.0.0`，插件用 `subprocess` 自动拉起，文件 IPC 交换消息。
- 微信/QQ 质感、DeepSeek 官方配色的浏览器 UI（Emoji / 表情包 / Enjoy / 聊天气泡 / 节点管理）。
- 局域网 peer 直连：互填对方 `http://<IP>:<port>` 即可组网。
- 测试脚本 `dshc-relay-test-peer.js`。

### Fixed
- 宿主无 `URL` 全局：中继 query 改为手写解析。
- `subprocess` 需先 `resolveExecutable('node')` 才能拉起中继。
- 插件⇄中继改用文件 IPC，规避 `web.fetch` 被禁用的问题。

## [0.1.0] - 2026-08-XX

### Added
- 早期原型：单机宿主中继房间 + 基础 DFA 审核。
