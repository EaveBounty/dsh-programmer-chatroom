# Release Checks

每次发版前按此清单核对。

- [ ] 更新 `package.json` 版本号（SemVer）。
- [ ] 追加 `CHANGELOG.md` 记录（Keep a Changelog 格式）。
- [ ] 本地验证伴生中继可用：`node dshc-relay.js --port <P> --bind 0.0.0.0` + 测试 peer 连入。
- [ ] 确认内容审核对正常/违规消息的拦截与提示符合预期。
- [ ] 扫描暂存区无密钥 / `.env` / 令牌（`git diff --cached` 检查）。
- [ ] commit 到 `main`，打 `vX.Y.Z` 标签。
- [ ] 创建 GitHub Release，附 release notes 与测试 peer 使用说明。

> 安全铁律：发布是线上写操作，任何 push / 建标签 / 建 Release 都须先向用户详细汇报并获明确批准；
> 破坏性操作（force push、删标签/Release）需二次确认。
