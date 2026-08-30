# v1.0.0

**去中心化 P2P 群聊插件 for DeepSeek Harness** — 首个正式版本。

## ✨ 新增

- **去中心化 mesh 群聊**：每台 DSH 都是服务器 + 客户端，HTTP 拉取式 mesh，按全局 `msgId` 去重；任何在线机器都能中继，无中央服务器。
- **标准 DSH 插件包**：`lib/index.js`（宿主，ESM Cordis 插件）+ `lib/client.js`（浏览器，微信/QQ 质感 UI），`cordis.patch.yml` + `dsh` 清单，可从 npm / GitHub 安装。
- **内容监控**：内嵌 DFA 敏感词过滤 + 中文词库（拦截/提示两级），本地离线运行。
- **伴生中继进程** `dshc-relay.js`：绑定 `0.0.0.0`，插件用 `subprocess` 自动拉起，文件 IPC 交换消息（规避 `web.fetch` 禁用）。
- **NAT 穿越**：STUN 探测 + UDP 打洞 + TURN 配置 + rendezvous 通告（完整 Node，尽力而为、可配置）。
- **微信/QQ 质感 UI**：Emoji / 表情包 / ✨Enjoy / 聊天气泡 / 节点管理。
- **发布 npm**：`@eave_bounty/dsh-programmer-chatroom`。

## 🐛 修复

- 宿主无 `URL` 全局：query 手写解析。
- `subprocess` 需先 `resolveExecutable('node')`。
- 插件⇄中继改用文件 IPC，规避 `web.fetch` 禁用。
- 移除错误的 `@deepseek-ai/cordis` peer 依赖（DSH 运行时提供）。

## 📦 安装

```bash
dsh plugin --profile web add @eave_bounty/dsh-programmer-chatroom
```

## 🔧 测试 peer

```bash
node dshc-relay-test-peer.js Alice "hello everyone" "sk-should-be-blocked1234567890"
```
