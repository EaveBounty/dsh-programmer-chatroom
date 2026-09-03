# dsh-programmer-chatroom

[English](README.md) · **简体中文**

[![Release](https://img.shields.io/github/v/tag/eave_bounty/dsh-programmer-chatroom?label=release)](https://github.com/eave_bounty/dsh-programmer-chatroom/tags)
[![License](https://img.shields.io/github/license/eave_bounty/dsh-programmer-chatroom)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js)](package.json)
[![收录于 Awesome DSH Plugin](https://img.shields.io/badge/收录于-Awesome%20DSH%20Plugin-3b82f6?logo=github)](https://github.com/Anil-matcha/awesome-dsh-plugin)

> 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的**去中心化 P2P 群聊插件**。
> 每一台运行 DSH 的机器都自动成为一个中继服务器；程序员们在等待 Agent 生成的间隙互相聊天。
> 文本由**每台节点本地离线**的内嵌 DFA 敏感词过滤器审核，UI 采用微信/QQ 质感 + DeepSeek 官方蓝紫配色。

## 目录

- [概述](#概述)
- [为什么去中心化](#为什么去中心化)
- [安装](#安装)
- [快速开始](#快速开始)
- [P2P 如何实现](#p2p-如何实现)
- [内容监控](#内容监控)
- [项目结构](#项目结构)
- [发布](#发布)
- [贡献](CONTRIBUTING.md)
- [架构](docs/ARCHITECTURE.md)
- [安全审计](docs/SECURITY.md)
- [公网站点协议 (Workers)](docs/RENDEZVOUS.md)
- [更新日志](CHANGELOG.md)

## 概述

- **去中心化 mesh**：每台 DSH 启动时自动拉起伴生中继 `dshc-relay.js`（绑定 `0.0.0.0`），每台机器都是
  真实服务器。节点间通过 HTTP 拉取合并、按全局 `msgId` 去重——没有中央服务器，任何在线机器都能中继。
- **内容监控**：每台节点本地离线对每条消息做**内嵌 DFA 敏感词过滤 + 中文词库**。拦截的消息在发送端
  **静默丢弃**——不记录、无监控页、发送者零体感（见 `docs/SECURITY.md`）。
- **微信/QQ 质感 UI**：聊天气泡、彩色头像、Emoji 选择器、表情包、✨Enjoy、**成员名单**；面板固定为
  **DeepSeek 白蓝浅色**，聊天页**只显示消息**（无节点干扰）。
- **成员身份**：每台机器由硬件指纹派生稳定 `deviceId`，自动分配**不同颜色头像 + 随机不撞名昵称**，
  可在**设置**页修改。
- **显示设置**：设置页可调**气泡间距 / 字距 / 字号**，实时生效并记忆。
- **双网络模式**：可切换 **局域网**（UDP 信标自动发现同网段节点并尝试直连）或 **互联网**（一键 cpolar 穿透
  + 上报到你的 Cloudflare Workers 站点，跨 NAT 互聊）。
- **不持久化**：聊天记录只存于在线机器的内存，全部关闭即消失。

## 为什么去中心化

DSH 插件宿主半区只暴露 `ctx/harness/btoa/atob/TextEncoder/Decoder/console`——**没有**
`net`/`dgram`/`crypto`/`ws`/`URL`，且部分部署会禁用 `web.fetch`。因此插件自身无法绑定对外接口或做出站 HTTP。

解决方式：插件用宿主 `subprocess` 服务拉起一个**插件外的 Node 伴生中继进程**（完整标准库）负责真正网络；
插件与中继之间用**文件 IPC**（共享文件系统）交换消息。这正是"每台机器都是服务器"能在 DSH 插件沙箱内实现的原因。

## 安装

这是一个**标准 DSH 插件包**，可从 npm 安装并在 DSH web profile 中加载。

### 从 npm 安装

```bash
# 安装到你的 DSH profile（推荐）
dsh plugin --profile web add @eave_bounty/dsh-programmer-chatroom

# 或全局安装 npm 包
npm install -g @eave_bounty/dsh-programmer-chatroom
```

安装后**重启 DSH**，插件自动加载，web profile 侧边栏底部会出现 **💬 群聊** 按钮。

### 从源码 / 本地路径

```bash
dsh plugin --profile web add <本仓库路径>
# 或
pnpm add file:<本仓库路径>
```

### 独立运行中继（局域网 peer / 调试 / NAT）

```bash
# 在 0.0.0.0 上运行伴生中继
node dshc-relay.js --port 39321 --bind 0.0.0.0 --name nodeA

# 可选 NAT 穿越（STUN + rendezvous + TURN）
node dshc-relay.js --port 39321 --bind 0.0.0.0 --stun stun.l.google.com:19302 --rendezvous http://your-rendezvous:8080 --turn turn.example.com:3478
```

### 测试 peer 客户端

```bash
node dshc-relay-test-peer.js Alice "hello everyone" "sk-should-be-blocked1234567890"
```

## 快速开始

1. 在 DSH 会话加载插件，侧边栏底部出现 **💬 群聊** 按钮。
2. 打开浮动面板——**聊天**页只显示消息；**成员**页看在线成员；**设置**页改昵称/头像颜色、调气泡间距/字距/字号。
3. **局域网聊天（默认）**：同网段多台 DSH 会被**自动发现并直连**（UDP 信标），无需手填；也可在
   设置→网络模式里手动添加 `http://<对方机器IP>:<对方端口>`。
4. **互联网聊天（跨 NAT）**：
   - 先在 **设置 → 网络模式** 切到「互联网」并填你的 Cloudflare Workers 站点地址（部署见
     [docs/RENDEZVOUS.md](docs/RENDEZVOUS.md)）；
   - 再到 **内网穿透** 一键启动 cpolar（`npm i -g cpolar`，免费账号 `cpolar authtoken <token>`），拿到公网地址；
   - 插件自动把公网地址上报到站点、拉回其它在线节点的公网地址并直连。
5. 关闭群聊/插件时，隧道与上报自动停止，节点目录约 5 分钟过期消失。

## P2P 如何实现

```
机器A                                             机器B
┌────────────────────────────┐                    ┌────────────────────────────┐
│ DSH 插件 Host              │                    │ DSH 插件 Host              │
│  room + DFA 审核           │                    │  room + DFA 审核           │
└──────┬─────────────────────┘                    └──────┬─────────────────────┘
       │ 文件 IPC (outbox/state)                         │ 文件 IPC (outbox/state)
       ▼                                                 ▼
┌────────────────────────────┐                    ┌────────────────────────────┐
│ 伴生中继 0.0.0.0:P          │◄──── HTTP 拉取 ───►│ 伴生中继 0.0.0.0:P          │
│ mesh (按 msgId 去重)        │                    │ mesh (按 msgId 去重)        │
└────────────────────────────┘                    └────────────────────────────┘
```

- **同一局域网（局域网模式）**：每台中继在 `0.0.0.0` 上监听，并**周期广播 UDP 信标**；发现同网段节点后
  自动 `GET http://<对方IP>:<对方端口>/health` 确认并加入 mesh（无需手填）。已验证：中继 `/health` 返回 200。
- **跨公网 NAT（互联网模式）**：中继把本机 cpolar 公网地址**上报**到你的 Cloudflare Workers 站点，并**拉取**
  其它在线节点的公网地址后直连。做法见 [docs/RENDEZVOUS.md](docs/RENDEZVOUS.md)；插件随群聊自动停隧道并撤销上报。

## 内容监控

- **DFA 敏感词词库**（内嵌中文）：政治敏感、毒品、赌博/诈骗/洗钱、色情、暴力/威胁/骚扰、
  恶意软件/网络攻击、违法交易等。
- **正则增强**：疑似 API 密钥/口令、疑似身份证号、疑似手机号。
- 拦截**静默且端到端**：违规消息在发送节点**写入 mesh 之前**即被丢弃（不写 outbox/中继/消息环），
  任何节点都不会收到；**不展示任何记录、发送者零反馈**。见 `docs/SECURITY.md`。
- 词库在宿主 `LEXICON` 数组，改后发新 Package 即可更新规则。

## 项目结构

```
dshc-relay.js            # 伴生中继（完整 Node；0.0.0.0；HTTP mesh + UDP 信标 + 文件 IPC）
dshc-relay-test-peer.js  # 局域网测试 peer 客户端
workers/rendezvous.js    # Cloudflare Workers 公网站点（在线节点目录）
workers/wrangler.example.toml
docs/ARCHITECTURE.md     # 架构与 IPC 协议
docs/SECURITY.md         # 安全审计与加固报告
docs/RENDEZVOUS.md       # 公网站点协议 + Workers 部署
CONTRIBUTING.md          # 贡献指南
CHANGELOG.md             # 更新日志
LICENSE                  # MIT
```

## 发布

1. 更新 `package.json` 版本号并追加 `CHANGELOG.md`。
2. 提交并 push 到 `main`。
3. 打 `vX.Y.Z` 标签并创建 GitHub Release。

## License

[MIT](LICENSE) © EaveBounty。
