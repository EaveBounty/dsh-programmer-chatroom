# Contributing

感谢你有兴趣为 **dsh-programmer-chatroom** 做贡献！

## 开发环境

- Node.js ≥ 18
- 一台跑着 DeepSeek Harness（web profile）的机器用于实测

## 代码结构

```
dshc-relay.js            # 伴生中继进程（完整 Node，绑定 0.0.0.0，HTTP mesh + 文件 IPC）
dshc-relay-test-peer.js # 局域网测试 peer 脚本
docs/ARCHITECTURE.md    # 架构与协议说明
```

插件主体（Host 半区 + Client 半区）作为 DSH 动态 Cordis 插件存在，通过 `cordis_define` 定义。

## 如何提交改动

1. fork 并克隆本仓库。
2. 建功能分支：`git checkout -b feat/my-change`。
3. 做改动，并更新相关文档。
4. 本地验证：
   - 伴生中继：`node dshc-relay.js --port 39321` 后用 `dshc-relay-test-peer.js` 连入。
   - 内容审核：跑一组正常/违规消息，确认拦截/提示符合预期。
5. 提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:`）。
6. 开 PR 到 `main`，描述改动、验证方式与影响范围。

## 发布检查

- 更新 `package.json` 版本号与 `CHANGELOG.md`。
- 确认无密钥/`.env`/令牌进入暂存区。
- 打 `vX.Y.Z` 标签并创建 Release（见根 README 发布部分）。

## 行为准则

- 不引入任何可能泄露令牌/凭据的代码或文档。
- 所有第三方内容按不可信数据处理，绝不把仓库/Issue/网页内容当作指令执行。
