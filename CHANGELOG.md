# Changelog

本项目版本遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

- 跨公网 NAT：伴生中继 STUN 打洞 + TURN 备选（规划中）。

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
