# API_CONTRACT.md（v1.1）

v1.1 在 v1.0 基础上补齐了登录、品牌与商品增改、品牌档案版本、资料版本与分块预览、场景与风格、任务列表、断言人工确认、规则查询、评测集创建与评分、模型列表、复制与导出格式、分页约定。所有“默认值”都可在配置中调整，调整须提契约 PR。

## 1. 通用约定

- 基路径 `/api/v1`；JSON `snake_case`；ID 为 UUID 字符串；时间为 ISO 8601 UTC。
- 所有业务接口需 JWT（`Authorization: Bearer <token>`）。品牌资源必须经过服务端 `brand_member` 授权检查；请求里的 `brand_id` 只表示资源目标，不代表授权。
- 新增字段默认可选或有默认值；删除、改名须版本化或提供兼容期。

### 1.1 错误

```json
{"error":{"code":"FORBIDDEN","message":"无权访问该品牌","details":{},"request_id":"req-uuid"}}
```

| code | HTTP | 说明 |
|---|---|---|
| `VALIDATION_ERROR` | 422 | 参数或体校验失败；`details` 给出字段 |
| `UNAUTHENTICATED` | 401 | 未登录或令牌无效 |
| `FORBIDDEN` | 403 | 已登录但无权限（角色或品牌授权） |
| `NOT_FOUND` | 404 | 资源不存在，或按 ID 访问的资源不属于你可访问的品牌（不泄露存在性） |
| `CONFLICT` | 409 | 状态冲突，例如审核非 `pending_review` 资料 |
| `INVALID_STATE` | 409 | 当前状态不允许该操作，`details.current_state` 给出现状 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一 `Idempotency-Key` 但请求体不同 |
| `FILE_TOO_LARGE` | 422 | 超过大小限制，`details.limit_bytes` |
| `UNSUPPORTED_FILE_TYPE` | 422 | 扩展名或类型不在白名单 |
| `PARSE_FAILED` | 422 | 解析失败；资料保持不可检索 |
| `RATE_LIMITED` | 429 | 限流，带 `Retry-After` |
| `MODEL_UNAVAILABLE` | 503 | 模型超时、限流或空响应，重试用尽 |

不得返回 traceback、API 密钥、模型原始敏感内容。

### 1.2 403 与 404 的统一策略

- 路径或请求体里**显式带 `brand_id`** 且用户不是该品牌成员：返回 `403 FORBIDDEN`。
- 按**资源 ID** 访问（文档、任务、版本、断言）且该资源所属品牌用户无权访问：返回 `404 NOT_FOUND`，不泄露存在性。
- 角色不足（如 editor 调用 admin 接口）：`403 FORBIDDEN`，并写入越权审计事件。

### 1.3 分页、排序、过滤

- 列表：`?page=1&page_size=20`，`page_size` 默认 20，最大 100；超过 100 返回 `422 VALIDATION_ERROR`。
- 排序：`?sort=-created_at`（`-` 为降序）；允许的字段在各接口注明。
- 过滤：显式查询参数，未知参数忽略并不报错。
- 响应：`{"items":[...],"total":123,"page":1,"page_size":20}`。

### 1.4 幂等与长任务

- 创建耗时资源的 POST（`/tasks/{id}/generate`、`/evaluation/runs`、`/model-comparisons`）支持 `Idempotency-Key` 头；相同 key 与相同体返回原结果；相同 key 不同体返回 `IDEMPOTENCY_CONFLICT`。
- 耗时任务返回 `202` 与资源；客户端用 `GET` 轮询：先每 2 秒，最长退避到 5 秒；不依赖 SSE 作为状态存储。P0 可同步执行，资源字段保持兼容。
- 任务进度：`progress.stage` 取值 `retrieving | generating | constraint_check | evidence | compliance | rewriting | done`。

### 1.5 文件上传限制（默认值，可配置）

| 类型 | 扩展名 | 上限 |
|---|---|---|
| 文档 | `.pdf`、`.docx` | 50 MB（演示品牌手册约 42 MB，须不被拒绝） |
| 文本与表格 | `.md`、`.csv` | 5 MB |
| 任务内资料（粘贴文本） | — | 100 KB |

超限返回 `FILE_TOO_LARGE`，类型不符返回 `UNSUPPORTED_FILE_TYPE`，解析失败返回 `PARSE_FAILED`；三者都不得产生半成品索引。

## 2. 认证与用户（沿用模板，不另造）

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `POST /login/access-token` | 公开 | 表单（用户名、密码）换令牌，响应 `{"access_token","token_type":"bearer"}`；错误凭据 401，不泄露哈希 |
| `POST /login/test-token` | 登录 | 校验令牌并返回当前用户 |
| `GET /users/me` | 登录 | 当前用户最小信息：`id`、`email`、`full_name`、`is_superuser` |
| `PATCH /users/me`、`PATCH /users/me/password` | 登录 | 修改自己的资料与密码 |
| `GET/POST/PATCH/DELETE /users…` | 平台管理员（`is_superuser`） | 用户管理；用户在品牌内的角色见 `brand_member` |

- 平台管理员（模板的 `is_superuser`）由种子创建，负责建品牌与成员；品牌内角色只有 `admin`、`editor`。
- **`POST /users/signup`（模板自带公开注册）在本项目中必须关闭**：生产与演示环境不开放自助注册，用户由平台管理员创建。

## 3. 品牌、商品、品牌档案（A）

### `GET /brands`
当前用户**作为成员**的品牌：`{"items":[{"id","name","category","role"}]}`，按名称排序。平台管理员也只看到自己是成员的品牌；创建品牌时创建者自动成为该品牌的 admin，所以能看到自己创建的品牌。

### `POST /brands`　`PATCH /brands/{brand_id}`
- `POST` 仅平台管理员（`is_superuser`），返回 201。体：`{"name","category","description","slug"}`；`name` 必填（1–100），`category` 默认 `other`，`slug` 可选（小写字母、数字、连字符，2–60），不传则由名称生成；名称不含英文字母时生成 `brand-<8位随机>`；`slug` 重复返回 409。`category`：`perfume | skincare | makeup | home_fragrance | other`。
- 租户：目前是单租户演示，品牌自动归入默认租户（`tenant` 表里最早的一条，没有则创建 `Default`）；体里没有 `tenant_id`。
- `PATCH` 平台管理员或该品牌的 admin；体里的字段都可选。

### `GET /brands/{brand_id}/members`　`POST /brands/{brand_id}/members`　`PATCH …/members/{user_id}`　`DELETE …/members/{user_id}`
平台管理员或该品牌的 admin。体：`{"user_id","role":"admin|editor"}`。`POST` 返回 201；用户不存在 404；已是成员 409；`role` 不合法 422。不得移除或降级最后一位 admin（409）。`DELETE` 成功返回 `{"message":"Member removed successfully"}`。

### 品牌授权的实现约定（A 提供，B 的路由使用）
依赖在 `backend/app/api/brand_deps.py`，品牌 id 只取自路径，服务端用 `brand_member` 校验：
- `BrandAccessDep`：品牌成员（editor 或 admin）；非成员 403。
- `BrandAdminDep`：品牌 admin；否则 403。
- `BrandManagerDep`：平台管理员或品牌 admin，返回 `Brand`；平台管理员访问不存在的品牌 404。用于管理品牌与成员。
- **平台管理员不是品牌数据的万能钥匙**：`BrandAccessDep` 对非成员的平台管理员同样 403，品牌范围内的数据（资料、任务、版本等）要先成为成员。
- 请求体里的 `brand_id` 不授予任何权限。

### 实现状态与偏差（2026-10-31）
- 错误响应暂时沿用模板格式 `{"detail": "..."}`，**统一错误信封（`error.code`、`request_id`）尚未实现**：它会改变前端对错误的读取方式，需要单独的 PR 与前端调整。
- 令牌无效时模板返回 403（契约写 401），未登录没带令牌时返回 401；也留待统一错误处理时一并调整。

### 商品
- `GET /brands/{brand_id}/products?status=active|archived&page=`：品牌成员。
- `POST /brands/{brand_id}/products`、`PATCH /products/{product_id}`：品牌 admin。
- `POST /products/{product_id}/archive`：软删除，不物理删除；已被历史任务引用的商品保留。

```json
{"id":"p-uuid","brand_id":"b-uuid","name":"…","product_line":"…","category":"perfume",
 "notes":{"top":["佛手柑"],"middle":[],"base":[]},
 "selling_points":[{"text":"…","source_document_id":"doc-uuid","source_chunk_id":"chunk-uuid"}],
 "restricted_claims":["…"],"status":"active"}
```
`selling_points` 每条须能关联已审核资料来源；无来源的卖点保存为草稿，不参与“可作证据”。

### 品牌档案（版本化）
- `GET /brands/{brand_id}/voice-profile`：当前生效档案及版本。
- `GET /brands/{brand_id}/voice-profile/versions`：版本列表。
- `POST /brands/{brand_id}/voice-profile/versions`（admin）：创建新版本（草稿），体含 `persona`、`tone_keywords`、`preferred_words`、`forbidden_words`、`sample_refs`。
- `POST /brands/{brand_id}/voice-profile/versions/{version}/activate`（admin）：设为生效，旧版本保留。
- `POST /brands/{brand_id}/voice-profile/drafts`（admin，**P1**）：基于已入库资料由模型起草，返回草稿，**须人工确认后才能创建版本**。

## 4. 知识资料（A）

资料状态：`pending_review | approved | rejected | deactivated`；`index_status`：`pending | ready | failed`。

### `POST /brands/{brand_id}/knowledge-documents`（admin，multipart）
管理员直接入库。字段：`file`、`title`、`doc_type`（`brand_story | product_spec | ingredient | award_claim | compliance_policy | sample_note`）。解析与索引成功后状态为 `approved`，记录 `admin_direct_ingest` 审计事件。

```json
{"id":"doc-uuid","brand_id":"b-uuid","status":"approved","index_status":"ready","version":1,"submitted_by":"u-uuid"}
```
editor 调用返回 403。解析失败返回 `PARSE_FAILED`，保持不可检索。管理员直入库不是对审核流程的绕过：两条路径靠角色区分，都写审计。

### `POST /knowledge-documents/{document_id}/versions`（admin，multipart）
管理员为已有资料提交新版本：新版本解析与索引成功后成为当前版本（`is_current=true`），旧版本保留；记审计事件 `admin_direct_ingest`。

### `POST /brands/{brand_id}/knowledge-submissions`（成员，multipart）
运营提交待审资料：`{file,title,doc_type,supersedes_document_id?}`。状态 `pending_review`，**通过前不可检索**；若带 `supersedes_document_id`，通过前仍使用旧的当前版本。响应至少含 `status`、`submitted_by`、`created_at`。

### `GET /brands/{brand_id}/knowledge-documents?status=&doc_type=&page=`
按授权品牌列举，不返回其他品牌数据。

### `GET /knowledge-documents/{document_id}`
详情：元数据、版本链、审核记录；按资源 ID 访问，无权返回 404。

### `GET /knowledge-documents/{document_id}/chunks?page=`（admin）
分块预览：`{"items":[{"id","chunk_index","content","metadata"}]}`，用于核对解析结果。

### `POST /knowledge-documents/{document_id}/reindex`（admin）
重建索引；返回 202；失败不影响已有可检索状态之外的文档。

### `POST /knowledge-documents/{document_id}/reviews`（admin）
仅审核 `pending_review`；其他状态返回 `INVALID_STATE`。体：`{"action":"approve|reject","reason":"…"}`（`reject` 必须带理由）。新建只增不改的审核记录；通过后转 `approved` 并建立索引，驳回转 `rejected`；记录审核人、时间、理由。

### `POST /knowledge-documents/{document_id}/deactivate`（admin）
停用；新任务不得检索，历史 `generation_version` 保留原引用快照。不物理删除。

## 5. 场景、风格、任务与生成（B）

### 场景与风格
- `GET /scenarios`：登录用户；含全局与所属品牌模板，`{"items":[{"id","scene","name","structure","template_version","brand_id|null"}]}`；`scene`：`seeding | review | tutorial | launch | promotion | story`。
- `GET /brands/{brand_id}/style-presets`：品牌成员；`POST /brands/{brand_id}/style-presets`：成员保存预设 `{"name","params":{"tone","length","person","emoji_density","hashtag_count"}}`。

### `POST /tasks`
创建任务与任务资料快照。服务端核验 brand、product 授权。

```json
{"brand_id":"b-uuid","product_id":"p-uuid","scenario_id":"s-uuid",
 "style":{"tone":"温柔克制","length":"short","person":"first","emoji_density":"low"},
 "brief":"突出木质香调，面向通勤场景","required_terms":["木质香调"],
 "task_materials":[{"filename":"brief.txt","text":"用户提供的临时产品资料"}]}
```
响应 201：`{"id","status":"queued","brand_id","created_at"}`。快照保存内容与 `content_hash`，之后源文件变化不影响本任务。

约束检查（与发布页一致，ADR-004、ADR-005）：标题加权长度 `title_weight ≤ 20`（ASCII 可打印字符计 0.5，其余计 1）；正文 `body_units ≤ 1000`（去掉换行后的 UTF-16 码元数，emoji 计 2）；标签 ≤10，且标签的可见字符计入正文预算。后端判定为准，前端镜像同一规则。

### `GET /tasks?brand_id=&status=&page=&sort=-created_at`
任务列表（品牌成员）；`brand_id` 必填。

### `POST /tasks/{task_id}/generate`
返回 202 与任务状态；支持 `Idempotency-Key`。

### `GET /tasks/{task_id}`
```json
{"id":"…","flow_status":"checking","progress":{"stage":"evidence"},"latest_version_id":"…"}
```
`flow_status`：`queued | generating | checking | checks_completed | needs_human_review | constraint_failed | edited_pending_recheck | ready_to_copy`。仅表示流程，不代表合规通过。

### `GET /tasks/{task_id}/versions`　`GET /generation-versions/{version_id}`
版本详情字段：`title_candidates`、`body`、`hashtags`、`cover_candidates`、`final_text`、`flow_status`、`constraint_checks`、`claim_evidence`、`compliance_checks`、`retrieved_sources`、`template_version`、`prompt_version`、`voice_version`、`checker_version`、`model`、`selected_title_index`、`selected_cover_index`。

证据项：
```json
{"id":"ev-uuid","claim_text":"前调带有佛手柑","source_level":"approved_kb|task_material",
 "document_id":"doc-uuid","document_version":2,"chunk_id":"chunk-uuid",
 "status":"system_supported","rationale":"…","human_confirmed":null}
```
证据状态：`system_supported | evidence_missing | needs_human_review`；不写“事实正确”。`source_level=task_material` 表示任务内资料，未经审核。

合规项：`{"rule_id","rule_version","layer":"lexicon|context|efficacy_basis","severity":"block|warn","span":[start,end],"suggestion","source_name","region_scope"}`。输出是风险提示，不是合规结论。

### `POST /generation-versions/{version_id}/edit`
体：`{"title_candidates":[…],"body":"…","hashtags":[…],"cover_candidates":[…]}`。创建新版本，不覆盖旧版本，进入 `edited_pending_recheck`。

### `POST /generation-versions/{version_id}/rewrite`
局部重写：`{"target":"titles|opening|body|cover","instruction":"…"}`；创建新版本，并自动对最终文本复检。

### `POST /generation-versions/{version_id}/recheck`
对最终文本重跑约束、证据、合规检查，生成检查快照与新状态。

### `POST /claim-evidence/{evidence_id}/confirm`
人工确认断言：`{"human_confirmed":true|false,"note":"…"}`。记录 `confirmed_by/confirmed_at`；**不改变** `status`（系统判定与人工确认分开存储）。

### `POST /generation-versions/{version_id}/confirm`
体：`{"selected_title_index":0,"selected_cover_index":0}`。仅当约束已通过、无未处理的 `block` 级风险、各检查已针对最终文本运行时才允许，否则 `INVALID_STATE`。成功后 `ready_to_copy`，记录 `confirmed_by/confirmed_at`。该状态不表示法律合规获批。

### 导出与复制格式
`GET /generation-versions/{version_id}/export?format=xhs_parts|markdown`，仅 `ready_to_copy` 版本可导出，否则 `INVALID_STATE`。

`xhs_parts`：标题、正文、标签三者分开，界面对应“复制标题”“复制正文”“复制标签”三个按钮（ADR-005）：
```json
{"title":"选定标题","body":"正文","tags":["Softcore","逐帧动画"],
 "counts":{"title_weight":12.5,"body_units":356,"tags_visible_units":18,"tags_count":2}}
```
- `tags` 不含 `#`；界面复制标签时拼成 `#Softcore #逐帧动画`（单个空格分隔）。
- 正文换行符统一为 LF，行尾空白去除，不含 Markdown；保留 emoji。
- **粘贴到发布页不会变成话题**（实测）：界面要提示用户在发布页用键盘输入 `#` 加话题名再按空格，或点“# 话题”按钮；并显示“已选 N / 10”。
- 封面文案不并入以上三项（用于制作封面图），仅出现在 `markdown` 导出中。
- 复制失败时界面提供纯文本框手动复制。

## 6. 合规规则（B）

- `GET /compliance-rules?layer=&rule_type=&severity=&brand_id=&page=`：登录用户可查全局规则与所属品牌规则。
- `GET /compliance-rules/{rule_id}`：规则详情。
- 字段：`id`、`brand_id|null`、`layer`、`rule_type`（`absolute_term | efficacy_claim | medical_term | data_claim | platform_rule | brand_forbidden`）、`pattern`、`is_regex`、`severity`、`suggestion`、`source_name`、`source_url`、`source_clause`、`region_scope`、`effective_from`、`effective_to`、`rule_version`、`enabled`。
- 规则的创建、修改、停用属 **P2**（品牌 admin）；P0 规则由种子数据或评测目录导入，不通过 API 编辑。

## 7. 评测（B）

- `GET /evaluation/datasets?kind=`：品牌 admin；`kind`：`generation | compliance | factcheck | brand_leak`。
- `POST /evaluation/datasets`（admin）：`{"name","kind","brand_id|null","cases":[{"input":{…},"expected":{…},"annotators":["…"]}]}`；创建后**版本固定**，修改产生新版本，旧版本保留。
- `GET /evaluation/datasets/{dataset_id}/cases?page=`
- `GET /evaluation/rubrics`：人工评分表（维度、分值、说明、`rubric_version`）。
- `POST /evaluation/runs`（admin，支持幂等）：`{"dataset_id","model_ids":["…"],"prompt_version":"…","baselines":["lexicon_only","no_verification"]}`；返回 202 与 `run_id`。
- `GET /evaluation/runs?dataset_id=&page=`；`GET /evaluation/runs/{run_id}`：样本数、各版本（dataset/model/prompt/checker/rubric）、指标明细、失败项；**不得只返回无定义的综合分**。
- `POST /evaluation/runs/{run_id}/ratings`：`{"result_id","scores":{"structure":4,"tone":3},"rubric_version","note"}`；评分者取自登录用户。
- `GET /evaluation/runs/{run_id}/agreement`：评分者人数、样本数与一致性统计（方法在响应中注明）。

## 8. 模型与成本（B）

- `GET /models`：登录用户；`{"items":[{"id","provider","model_name","enabled","price_in_per_1k","price_out_per_1k","price_version"}]}`。价格为配置数据，非硬编码。
- 调用日志不通过 API 暴露原始请求；费用在版本与评测结果里汇总。

## 9. 审计（A，P2）

`GET /audit-logs?brand_id=&action=&page=`（品牌 admin）：关键操作（入库、审核、停用、越权尝试）；P0 只写不读。

## 10. P1 接口（占位，开发前补细节）

- 爆款结构分析（B）：`POST /brands/{brand_id}/viral-samples`；`GET …/viral-samples`；`POST /viral-samples/{id}/analyze`；`POST /viral-patterns/{id}/to-template`。样本只属于所在品牌，不入公共知识库；输出结构标签与抽象模板，不得大段复用样本原句。
- 多模型对比（B）：`POST /model-comparisons`（幂等）；`GET /model-comparisons/{id}`：并列各模型的约束通过率、人工评分、延迟、费用；失败模型单独显示。
- 任务文件输入（A 解析、B 消费）：`POST /tasks` 的 `task_materials` 扩展为文件上传，只存任务快照，不建知识库索引。

## 11. 合同变更流程

1. 提案人先更新本文与 JSON 样例，说明兼容影响。
2. API 所有者与调用方共同审查，在 PR 评论里确认后更新 OpenAPI 与 DTO（GitHub 不强制批准，见 ADR-009，所以评论确认是必须的）。
3. 服务端先支持向后兼容，再合并前端；前端重新生成客户端，CI 的 `contract` 检查须无漂移。
4. 每个新增或修改的端点补成功、验证错误、未授权、越权测试。

## 12. 变更记录

- v1.1：补齐第 2、3、4（版本、分块、重建索引）、5（场景、风格、任务列表、局部重写、断言确认、选定标题、导出格式）、6、7（创建、评分、一致性）、8；明确 403 与 404 策略、分页、幂等、文件限制；关闭自助注册。
- v1.0：初版（见原 API_CONTRACT.md）。
