# Changelog

本项目版本遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

- 跨公网 NAT：伴生中继 STUN 打洞 + TURN 备选（规划中）。

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
