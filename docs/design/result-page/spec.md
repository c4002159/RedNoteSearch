# 结果页

- 对应需求：F4–F9（技术文档 2.1）；#8（结果页）、#32（人在回路）；TC-F07（状态恢复）；ADR-004、ADR-005
- 路由：`/tasks/:id/versions/:vid`（技术文档表 4-3）
- 角色与权限：品牌成员（editor、admin）都可操作；非成员或资源不存在为 404
- 负责人：B（设计与实现）；A 审阅（token、公共组件、壳）

## 状态清单
| 状态 | 图片 | 说明 |
|---|---|---|
| 需人工复核：断言的四种情形 | 01-result-page-needs-review.png | 系统判定支持、人工确认（成立）、判定不成立、未决定；确认按钮禁用并在旁边列出可读原因；证据五项统计 |
| 风险面板 | 02-result-page-risks.png | “必须修改 / 建议关注”、规则出处与版本、建议、“标记已处理”；处理表示“有人处理过”，不是合规 |
| 可复制（终态） | 03-result-page-ready-to-copy.png | 三个复制按钮（标题、正文、标签）、字数、“粘贴不会变成话题”提示、导出 Markdown、人工确认标注 |
| 异常与边界 | 04-result-page-edge-states.png | constraint_failed、checking、非最新版本、重检时模型不可用、可确认弹窗、被拒弹窗、1024 抽屉 |

页面通用状态（加载骨架、空、错误带 request_id、403/404）沿用公共组件 03，不另画。

## 区域与字段（接口以 `docs/API_CONTRACT.md` 第 5、6 节为准）
- 标题候选：`title_candidates`，每条显示加权长度 / 20（ASCII 可打印字符计 0.5，其余计 1；emoji 按 UTF-16 码元逐个计）；选中项对应 `selected_title_index`。
- 正文：`body`，显示“正文 N / 1000”（去换行后的 UTF-16 码元，标签的可见字符计入）；标签 `hashtags`，显示“已选 N / 10”；封面文案候选 `cover_candidates`，`selected_cover_index` 可选，封面文案只用于做封面图、不并入复制。
- 证据面板：`claim_evidence` 每项的 `claim_text`、`source_title`、`quote`、`source_level`（`approved_kb` 或 `task_material`，后者标“未经审核”）、`status`、`human_confirmed`、备注；统计取 `evidence_summary`（`total`、`system_supported`、`human_confirmed`、`unconfirmed`、`rejected`）。“系统判定支持”旁边固定提示“非事实保证”。
- 人在回路：`status` 不是 `system_supported` 的断言，每条给“成立 / 不成立”和备注（建议必填），调用 `POST /claim-evidence/{id}/confirm`（`human_confirmed` true/false、`note`）；系统的 `status` 不被改写。人工确认过的标“人工确认（非系统验证）”。
- 风险面板：`compliance_checks` 每项的 `severity`、`rule_id`、`rule_version`、`source_name`、`source_clause`、`region_scope`、`suggestion`、`source_url`；未处理的“必须修改”数取 `unresolved_block`；“标记已处理”调用 `POST /compliance-checks/{id}/resolve`（`note`）。示例规则的来源显示“示例规则（来源待核对，不是正式依据）”。
- 确认：`POST /generation-versions/{id}/confirm`（`selected_title_index`、可选 `selected_cover_index`）。
- 导出：`GET /generation-versions/{id}/export?format=xhs_parts|markdown`；`xhs_parts` 的 `title`、`body`、`tags`（不带 `#`）、`counts`、`verification`（`system_supported`、`human_confirmed`）。

## 交互
- **确认按钮禁用并写出原因**：以下任一不满足即禁用，原因逐条写在按钮上方（不让用户猜）：有断言未决定（`unconfirmed_claims`）、有断言被判不成立（`rejected_claims`）、有未处理的“必须修改”提示（`open_block_risks`）、约束未通过（`constraints_failed`）、检查还没针对这份文字运行（`checks_not_run`）、状态不允许确认（`status_not_confirmable`）、不是最新版本（`not_latest_version`）。界面只显示可读文字，代码名不展示给用户；代码只用来判断按钮状态。
- 不成立或未决定的出路：改写稿件并重新检查；新版本的断言重新判断，措辞完全相同的断言保留人工确认。
- `ready_to_copy` 是终态：不显示“重新检查”和“确认”；编辑、局部重写会创建新版本。非最新版本不能确认，显示最新版本入口。
- 重新检查不会自动改写；检查途中模型不可用，版本保持 `checking`，`last_error = model_unavailable`，可再次重检。
- 复制：三个按钮分别复制标题、正文、标签（标签复制为 `#a #b`，空格分隔）；复制失败给纯文本框手动复制；成功轻提示“已复制到剪贴板”。
- 导出 Markdown（唯一含封面文案的格式）：有人工确认的断言时，末尾有“人工核对记录（资料里没有依据，由人工确认，不是系统验证）”。复制出去的文字本身不夹带标注。
- 右侧面板：≥1280 为页内右栏；1024 折成右侧抽屉，由按钮打开（见公共组件 05）。
- 版本对比没有专门接口，由前端比较两个版本。

## 用到的组件与 token
应用壳、徽标（含浅蓝“系统判定支持”）、按钮、文本域与字数组件、标签页、右侧抽屉、请求编号复制、弹窗、提示条；颜色、字号、间距只用 design-tokens 里的名字。

## 已决定
1. 没有系统依据的断言必须每条人工决定，“成立”才放行（#32、契约第 5 节）；备注建议必填，界面标“建议”，不强制。
2. 措辞：只写“风险提示”；“已有人处理”不等于合规；“可复制”只表示运营确认了文字。
3. 状态徽标沿用 design-tokens：`system_supported` 浅蓝、`ready_to_copy` 绿色、人工确认中性蓝灰。
4. 路由 `/tasks/:id/versions/:vid`，取自技术文档表 4-3。

## 未验证
1. 图里的字数、断言和规则文字都是自编示例，不是客户资料，也不是正式规则；数值口径见 ADR-004，没有逐项用接口核对。
2. 我没有调用任何接口，禁用原因的可读文字以服务端 `details.reasons[]` 为准，图中文字只是示意。
3. 备注是否必填由后端还是前端决定，契约没有写；按“建议必填”画。
4. 检查中的小字（核对依据等）与 `progress.stage` 的对应以契约为准，未逐值核对。

## 与契约或约束不一致的地方
1. 版本对比没有接口，设计假定由前端比较两个版本的字段；如果 A 希望后端提供，请回复。
2. 本页没有为 429 设计状态（契约说目前没有任何接口返回 429）。
