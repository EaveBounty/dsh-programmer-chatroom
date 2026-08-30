# dsh-programmer-chatroom

**English** · [简体中文](README.zh.md)

[![Release](https://img.shields.io/github/v/tag/eave_bounty/dsh-programmer-chatroom?label=release)](https://github.com/eave_bounty/dsh-programmer-chatroom/tags)
[![License](https://img.shields.io/github/license/eave_bounty/dsh-programmer-chatroom)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js)](package.json)
[![Included in Awesome DSH Plugin](https://img.shields.io/badge/Included%20in-Awesome%20DSH%20Plugin-3b82f6?logo=github)](https://github.com/Anil-matcha/awesome-dsh-plugin)

> A **decentralized P2P group chat** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
> Every machine running DSH becomes a relay server; developers chat while their agents are busy generating.
> Text is moderated **offline on each node** by an embedded DFA sensitive-word filter, and the UI follows
> WeChat/QQ quality with DeepSeek's official blue-purple branding.

## Contents

- [Overview](#overview)
- [Why decentralized?](#why-decentralized)
- [Install](#install)
- [Quick start](#quick-start)
- [How P2P works](#how-p2p-works)
- [Content moderation](#content-moderation)
- [Project layout](#project-layout)
- [Release](#release)
- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security audit](docs/SECURITY.md)
- [Changelog](CHANGELOG.md)

## Overview

- **Decentralized mesh**: each DSH instance auto-spawns a companion relay (`dshc-relay.js`) bound to
  `0.0.0.0`, making every machine a real server. Nodes pull/merge messages over HTTP with global `msgId`
  dedup — no central server, any online machine can relay.
- **Content moderation**: every node filters each message offline with an embedded **DFA sensitive-word
  filter + Chinese lexicon**. Blocked messages never enter the room and are dropped **silently** — no
  records, no monitoring page, zero perceptible feedback (see `docs/SECURITY.md`).
- **WeChat/QQ-style UI**: chat bubbles, colored avatars, emoji picker, sticker pack, an ✨ Enjoy button,
  live peer-node management, and a **member roster**.
- **Theme-aware**: the panel reads the shell's `--dsw-alias-*` tokens, so it follows DeepSeek's dark/light
  appearance automatically (dark → current palette, light → white/blue).
- **Member identity**: each machine gets a stable deviceId with an **auto-assigned unique avatar color and
  random, collision-avoided nickname**; editable in the **Settings** tab.
- **One-click cpolar tunnel**: install command + start/stop inside the Settings tab; the plugin manages
  the process and stops it automatically when the chat/plugin closes.
- **No persistence**: history lives only in the memory of online machines; it disappears when all are off.

## Why decentralized?

The DSH plugin Host half exposes only `ctx/harness/btoa/atob/TextEncoder/Decoder/console` — **no**
`net`/`dgram`/`crypto`/`ws`/`URL`, and some deployments disable `web.fetch`. So the plugin cannot bind a
public interface or make outbound HTTP itself.

The fix: the plugin uses the host `subprocess` service to spawn an **external Node companion relay**
(full stdlib), which does the real networking. The plugin and relay exchange messages over **file IPC**
(shared filesystem). This is what makes "every machine is a server" achievable inside the DSH plugin sandbox.

## Install

This is a **standard DSH plugin package**, installable from npm and loadable in a DSH web profile.

### From npm

```bash
# install into your DSH profile (recommended)
dsh plugin --profile web add @eave_bounty/dsh-programmer-chatroom

# or install the npm package globally
npm install -g @eave_bounty/dsh-programmer-chatroom
```

After installing, **restart DSH** — the plugin loads automatically and a **💬 Chat** button appears in the
sidebar footer of your web profile.

### From source / local path

```bash
dsh plugin --profile web add <path-to-this-repo>
# or
pnpm add file:<path-to-this-repo>
```

### Standalone relay (LAN peers / debugging / NAT)

```bash
# run the companion relay on 0.0.0.0
node dshc-relay.js --port 39321 --bind 0.0.0.0 --name nodeA

# optional NAT traversal (STUN + rendezvous + TURN)
node dshc-relay.js --port 39321 --bind 0.0.0.0 --stun stun.l.google.com:19302 --rendezvous http://your-rendezvous:8080 --turn turn.example.com:3478
```

### Test peer client

```bash
node dshc-relay-test-peer.js Alice "hello everyone" "sk-should-be-blocked1234567890"
```

## Quick start

1. Load the plugin in a DSH session; a **💬 Chat** button appears in the sidebar footer.
2. Open the floating panel — the top bar shows **🟢 Companion relay enabled · port**.
3. **Chat** tab: read/write messages (Enter to send), manage peer nodes.
   **Members** tab: see who is online. **Settings** tab: edit your nickname/avatar color, and one-click
   start/stop the cpolar tunnel.
4. To mesh with another DSH instance: in **已连接的节点**, enter
   `http://<other-machine-IP>:<other-port>` → **Add node**. Add each other mutually.
5. Across NAT: open the **Settings** tab → **内网穿透** → install cpolar (`npm i -g cpolar`, free account
   `cpolar authtoken <token>`) → **一键启动穿透**. Share the resulting public URL with remote machines;
   the tunnel stops automatically when the chat/plugin closes.

## How P2P works

```
Machine A                                            Machine B
┌────────────────────────────┐                      ┌────────────────────────────┐
│ DSH plugin Host            │                      │ DSH plugin Host            │
│  room + DFA moderation     │                      │  room + DFA moderation     │
└──────┬─────────────────────┘                      └──────┬─────────────────────┘
       │ file IPC (outbox/state)                          │ file IPC (outbox/state)
       ▼                                                  ▼
┌────────────────────────────┐                      ┌────────────────────────────┐
│ companion relay 0.0.0.0:P  │◄──── HTTP pull ─────►│ companion relay 0.0.0.0:P  │
│ mesh (msgId dedup)         │                      │ mesh (msgId dedup)         │
└────────────────────────────┘                      └────────────────────────────┘
```

- **Same LAN**: both relays bind `0.0.0.0`; each side fills the other's LAN IP. Verified: the plugin
  spawns a relay reachable at `http://<machine-IP>:<port>/health` → 200.
- **Across NAT / public internet**: the relay has STUN hole-punching + TURN/rendezvous hooks, but the
  **recommended one-click path is cpolar**: start a tunnel to `127.0.0.1:<relayPort>` from the Settings
  tab, share the public URL, and remote machines add it as a peer node. The plugin auto-stops the tunnel
  with the chat.

## Content moderation

- **DFA sensitive-word lexicon** (embedded Chinese): politics, drugs, gambling/fraud/money-laundering,
  porn, violence/harassment, malware/attacks, illegal trading.
- **Regex augmentation**: API keys/secrets, ID-card numbers, phone numbers.
- Blocking is **silent and end-to-end**: a blocked message is dropped on the sending node **before** it
  can reach any peer (never written to outbox/relay/mesh), and no record is exposed anywhere — no
  monitoring page, no sender feedback. See `docs/SECURITY.md`.
- Edit the `LEXICON` array in the Host half and publish a new Package to change rules.

## Project layout

```
dshc-relay.js            # companion relay (full Node; binds 0.0.0.0; HTTP mesh + file IPC)
dshc-relay-test-peer.js  # LAN test peer client
docs/ARCHITECTURE.md     # architecture & IPC protocol
CONTRIBUTING.md          # contribution guide
CHANGELOG.md             # version history
LICENSE                  # MIT
```

## Release

1. Bump `package.json` and add a `CHANGELOG.md` entry.
2. Commit and push to `main`.
3. Tag `vX.Y.Z` and create a GitHub Release with release notes.

## License

[MIT](LICENSE) © EaveBounty.

## 修改日志

- 2026-08-20 修复启动失败：`lib/index.js` 直接访问 `ctx.harness` 但未在 `inject` 声明，Cordis 严格代理抛「cannot get property "harness" without inject」。改为 `ctx.get('harness')` 可选访问（服务不存在时返回 undefined、不等待），harness.handle RPC 集成保持可选。
- 2026-08-20 修复客户端加载失败：`lib/client.js` 的 `apply` 里 `ctx.styles` 未在 inject 声明，客户端模块加载时抛「cannot get property "styles" without inject」。移除该访问（CSS 已有 `document` 注入回退），客户端正常注册。