# 结果页

- 对应需求：F4–F9（技术文档 2.1）；#8（结果页）、#32（人在回路）；TC-F07（状态恢复）；ADR-004、ADR-005
- 路由：`/tasks/:id/versions/:vid`（技术文档表 4-3）
- 角色与权限：品牌成员（editor、admin）都可操作；非成员或资源不存在为 404
- 负责人：B（设计与实现）；A 审阅（token、公共组件、壳）

## 状态清单
| 状态 | 图片 | 说明 |
|---|---|---|
| 需人工复核：断言的四种情形（v3，证据页签） | 01-result-page-needs-review.png | 系统判定支持、人工确认（成立）、判定不成立、未决定；确认按钮禁用并列出 3 条可读原因；证据五项统计；证据项带来源级别标签 |
| 风险面板（v3，风险页签） | 02-result-page-risks.png | 同一版本 v3、同样 3 条确认原因；每条风险显示严重度、规则编号与版本、层级、范围、出处、条款、建议、处理备注；示例规则标“来源待核对，不是正式依据”，条款为空标“来源待补充” |
| 可复制（终态，v4） | 03-result-page-ready-to-copy.png | 三个复制按钮（标题、正文、标签）、字数、“粘贴不会变成话题”提示、导出 Markdown、人工确认标注、确认时间 |
| 异常与边界 | 04-result-page-edge-states.png | constraint_failed、checking、非最新版本（只显示一条原因）、重检时模型不可用、可确认弹窗、被拒弹窗、1024 抽屉 |
| 编辑后待复检、检查已完成（v4） | 05-result-page-recheck-states.png | `edited_pending_recheck`（确认禁用，“重新检查”为主操作）；`checks_completed`（确认可点） |
| 编辑与局部重写 | 06-result-page-edit-rewrite.png | 编辑模式；局部重写弹窗（四个 `target`、说明 ≤500 字）及提交中、503、超限、校验提示、409 |

页面通用状态（加载骨架、空、错误带 request_id、403/404）沿用公共组件 03，不另画。

## 示例数据（图 01 至 06 共用，自编，不是客户资料）
同一个任务的两个版本，按时间顺序：
- **v3**（图 01、02、04）：状态 `needs_human_review`，最新版本。证据 6 条：系统判定支持 2、人工确认 1、未决定 2、判定不成立 1（`evidence_summary` = 6 / 2 / 1 / 2 / 1）；风险 3 条：必须修改 1 条未处理、建议关注 1 条、必须修改 1 条已有人处理。确认按钮禁用，原因 3 条（1 条断言被判不成立；2 条断言没有人工判断；1 条“必须修改”提示没有处理）。图 01 与 02 的原因文字、数量完全一致。
- **v4**（图 03、05）：用户编辑 v3（删掉没有依据、有风险的句子）创建，`origin = edited`，先是 `edited_pending_recheck`，重新检查后 `checks_completed`（证据 3 条：支持 2、人工确认 1，措辞完全相同的“适合办公室和地铁里”沿用 v3 的人工确认；风险 0 条），确认后 `ready_to_copy`。
- **数字按 ADR-004 的公式用代码算过**：标题 `木质香调的秋日通勤，温柔但有存在感` 加权 17（全角逗号按 1，不是 ASCII）、`通勤香水怎么选｜我的木质调清单` 15、`秋天想要一点安静的香气 🍂` 12.5（11 个汉字 + 空格 0.5 + 一个 emoji 码点 1）。v3 正文含标签 157 / 1000；v4 正文 79 码元（去换行后的 UTF-16 码元，emoji 计 2）+ 标签可见字符 23（每个标签按“1 + 标签名 + 1”，4 个标签 5 + 6 + 6 + 6）= 102 / 1000；标签 4 / 10。按 ADR-004 第 3 条的保守估算，空格怎么计待发布页验证。
- 规则编号 `R-DEMO-003`、`R-DEMO-011`、`B-0007`、规则出处与条款都是自编示例，不是正式规则。

## 区域与字段（接口以 `docs/API_CONTRACT.md` 第 5、6 节为准）
- 标题候选：`title_candidates`，每条显示加权长度 / 20：**按 Unicode 码点遍历，ASCII 可打印字符（U+0020 至 U+007E）计 0.5，其余字符（含 emoji，一个码点）计 1**（ADR-004 决定第 1 条）。emoji 计 2 只用于正文的 UTF-16 码元，标题不用；选中项对应 `selected_title_index`。
- 正文：`body`，显示“正文 N / 1000（含标签）”（去换行后的 UTF-16 码元，标签的可见字符计入）；标签 `hashtags`，显示“已选 N / 10”；封面文案候选 `cover_candidates`，`selected_cover_index` 可选，封面文案只用于做封面图、不并入复制。
- 证据面板：`claim_evidence` 每项的 `claim_text`、`source_title`、`quote`、`source_level`（`approved_kb` 显示“已审核知识库”，`task_material` 显示“任务内资料（未审核）”）、`status`、`human_confirmed`、备注；统计取 `evidence_summary`（`total`、`system_supported`、`human_confirmed`、`unconfirmed`、`rejected`）。“系统判定支持”旁边固定提示“非事实保证”。**有来源（`document_id` / `snapshot_id`、`quote`）的断言才显示来源；`evidence_missing`（没有检索到任何资料）不显示来源。**
- 人在回路：`status` 不是 `system_supported` 的断言，每条给“成立 / 不成立”和备注（建议填写），调用 `POST /claim-evidence/{id}/confirm`（`human_confirmed` true/false、`note`）；系统的 `status` 不被改写。人工确认过的标“人工确认（非系统验证）”。
- 风险面板：`compliance_checks` 每项显示 `severity`（必须修改 / 建议关注）、`rule_id`、`rule_version`、`layer`（`lexicon`、`context`、`efficacy_basis`，界面文字“词表、语境、功效依据”是我起的）、`region_scope`、`source_name`、`source_clause`、`suggestion`，规则来源链接 `source_url` 有值时显示为纯文本；命中的原文取自 `span`。未处理的“必须修改”数取 `unresolved_block`；“标记已处理”调用 `POST /compliance-checks/{id}/resolve`（`note`），处理后显示“已有人处理（不表示合规）”和处理备注。示例规则显示“示例规则（来源待核对，不是正式依据）”；`source_clause` 为空显示“来源待补充”。
- 确认：`POST /generation-versions/{id}/confirm`（`selected_title_index`、可选 `selected_cover_index`）。确认后显示“确认时间”（`confirmed_at`）。**不显示“确认人”**：版本字段里只有 `confirmed_at`，没有 `confirmed_by`（见下“与契约不一致的地方”第 3 条）。
- 导出：`GET /generation-versions/{id}/export?format=xhs_parts|markdown`；`xhs_parts` 的 `title`、`body`、`tags`（不带 `#`）、`counts`、`verification`（`system_supported`、`human_confirmed`）。界面用 `verification` 显示“2 条系统判定支持（非事实保证）；1 条人工确认（非系统验证）”，复制出去的文字本身不夹带标注。
- 编辑：`POST /generation-versions/{id}/edit`，请求体 `title_candidates`（至少 1 个）、`body`（非空）、`hashtags`（≤20）、`cover_candidates`（≤5），空白项被去掉；创建新版本（201，`origin = edited`，`parent_version_id` 指向被编辑的版本），状态 `edited_pending_recheck`，成为最新版本，原版本不变。标签超过 10 个接口允许保存，但复检时约束检查会判未通过，所以编辑界面提前提示。
- 局部重写：`POST /generation-versions/{id}/rewrite`，`target` 为 `titles | opening | body | cover`（界面文字“标题候选、开头、正文、封面文案”），`instruction` 可选、≤500 字。**同步**调用模型，保存为新版本（`origin = rewritten`），然后后台自动检查；模型不可用返回 503 且不保存任何东西。
- 页面状态：图 01、04、05、03 覆盖了版本的 `needs_human_review`、`checking`、`constraint_failed`、`edited_pending_recheck`、`checks_completed`、`ready_to_copy` 六个 `flow_status`；`queued`、`generating` 是任务进度，画在“生成工作台”里。

## 交互
- **确认按钮禁用并写出原因**：以下任一不满足即禁用，原因逐条写在按钮上方（不让用户猜）：有断言未决定（`unconfirmed_claims`）、有断言被判不成立（`rejected_claims`）、有未处理的“必须修改”提示（`open_block_risks`）、约束未通过（`constraints_failed`）、检查还没针对这份文字运行（`checks_not_run`）、状态不允许确认（`status_not_confirmable`）、不是最新版本（`not_latest_version`）。界面只显示 `details.reasons[]` 的可读文字，代码名不展示给用户；代码只用来判断按钮状态。
- **非最新版本**：契约规定此时 `reasons` 只有 `not_latest_version` 一条，所以被拒弹窗和页面提示只显示“只有最新版本可以确认”一条，并给“查看最新版本”入口，不和其他原因混在一起（图 04）。
- 不成立或未决定的出路：改写稿件并重新检查；新版本的断言重新判断，措辞完全相同的断言保留人工确认（图 05 A）。
- `ready_to_copy` 是终态：不显示“重新检查”和“确认”；编辑、局部重写会创建新版本。非最新版本不能确认，显示最新版本入口。
- 重新检查不会自动改写；检查途中模型不可用，版本保持 `checking`，`last_error = model_unavailable`，可再次重检。
- 任务在 `generating` 时，编辑、局部重写、重新检查返回 409：按钮禁用并写明原因（图 06）。
- **编辑后**：保存为新版本后打开新版本（`edited_pending_recheck`），在新版本上点“重新检查”；**局部重写后**同样打开新版本（后台自动检查中，显示检查中状态）。
- **最新版本变化**：自动改写（最多 2 轮）会创建新版本。工作台等改写结束后才跳转；已经在结果页的用户不被强行切换，页面顶部提示“这个任务有更新的版本 vN”并给入口（图“生成工作台 02”最后一行）。检测方式：页面在检查中时轮询 `GET /tasks/{id}` 的 `latest_version_id`。
- 复制：三个按钮分别复制标题、正文、标签（标签复制为 `#a #b`，空格分隔）；复制失败给纯文本框手动复制；成功轻提示“已复制到剪贴板”。
- 导出 Markdown（唯一含封面文案的格式）：有人工确认的断言时，末尾有“人工核对记录（资料里没有依据，由人工确认，不是系统验证）”。复制出去的文字本身不夹带标注。
- 右侧面板：≥1280 为页内右栏；1024 折成右侧抽屉，由按钮打开（见公共组件 05）。
- **版本对比与版本历史：本批不画，放在下一批。**页头的“版本对比”“版本历史”两个入口是占位，对应界面未设计；没有专门接口，对比由前端比较两个版本（契约第 5 节补充说明）。落地时如不想先放无界面的入口，请 A 告诉我，我去掉。

## 用到的组件与 token
应用壳、徽标（含浅蓝“系统判定支持”和来源级别两个标签）、按钮、文本域与字数组件、标签页、右侧抽屉、请求编号复制、弹窗、提示条；颜色、字号、间距只用 design-tokens 里的名字。

## 图里没有写、但开发要知道的说明（已从画面移出）
- 图中的数值（字数、证据数、风险数、规则编号、确认时间）都是示例，口径见上“示例数据”。
- 导出面板里“2 条系统判定支持、1 条人工确认”来自 `xhs_parts` 的 `verification`。
- 面板字段和契约字段的对应见“区域与字段”；`span`、`source_url` 有值才显示。

## 已决定
1. 没有系统依据的断言必须每条人工决定，“成立”才放行（#32、契约第 5 节）；备注契约写“建议必填”、后端不强制，设计保持“建议”（A 已回复）。
2. 措辞：只写“风险提示”；“已有人处理”不等于合规；“可复制”只表示运营确认了文字。
3. 状态徽标沿用 design-tokens：`system_supported` 浅蓝、`ready_to_copy` 绿色、人工确认中性蓝灰。
4. 路由 `/tasks/:id/versions/:vid`，取自技术文档表 4-3。
5. 版本对比由前端比较两个版本（A 已同意）。

## 未验证
1. 图里的字数、断言和规则文字都是自编示例，不是客户资料，也不是正式规则；字数口径用 ADR-004 的公式在代码里算过，没有逐项用接口核对。
2. 我没有调用任何接口，禁用原因的可读文字以服务端 `details.reasons[]` 为准，图中文字只是示意。
3. 风险“层级”三个值的界面文字、“功效依据”等叫法是我起的，没有对照规则维护页的叫法。
4. 检查中的小字（核对依据等）与 `progress.stage` 的对应以契约为准，未逐值核对。
5. 标签可见字符的算法按 ADR-004 第 3 条（每个标签 1 + 标签名 + 1）；契约 `xhs_parts.counts` 示例里的 `tags_visible_units` 数值与这个公式对不上（Softcore、逐帧动画两个标签示例为 18，公式给 16），请 A 确认实现用哪个口径。
6. 编辑里“标签超过 10 个提前提示”是我按“接口允许 ≤20、约束检查要求 ≤10”做的推断。
7. 轮询频率、页面顶部“有更新的版本”的提示条没有对应契约字段，只是用 `latest_version_id` 的变化判断。

## 与契约或约束不一致的地方
1. 版本对比没有接口，设计假定由前端比较两个版本的字段（A 已同意）。
2. 本页没有为 429 设计状态（契约说目前没有任何接口返回 429）。
3. **确认人**：契约第 5 节写“确认……记录 `confirmed_by/confirmed_at`”，但版本字段与列表项里只有 `confirmed_at`，没有 `confirmed_by`。设计已按 A 的要求删掉“确认人”。如果希望显示，需要在契约里补字段，请 A 决定。
4. 自动改写后，任务的 `flow_status` 在两个版本之间是否会短暂显示上一个版本的状态，契约没有写；工作台的跳转条件（`progress.stage` 为空或 `done`）是我的推断，见“生成工作台”spec。
