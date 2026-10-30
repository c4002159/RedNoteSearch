# ADR-009 main 分支保护：不要求他人批准

状态：已确认（2026-10-30）。替代技术文档 8.3 至 8.5、协作手册、`AI_TEAM_GUIDE.md` 中“合并须获另一位成员批准”的说法。

## 背景
最初的方案要求每个 PR 经另一位成员批准才能合并（作者不能自批，管理员也不能绕过），目的是让契约、迁移、品牌授权、检索过滤等改动至少有两个人看过。启用保护时，项目负责人决定**不启用“另一人批准”**。

## 决定
`main` 当前实际生效的保护（2026-10-30 读回确认）：

| 项 | 设置 |
|---|---|
| 必须通过 PR 才能合并 | 开 |
| 需要他人批准 | **关**（批准人数 0，代码所有者审查关） |
| 必选检查 | `pre-commit-alls-green`、`alls-green-playwright`、`test-backend`、`test-docker-compose`、`migrations`、`contract`、`frontend-build`、`forbidden-wording`、`secrets-scan`、`Run zizmor` |
| 分支需与 main 同步（strict） | 开 |
| 管理员也不能绕过 | 开 |
| 线性历史、处理完全部评论 | 开 |
| 禁止强推、禁止删除 main | 开 |
| 合并方式 | 仅 Squash；合并后自动删除分支 |
| 仓库级允许自动合并 | 开（为 PR #5 的自动合并而开；是否对某个 PR 使用由负责人决定） |

## 影响与风险
- 作者可以自己合并自己的 PR：“进 main 的东西至少能跑”仍由必选检查保证，但**不再有人工审查这一道**。
- 之前靠“另一人批准”保证的事（契约、迁移、认证与品牌授权、检索过滤、提示词与合规规则、CI、依赖锁）改靠约定：
  1. 作者在 PR 描述里写明影响范围（模板已有对应栏目）；
  2. 涉及上述敏感路径的 PR，**作者在合并前在 PR 评论里 @ 对方，等对方回复确认**（GitHub 不强制）；
  3. `.github/CODEOWNERS` 保留，只用于自动请求对方审查，不再作为合并条件。
- AI 助手同样遵守第 2 条：改敏感路径时提醒作者去 @ 对方，不得因为“没有强制批准”而跳过。

## 如何恢复
想重新要求他人批准，把批准人数设回 1 并开启代码所有者审查：

```bash
gh api -X PATCH repos/c4002159/RedNoteSearch/branches/main/protection/required_pull_request_reviews \
  -F required_approving_review_count=1 -F require_code_owner_reviews=true -F dismiss_stale_reviews=true
```

恢复后，作者不能自批，必须由另一位成员批准；若只有一人可用，会被卡住，因为管理员也不能绕过。

## 相关
- 测试用例 TC-C06（原“敏感路径双人审查”）随之调整，见 `docs/TEST_CASES.csv`。
- 外部文件（技术文档 Word、协作手册 Word）里的旧说法以本决定为准。
