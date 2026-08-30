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
- [更新日志](CHANGELOG.md)

## 概述

- **去中心化 mesh**：每台 DSH 启动时自动拉起伴生中继 `dshc-relay.js`（绑定 `0.0.0.0`），每台机器都是
  真实服务器。节点间通过 HTTP 拉取合并、按全局 `msgId` 去重——没有中央服务器，任何在线机器都能中继。
- **内容监控**：每台节点本地离线对每条消息做**内嵌 DFA 敏感词过滤 + 中文词库**。拦截的消息不入房
  只进日志；提示的消息放行但记录。
- **微信/QQ 质感 UI**：聊天气泡、彩色头像、Emoji 选择器、表情包、✨Enjoy 按钮、在线节点管理。
- **不持久化**：聊天记录只存于在线机器的内存，全部关闭即消失。

## 为什么去中心化

DSH 插件宿主半区只暴露 `ctx/harness/btoa/atob/TextEncoder/Decoder/console`——**没有**
`net`/`dgram`/`crypto`/`ws`/`URL`，且部分部署会禁用 `web.fetch`。因此插件自身无法绑定对外接口或做出站 HTTP。

解决方式：插件用宿主 `subprocess` 服务拉起一个**插件外的 Node 伴生中继进程**（完整标准库）负责真正网络；
插件与中继之间用**文件 IPC**（共享文件系统）交换消息。这正是"每台机器都是服务器"能在 DSH 插件沙箱内实现的原因。

## 安装

聊天插件以动态 Cordis 插件形式定义（`cordis_define`），中继是纯 Node 脚本。在 DSH 会话中加载插件包后，
插件会通过宿主 `subprocess` 自动拉起中继。

独立运行中继（局域网 peer / 调试）：

```bash
node dshc-relay.js --port 39321 --bind 0.0.0.0 --name nodeA
```

测试 peer 客户端：

```bash
node dshc-relay-test-peer.js Alice "hello everyone" "sk-should-be-blocked1234567890"
```

## 快速开始

1. 在 DSH 会话加载插件，侧边栏底部出现 **💬 群聊** 按钮。
2. 打开浮动面板——顶部显示 **🟢 伴生中继已启用 · 端口**。
3. **聊天**页：收发消息（Enter 发送）、管理节点；**监控**页：查看拦截/提示记录与原因。
4. 与另一台 DSH 互通：在**已连接中继节点**里填 `http://<对方机器IP>:<对方端口>` → **添加节点**，
   双方互相添加即可双向 mesh。

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

- **同一局域网**：两台中继都绑 `0.0.0.0`，互填对方局域网 IP。已验证：插件拉起的中继在
  `http://<本机IP>:<端口>/health` 返回 200。
- **跨公网 NAT**：需中继做 STUN 打洞 + 备选 TURN。中继已预留 `--peer`/`--peers-file` 扩展点；
  真正跨网需配公网 rendezvous/TURN 地址，属后续增强项。

## 内容监控

- **DFA 敏感词词库**（内嵌中文）：政治敏感、毒品、赌博/诈骗/洗钱、色情、暴力/威胁/骚扰、
  恶意软件/网络攻击、违法交易等。
- **正则增强**：疑似 API 密钥/口令、疑似身份证号、疑似手机号。
- 拦截不入房；提示放行但记录。词库在宿主 `LEXICON` 数组，改后发新 Package 即可更新规则。

## 项目结构

```
dshc-relay.js            # 伴生中继（完整 Node；绑定 0.0.0.0；HTTP mesh + 文件 IPC）
dshc-relay-test-peer.js  # 局域网测试 peer 客户端
docs/ARCHITECTURE.md     # 架构与 IPC 协议
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
