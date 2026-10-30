# ADR-002 覆盖率门槛：领域层 90% + 整体棘轮

状态：已确认（2026-10-30）；整体基线已建立：`docs/decisions/coverage-baseline.txt` = 93（Items 清理后 CI 实测，593 条语句漏 43 条，实际约 92.75%，报告四舍五入为 93）。文件里只能放一个数字，不能加注释，`check-coverage.sh` 会整体读取它。基线只升不降；实际覆盖率四舍五入后低于 93 时 CI 失败。

## 背景
模板 CI 对整个后端使用 `coverage report --fail-under=90`。删除 Items 示例并加入业务代码后，整体比例会变化，且模板自带若干与本项目无关的模块（如邮件、Sentry、private 路由）拉低或扭曲数字。我没有在无数据库的环境里跑出真实覆盖率，所以此处不凭空设数字。

## 决定
1. **领域层**（`backend/app/domain/`，约束、证据匹配、合规规则、评分、提示词装配）：行覆盖率 **≥ 90%**，CI 单独检查：`coverage report --include="app/domain/*" --fail-under=90`。理由：这是纯逻辑，可在没有数据库和模型的情况下充分测试，也是评审重点。
2. **整体**：采用**棘轮**——A 在 Phase 0 清理 Items 示例后实测一次，把数值记入 `docs/decisions/coverage-baseline.txt`；CI 要求整体覆盖率**不低于该基线**；基线只升不降。
3. 与本项目无关的模板模块若要排除，须在 `pyproject.toml` 的 `[tool.coverage.run] omit` 中**逐项列出并说明理由**，不得用通配符大范围排除。
4. 不得为通过 CI 临时降低门槛或删除断言；调整须双方在 PR 中同意并更新本文件。
5. 前端不设覆盖率门槛，以第 10 章的 Playwright 用例（TC-F01–F10 等）为准。
6. 新增检查用例：TC-C07。

## 影响
- 同步修改模板的 test-backend workflow：去掉固定的 `--fail-under=90`，改为上述两条检查。
- 待办（A，Phase 0 退出条件之一）：实测并记录基线数值。
