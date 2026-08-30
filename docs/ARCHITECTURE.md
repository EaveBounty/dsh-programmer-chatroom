# Architecture

> 本文档面向维护者与希望理解内部机制的读者。端到端拓扑、文件 IPC 协议、DFA 审核与跨网 NAT 规划见下。

## 为什么需要伴生中继进程

DeepSeek Harness 动态插件宿主半区只暴露以下能力：

```
ctx · harness · btoa/atob · TextEncoder/TextDecoder · console
```

它**没有** `net`、`dgram`、`crypto`、`ws`、`URL`，且部分部署会禁用 `web.fetch`（无 fetch provider）。
因此插件自身无法：绑定 `0.0.0.0` 对外服务、发起出站 HTTP、做 NAT 穿越。

解决方式：插件用宿主 `subprocess` 服务自动拉起一个**插件外的 Node 伴生中继进程**
（完整 Node 标准库），由它负责真正的网络。插件与中继之间用**文件 IPC**（共享文件系统）交换消息。

## 拓扑

```
机器A                                             机器B
┌────────────────────────────┐                    ┌────────────────────────────┐
│ DSH 插件 Host              │                    │ DSH 插件 Host              │
│  · 内存 room               │                    │  · 内存 room               │
│  · DFA 审核                │                    │  · DFA 审核                │
│  · harness.handle RPC      │                    │  · harness.handle RPC      │
└──────┬─────────────────────┘                    └──────┬─────────────────────┘
       │ 文件 IPC (outbox/state)                         │ 文件 IPC (outbox/state)
       ▼                                                 ▼
┌────────────────────────────┐                    ┌────────────────────────────┐
│ 伴生中继 dshc-relay.js      │                    │ 伴生中继 dshc-relay.js      │
│  绑定 0.0.0.0:<port>        │◄───── HTTP 拉取 ──►│  绑定 0.0.0.0:<port>        │
│  GET /dsh-chat-relay        │    mesh（按 msgId  │  GET /dsh-chat-relay        │
│  POST /peers /inject        │      去重）        │  POST /peers /inject        │
│  GET /health                │                    │  GET /health                │
└────────────────────────────┘                    └────────────────────────────┘
```

- 每台 DSH 都是**服务器**（对外提供中继）+ **客户端**（轮询 peer），没有中央节点。
- 只要有一台在线，其它在线节点轮询它即可拿到聊天记录。
- 记录只存内存，机器全部关闭即消失（不持久化）。

## 文件 IPC 协议

| 文件 | 写入者 | 读取者 | 内容 |
| --- | --- | --- | --- |
| `outbox.ndjson` | 插件 | 中继 | 每行一条 `{msgId,nodeId,nick,text,ts}`，插件产生的本地消息 |
| `state.json` | 中继 | 插件 | `{nodeId,messages,lastIdx,peers,lanIPs}` 合并后的状态 |
| `peers.txt` | 插件 | 中继 | 每行一个 peer base URL |

中继的轮询循环：`readPeersFile → drainOutbox → 拉取 peer → writeState`（2s 间隔）。

## 内容审核（DFA）

宿主对每条消息做 DFA 敏感词过滤（内嵌中文词库）+ 正则增强：
- 拦截（不入房）：敏感词、疑似 API 密钥、疑似身份证号
- 提示（放行但记录）：疑似手机号

详见根 `README.md` 的「内容监控」。

## 跨公网 NAT（规划）

伴生中继是完整 Node，具备做 NAT 穿越的能力。跨不同 NAT/公网需：
1. **STUN**：向公共 STUN 服务器查询公网地址映射。
2. **TCP/UDP 打洞**：通过 rendezvous 交换候选地址后互相打洞。
3. **TURN 备选**：打洞失败时经公共中继转发。

中继已预留 `--peer` / `--peers-file` 扩展点。真正跨网还需配一个公网 rendezvous/TURN 地址，属于后续增强项。
