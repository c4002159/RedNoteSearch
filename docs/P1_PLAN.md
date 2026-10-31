# P1 计划与契约写作指引（F12、F13、F14）

2026-11-01 由 A 的 AI 助手起草，交给接手的 AI 执行。A 已决定做 **F12 任务文件输入、F13 爆款结构分析、F14 品牌串味测试**；**F15 多模型成本对比不做**。先读 `docs/HANDOFF.md`（流程、红线、环境），再读本文件。本文件里的“草案”是建议，不是已定的契约；你写契约时可以改，但要在 PR 描述里说明理由。

## 1. 顺序和交付方式

按 **F12 → F14 → F13** 做。每一项两个 PR，**先契约后实现**，不要合在一起：

| PR | 分支名 | 只允许改 | 目的 |
|---|---|---|---|
| 契约 PR | `docs/a-p1-f12-contract`（f14、f13 同理） | `docs/API_CONTRACT.md`、`docs/TEST_CASES.csv`；需要时加一个 ADR | 让 A 和 B 在写代码前审字段 |
| 实现 PR | `feat/a-p1-f12`（同理） | 后端代码、迁移、测试、重新生成的前端客户端、契约里的“实现约定” | 契约合并后才开 |

**上传到哪里让我审**：就是在 GitHub 仓库 `c4002159/RedNoteSearch` 里开契约 PR（目标分支 `main`）。PR 标题以 `contract(F12):` 开头；描述按 `AI_TEAM_GUIDE.md` 的自检模板写；在 PR 评论里 @CHNERUI（他是前端，要对字段）并 @c4002159。把 PR 链接告诉 A，A 会把它转给我（或我用 `gh pr view <编号> --comments` 自己看）。**契约 PR 没有被 A 在评论里确认之前，不要开实现 PR，也不要合并契约 PR。**

## 2. 契约怎么写（照现有风格）

在 `docs/API_CONTRACT.md` 里：
1. 把第 10 节“P1 接口（占位）”里对应条目改成正式小节，放进合适的章节（F12 放第 5 节任务附近，F14 放第 7 节评测，F13 单独一节），并把第 10 节里已完成的占位删掉。
2. 每个接口写清：方法与路径、谁能调（品牌成员 / 品牌 admin / 平台管理员）、请求体 JSON 样例、响应样例与状态码、全部错误（用统一信封的错误码，见第 1.1 节）、幂等要求、字段取值范围。
3. 单独写一段“实现约定”：状态流转、限额、什么时候 409 `INVALID_STATE`、哪些东西只增不改、写哪些审计、跨品牌访问怎么处理（路径带品牌 403；按资源 id 访问 404）。
4. 已有字段的含义不改，只增字段；不动 `docs/decisions/` 已确认的决定，需要改就写新的 ADR（编号接 ADR-010 之后）。
5. 在 `docs/TEST_CASES.csv` 最后一行之后新增用例（接 TC-126 起，列与现有行一致：成功、校验错误、401、越权、跨品牌、失败恢复各至少一条）。
6. 写完在第 12 节“变更记录”加一行。
7. **措辞红线**：任何接口说明里不得把结果说成“合规通过”“已验证事实”“法务批准”。

## 3. 各功能的草案（要点与待定项）

### F12 任务文件输入
**已有的**：`parse_document(filename, bytes)`（PDF/DOCX/MD/TXT/CSV，按类型限额 50 MB / 5 MB，错误 `FILE_TOO_LARGE`、`UNSUPPORTED_FILE_TYPE`、`PARSE_FAILED`），`DbTaskInputRepository.create_snapshot`（分块并嵌入，全有或全无，快照只增不改），检索会把任务资料标为 `source_level = task_material`、未经审核。
**草案**：
- `POST /tasks` 保持 JSON 不变（粘贴文本继续用 `task_materials`）。新增 `POST /tasks/{task_id}/materials`（品牌成员，multipart，字段 `file`），解析成文本后存成任务资料快照。
- 只允许任务在 `queued` 时上传，否则 409 `INVALID_STATE`；每个任务的资料总数（粘贴加文件）≤5 份，解析后文本每份 ≤50000 字（超出 422，建议新错误码 `MATERIAL_TOO_LONG`，`details` 给出实际字数和上限）。
- 原始文件**不保存**，只存解析后的文本、文件名和 `content_hash`；不进知识库索引，不影响其他任务和其他品牌。
- 响应 201：`{"id":"<snapshot_id>","filename","char_count","content_hash","created_at"}`；同时加 `GET /tasks/{task_id}/materials` 列出（不返回全文，只返回元数据和 200 字摘录）。
- 嵌入模型不可用返回 503 且什么都不留（和现在一致）；写 `task.material_add` 审计，`detail` 只含文件名和字数。
**待 A 定**：上传错了能不能删。快照按规则“只增不改”，草案不提供删除，要换就新建任务。若 A 要删除，需要先写 ADR 说明例外。

### F14 品牌串味测试
**已有的**：评测框架（版本固定的评测集、`group_id`/`version`/`content_hash`、运行、按系统分组的指标、无综合分）；`brand_leak` 类型已在枚举和数据库约束里，服务层目前返回 422“后续功能”（`backend/app/services/evaluation.py` 两处）；技术文档 F14：先做**跨品牌检索拒绝**与**固定串味集**，RLS 视时间。
**草案**：
- 评测集 `kind = brand_leak`，必须带 `brand_id`（全局评测集 422）。样本：`input` 同生成类（`product_name`、`scene_name`，可选 `brief` 等），再加 `input.distractor_brand`（一个“别家品牌”的名字，被放进诱导性的 `brief`，例如要求参考它）；`expected.foreign_terms`：别家品牌独有的词（品牌名、产品名、口号），用代码做字符串匹配判定。
- 指标（定义写进响应）：`leak_rate`（输出含任一 `foreign_terms` 的样本占比，越低越好）、`retrieval_leak_count`（检索结果里属于其他品牌的分块数，**必须为 0**）、`constraint_pass_rate`。不要用模型当裁判，不要合成总分。
- 额外加一个**不调用模型**的检查：对运行品牌的每条样本，直接调用检索并断言返回的分块都属于该品牌（`brand_id` 一致），否则该样本记为失败并计入 `retrieval_leak_count`。
- 权限与评测其他类型一致（品牌 admin），基线：`generation` 类同样没有基线。
- 实现要改的地方：`services/evaluation.py` 的两处 422、样本校验、`evaluation_runner.py` 新增分支、指标放 `domain/evaluation/metrics.py`（纯函数，领域层覆盖率 ≥90%）。
**待 A 定**：`foreign_terms` 由谁维护（草案：评测集里手写，演示种子里放一组占位的假品牌词，标【演示数据】）。

### F13 爆款结构分析
**已有的**：什么都没有（契约只有第 10 节的路径占位，技术文档里有表名 `viral_sample`、`viral_pattern`）。
**草案**：
- `POST /brands/{brand_id}/viral-samples`（品牌成员）：`{"text","note?","source_url?"}`，`text` ≤5000 字；`source_url` 只当文本存，**系统不访问它、不爬取**。`GET /brands/{brand_id}/viral-samples`（分页）。样本只属于所在品牌，不进知识库、不被检索。
- `POST /viral-samples/{id}/analyze`（按资源 id，非成员 404，支持幂等）：用模型提取结构，保存 `viral_pattern`：`title_pattern`、`hook_type`、`paragraph_structure`（有序条目）、`tone`、`emoji_usage`、`hashtag_usage`、`abstract_template`（抽象模板，用占位符不用原句）。模型输出要过 pydantic 校验；失败走和生成一致的显式错误状态（503 / `invalid_model_output`）。
- **不复刻原文**，用代码检查：`abstract_template` 与样本之间不得出现连续 12 个及以上相同字符，违反的模式不保存并标记失败重试一次。
- `POST /viral-patterns/{id}/to-template`（品牌 admin）：把模式转成该品牌下的场景模板（`scenario`，`brand_id` 设为该品牌，`template_version` 从 1 开始），返回新模板 id。
- 每次模型调用写 `llm_call_log`；写审计 `viral.analyze`、`viral.to_template`。
- 新表和迁移：`viral_sample`、`viral_pattern`；`down_revision` 用当时唯一的 head（现在是 `f2c0e6b8d4a1`，开工前再 `alembic heads` 核对）。
**待 A 定**：样本有没有保留期限；`to-template` 是否要求 admin（草案是）。

## 4. 实现 PR 的验收（我审的时候会按这个看）

- 契约和代码一致：路径、字段、状态码、错误码逐条对得上；`bash scripts/generate-client.sh` 后 `frontend/src/client` 已提交，`git diff` 里没有手改。
- 测试：成功、校验错误、401、403/404、跨品牌访问、失败恢复（模型不可用不留半成品）。**不删除或放宽已有测试**；全部测试仍通过，覆盖率不低于基线 93，领域层 ≥90。
- `alembic heads` 只有一个，`alembic check` 干净，迁移能从空库跑，带 `downgrade`。
- ruff、ruff format、mypy、ty 全部干净；CI 全绿后再合并。
- PR 描述如实写跑过什么、没跑什么（真实模型的检查不要在 CI 里跑）。
- 没有任何“合规通过”“已验证事实”之类措辞；密钥、`.env` 没进仓库。

## 5. 审核方式

契约 PR 我会逐条对照第 2 节和上面的草案看：字段是否够前端画界面、权限和隔离是否漏、错误是否都有码、有没有改动已有含义、测试用例是否覆盖。有问题我在 PR 里评论，你修改后在评论里回复“已改”，不要新开 PR。B（CHNERUI）对前端字段的意见同样在 PR 评论里回应。A 在评论里确认以后才能合并。

## 6. 附加任务：合规规则批量导入与导出（A 已要求，必做，不属于 F12–F14）

目的：客户的法务拿到确认过的词表后，要能一次性导入、整体替换、下载现有规则离线修改再导入，而不是在界面里一条条录入。演示时这是“留给客户可更改的地方”的核心。顺序：F12、F14、F13 之后做；契约先行，同样走“契约 PR → A 确认 → 实现 PR”。

**契约草案（要点，由你展开写）**
- 接口：`POST /compliance-rules/import`（全局规则，仅平台管理员）和 `POST /brands/{brand_id}/compliance-rules/import`（品牌规则，仅该品牌 admin）；`GET /compliance-rules/export?format=csv|json` 和 `GET /brands/{brand_id}/compliance-rules/export`（同权限；包含停用的规则；CSV 带表头，可当模板用）；`GET /compliance-rules/import-template`（空模板含一行示例，示例行要标明“示例，请删除”）。
- 导入请求：multipart `file`（`.csv` 或 `.json`，≤1 MB、≤2000 行），查询参数 `mode=merge|replace`（默认 `merge`）和 `dry_run=true|false`（**默认 `true`**，先预览再提交）。
- 字段与单条创建接口完全一致（`layer`、`rule_type`、`severity`、`pattern`、`is_regex`、`suggestion`、`source_name`、`source_url`、`source_clause`、`region_scope`、`effective_from`、`effective_to`、`enabled`）；必填是 `layer`、`rule_type`、`severity`、`pattern`。`layer = context` 不能导入（由模型判断）。**导入的规则不会自动标成示例，也不会自动补来源**：来源为空就保持为空，界面显示“来源待补充”，不要编造。
- 匹配键：同一范围内 `(layer, rule_type, pattern)` 相同视为同一条。`merge`：存在则更新（有变化才 `rule_version` +1，无变化记 `unchanged`），不存在则新建，文件里没有的规则不动。`replace`：在 `merge` 的基础上，把该范围内**文件里没有的启用中的规则设为停用（`enabled=false`）**，绝不物理删除，历史提示不受影响；示例规则同样被停用，不是删除。
- 校验：每行走和单条创建相同的校验（正则安全检查、长度、枚举、日期先后）。**全有或全无**：只要有一行不合法，整个文件拒绝，返回 422 `VALIDATION_ERROR`，`details.errors` 给出行号（从 1 开始，不含表头）、列名、原因；文件内重复键也算错误。`dry_run=true` 时什么都不写，返回同样的汇总和逐行错误。
- 编码：CSV 先按 UTF-8（带或不带 BOM）解码，失败再试 GBK（中文 Excel 另存的 CSV 常见），都失败返回 422 `UNSUPPORTED_FILE_TYPE` 或 `PARSE_FAILED`（沿用现有错误码，写清）。
- 响应：`{"dry_run":bool,"mode":"merge|replace","created":n,"updated":n,"unchanged":n,"disabled":n,"errors":[…]}`，成功 200（`dry_run=false` 也是 200，不是 201）。
- 审计：`compliance.import`，`detail` 只含范围、模式、四个计数、文件名，不含规则全文。写入在一个事务里。
- 并发：同一范围的并发导入用行锁或咨询锁串行化，后到的等待，不交叉写。
- 权限：平台管理员不是品牌数据的万能钥匙，导入品牌规则必须是该品牌 admin；非成员 403（路径带品牌）；没有 `GET` 以外的越权出口。
- 不得出现“合规通过”“法务批准”等措辞；响应和界面文案说“风险提示规则”。
- 用例（接在现有最后一个 TC 之后）：dry_run 不写入；merge 新建、更新、无变化；replace 停用文件外的规则且不物理删除；任一行非法整体拒绝并给行号；文件内重复键；GBK 的 CSV；超过 2000 行或 1 MB；非管理员 403；跨品牌；未登录 401；并发导入；导出再导入得到相同结果（往返不变）。

**前端提醒（A 与 AI 助手实现“合规规则维护”页时必须带上，不要漏）**
1. 页面顶部有“导入规则”“导出规则”“下载模板”三个入口；全局范围和品牌范围各自一套，权限不够时不显示（平台管理员只在全局范围、品牌 admin 只在本品牌）。
2. 导入流程固定三步：选择文件 → 先自动做预览（`dry_run=true`），显示将新建、更新、不变、将停用的数量和逐行错误（行号、列名、原因）→ 用户点“确认导入”才真正写入。有错误时“确认导入”禁用。
3. 选择“整体替换”时必须有二次确认，说明“文件里没有的规则会被停用（不是删除）”，并显示停用数量。
4. 来源为空的规则在列表里显示“来源待补充”；示例规则继续显示“来源待核对，不是正式依据”。
5. 页面里所有文案叫“风险提示规则”，不得写“合规通过”“法务批准”。
6. 这是 demo 的卖点之一，演示脚本里要安排一次“导出、改一个词、再导入、看提示变化”。
