# 评测（评测集、运行与指标、品牌串味、人工评分与一致性）

- 对应需求：契约第 7 节（评测）与 F14 品牌串味测试；评测集 / 运行 / 结果 / 评分 / 一致性
- 路由（建议）：`/evaluation/datasets`（评测集列表）、`/evaluation/datasets/:id`（详情）、`/evaluation/runs`（运行列表）、`/evaluation/runs/:id`（运行详情与指标）、`/evaluation/runs/:id/results`（结果、评分、一致性）
- 负责人：B（设计与实现）；后端由 A 与 AI 助手负责
- 示例全部自编，名称带“（演示数据）”，品牌名、词表、数字都是占位；不含客户资料。

## 图片
| 图 | 内容 |
|---|---|
| 01-dataset-list-and-create.png | 评测集列表（4 种类型）；新建评测集（品牌串味）；样本校验失败（422） |
| 02-dataset-detail-and-new-run.png | 评测集详情（版本信息、样本分页）；新建运行（选模型） |
| 03-run-list-and-run-detail.png | 运行列表（4 种状态）；生成质量运行详情：按系统分组的指标、失败样本 |
| 04-brand-leak-run.png | 品牌串味运行：只有四个指标、“衡量什么”的说明、样本结果、单条错误取值 |
| 05-results-rating-agreement.png | 结果列表；人工评分（四个维度）；漏打一项；一致性（有数据、为空） |
| 06-states-and-errors.png | 列表的加载、空、筛选后为空、失败；运行的排队、运行中、失败；503；403 / 404 |

## 角色与权限
契约：评测只对品牌管理员开放；全局评测集平台管理员和任何品牌管理员可见；不可见的评测集返回 404。
| 操作 | 编辑者 | 品牌管理员 |
|---|---|---|
| 评测导航入口与全部评测页面 | 不渲染；直接打开地址显示 403 | 是 |
| 新建评测集（品牌范围）、新建运行、评分、看一致性 | 否 | 是 |
全局评测集的创建只有平台管理员能做（契约），本图只画了品牌范围的创建；平台管理员的全局创建入口沿用同一窗口、范围选“全局”，没有单独画。品牌串味集必须属于一个品牌，不能建全局集（契约）。

## 状态清单
评测集列表：加载中、空、筛选后为空、失败、正常。运行：排队中、运行中、已完成、失败。运行详情：指标、失败样本、单条错误。新建运行：正常、503。评分窗口：正常、漏打一项。一致性：有数据、为空。403、404。

## 区域与字段
**评测集列表**（`GET /evaluation/datasets?kind=`）：名称、类型（合规检测 `compliance`、事实核查 `factcheck`、生成质量 `generation`、品牌串味 `brand_leak`）、范围、版本、样本数 `case_count`、创建时间；筛选只有类型。
**新建评测集**（`POST /evaluation/datasets`，201）：名称 1–100 字；类型；范围；样本为 JSON 数组 1–200 条；各类型样本格式写在字段说明里（来自契约）。品牌串味样本比生成类多 `distractor_brand`，`expected.foreign_terms` 必填 1–50 条。校验失败 422，指出第几条、哪个字段。
**评测集详情**：后端**没有** `GET /evaluation/datasets/{id}`。页面的版本信息（`version`、`group_id`、`content_hash`、`case_count`、`created_at`）取自列表项（`GET /evaluation/datasets`，从列表页带入，或用 `kind` 与分页重新读取后按 id 选出）；样本取自 `GET /evaluation/datasets/{id}/cases?page=`；版本固定，修改产生新版本（契约用 `previous_version_id`）。
**新建运行**（`POST /evaluation/runs`，202，带 Idempotency-Key）：从 `GET /models` 选模型（已启用的可选）；品牌串味基线传空数组；合规检测基线 `lexicon_only`、事实核查基线 `no_verification` 由系统带上，界面只说明。
**运行详情**（`GET /evaluation/runs/{id}`）：指标按系统（`model:<id>` 或基线）分组；每项显示 name、value、n 和接口返回的 definition；另有 failures、error。指标没有综合分。价格没配置时 `avg_cost` 为 null，显示“—”，不显示 0。
- 合规检测：`precision`、`recall`、`f1`、`exact_match_rate`；事实核查：`accuracy`、`unsupported_accepted_rate`、`supported_recall`；生成质量：`constraint_pass_rate`、`block_hint_rate`、`failure_rate`、`avg_latency_ms`、`avg_cost`、`avg_tokens`。图只画了生成质量与品牌串味的运行详情，另两类用同一张指标表，没有单独画。
**品牌串味**（F14）：只显示 `leak_rate`、`retrieval_leak_count`、`constraint_pass_rate`、`failure_rate`；页内固定说明“衡量的是被诱导时是否把别家品牌词写进文案”；不画综合分，不写“安全”之类结论；`retrieval_leak_count` 单独成行并说明它是检索问题，不等于模型照抄诱导品牌。样本结果显示 `foreign_terms_matched`、`retrieval_leak_count / retrieval_checked`、`constraints_passed`、`leaked`。单条错误取值：`model_unavailable`、`invalid_model_output`、`retrieval_brand_mismatch`、`retrieval_brand_unknown`。
**结果与评分**：`GET …/results`；结果列表项字段：`case_index`、`system`、`output`、`detail`、`passed`、`error`、`latency_ms`、`cost`；“输出摘要”从 `output` 截取，“无输出”靠 `error` 判断（显示 `error` 的取值）。评分 `POST …/ratings`（`result_id`、`scores`、`rubric_version`、`note`），**维度和量表一律取自 `GET /evaluation/rubrics`，不写死**；图里的“结构、调性、具体度、贴合资料”和 1–5 只是 `rubric-v1` 的示意，四项必填，不算总分。“是否已评分”没有接口可读，**这个标记不画**；评分保存成功后只提示“已保存”。**一致性** `GET …/agreement`：每个维度显示两两平均的加权 Cohen’s kappa、完全一致比例、相差不超过 1 的比例和 `method`；评分者或样本不足时接口返回 null，界面显示“暂无一致性”，不画 0。人工评分页面写明“只作参考，不是系统验证”。

## 交互
- 运行是异步的：排队中、运行中时界面定期重新读取，完成后显示指标；运行中不显示 0 或空表。
- 新建运行成功后进入该运行详情；评分保存成功后弹出“已保存”提示，列表不显示评分状态。
- 只有 401 才退出登录；403、404 沿用公共组件。

## 用到的组件
状态徽标、表格与分页、筛选下拉、居中弹窗、输入框（`input-border`）、错误条加请求编号复制、骨架、空状态、评分点选（1–5 圆形选项）。类型徽标颜色（蓝、橙、灰）沿用既有 token 的软色，没有新增 token。

## 已决定
- 指标不画综合分；品牌串味只有四个指标，不下“安全”结论（A 的要求）。
- 评测只对品牌管理员渲染入口。

## 未验证
- 所有指标的 `definition` 文案、各类型指标是否都带 `n`，图里的文字是我写的示意，以接口返回为准。
- 运行状态的重新读取间隔是设计假设（契约没写推荐间隔）。
- 契约没有“取消运行”接口，图里没有取消按钮；失败运行是否可重新运行也没写，图只用“新建运行”。
- 单条样本错误（如 `retrieval_brand_mismatch`）如何计入各指标的分母，契约没写，图不作说明。
- 评测集的版本字段：详情里的“基于此版本新建”入口我没有画，`previous_version_id` 在界面上怎么给用户用，请 A 确认。
- 评分弹窗调用 `POST …/ratings` 需要 `result_id`，而结果列表项字段里没有写 `id`：图按“列表项带 `id`”画，请 A 确认。评分者之间是否互相可见，契约没写。
- 样本表里“场景、商品、诱导品牌”列取自样本的 `input`，列表接口是否原样返回，需要确认。
- 评测集列表的创建人、搜索、`page_size` 筛选没画，契约只有 `kind`。
- 所有错误提示文案（除错误码外）是我写的；1024 宽没有画；没有调用任何接口。

## 与契约不一致的地方
- 无。（技术文档对评测页面的描述较粗；字段按契约第 7 节与 F14 画。）
