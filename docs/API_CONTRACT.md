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
| `BAD_REQUEST` | 400 | 请求本身有问题（例如密码错误、令牌无效），没有更具体的错误码时使用 |
| `VALIDATION_ERROR` | 422 | 参数或体校验失败；`details.errors` 给出每个字段的 `loc`、`msg`、`type` |
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
| `INTERNAL_ERROR` | 500 | 未处理的异常；不返回原因，只在服务端日志里记录并带 `request_id` |

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
| 任务内资料（粘贴文本） | — | 每份 ≤50000 字，最多 5 份（见 `POST /tasks`） |

超限返回 `FILE_TOO_LARGE`，类型不符返回 `UNSUPPORTED_FILE_TYPE`，解析失败返回 `PARSE_FAILED`；三者都不得产生半成品索引。

**实现（2026-11-01）**：上限按类型生效——`.pdf`、`.docx` 为 50 MB，`.md`、`.txt`、`.csv` 为 5 MB；类型不在白名单返回 422 `UNSUPPORTED_FILE_TYPE`（`details.allowed`），超限返回 422 `FILE_TOO_LARGE`（`details.limit_bytes`），都在读取内容之前或读取后立即拒绝，不保存任何东西。大文件的解析与嵌入是同步进行的，几十兆的 PDF 可能需要几分钟，前端上传要有长时间等待的状态。

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

### 实现状态（2026-10-31）
- **统一错误信封已实现**（`backend/app/core/errors.py`）：所有错误都是 `{"error":{"code","message","details","request_id"}}`；`request_id` 取自客户端发来的 `X-Request-ID`（只接受 1–64 位字母、数字、`.`、`_`、`-`），否则服务端生成，并在响应头 `X-Request-ID` 里返回，成功响应也带。未处理的异常返回 500 `INTERNAL_ERROR`，不含原因或堆栈。
- 令牌无效或过期返回 **401** `UNAUTHENTICATED`（带 `WWW-Authenticate: Bearer`）；未带令牌也是 401。此前模板对无效令牌返回 403，已改正。
- 前端只在 401 时清除令牌并回到登录页；403 作为“无权限”显示给用户，不再被当成登录失效。错误提示读取 `error.message` 并附上 `request_id`；校验错误显示第一个字段的提示。

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

**实现约定（2026-10-31）**
- 列表：`status` 默认 `active`；`page` 从 1 起，`page_size` 默认 20、最大 100，越界返回 422；响应为 `{items,total,page,page_size}`。
- `PATCH /products/{id}`、`POST /products/{id}/archive` 的品牌取自商品本身，调用者须是该品牌 admin；商品不存在与无权限都返回 403，不泄露存在性。PATCH 里 `null` 不会清空必填字段。
- `selling_points[].evidence_status` 为响应附加字段：`linked`（有来源）或 `draft`（无来源）。来源必须是本品牌“已审核且为当前版本”的资料，分块必须属于该资料，否则 409；只给 `source_chunk_id` 不给资料同样 409。

### 品牌档案（版本化）
- `GET /brands/{brand_id}/voice-profile`：当前生效档案及版本。
- `GET /brands/{brand_id}/voice-profile/versions`：版本列表。
- `POST /brands/{brand_id}/voice-profile/versions`（admin）：创建新版本（草稿），体含 `persona`、`tone_keywords`、`preferred_words`、`forbidden_words`、`sample_refs`。
- `POST /brands/{brand_id}/voice-profile/versions/{version}/activate`（admin）：设为生效，旧版本保留。
- `POST /brands/{brand_id}/voice-profile/drafts`（admin，**P1**）：基于已入库资料由模型起草，返回草稿，**须人工确认后才能创建版本**。

**实现约定（2026-10-31）**：新版本创建后 `is_active=false`，激活时自动停用旧版本（每个品牌只有一个生效版本，数据库用部分唯一索引保证）；`GET /voice-profile` 在没有生效版本时返回 404；响应字段为 `brand_id, version, persona, tone_keywords, preferred_words, forbidden_words, sample_refs, is_active, created_at`。`drafts`（P1）尚未实现。B 的生成代码通过 `VoiceProfileProvider` 端口取档案，真实实现是 `app.services.voice_profiles.DbVoiceProfileProvider`。

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

**实现约定（2026-10-31）**
- `{document_id}` 是**某个版本行的 id**（响应里的 `id`）；同一逻辑文档的各版本共享 `group_id`。`KnowledgeSearch` 返回的 `document_id` 是 `group_id`，`document_version` 是版本号（ADR-010）。
- 支持 PDF（需有文字，不做 OCR）、DOCX、MD、TXT、CSV，单文件 ≤ 10 MB（超过 413）；解析失败、空文件、不支持的类型返回 422，不保存任何内容。
- 分块：按段落合并，每块 ≤ 500 字，过长段落按句末切分。
- 管理员直接入库与新版本：先解析、分块、嵌入，全部成功后才一次性写入（approved、ready、当前版本）；嵌入模型不可用返回 503，不留下半成品。审计记为 `kb_review` 的 `admin_direct_ingest`。
- 运营提交：解析与分块在提交时完成，**嵌入在审核通过时进行**；通过时嵌入失败返回 503 且状态仍为 `pending_review`。带 `supersedes_document_id` 的提交，通过前仍使用旧的当前版本；supersedes 指向其他品牌的资料返回 404。
- 重建索引（202）：用已保存的分块重新嵌入，只允许 `approved`；失败时 `index_status=failed`（失败期间不可检索）并返回 503。
- 停用只允许 `approved`；审核只允许 `pending_review`；状态不符返回 409（`INVALID_STATE`）。
- 按资源 ID 访问（详情、分块、审核、停用、重建索引）：资源不存在与非本品牌成员一律 404；成员但不是 admin 的写操作与分块预览 403。
- 检索条件：本品牌、`approved`、当前版本、`index_status=ready`、已有向量；按余弦相似度排序，`score = 1 - 余弦距离`。`product_id` 暂未使用（资料尚未关联商品）。传入 `task_id` 时还会返回该任务自己的资料快照分块（`task_material`，只限该品牌、该任务），与 `approved_kb` 结果按分数合并。
- 嵌入模型：百炼 `text-embedding-v4`，写入与查询都显式传 `dimensions=1024`；密钥取自环境变量 `DASHSCOPE_API_KEY`，未配置时入库与审核通过返回 503。

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

**实现约定（2026-10-31，场景、任务与版本的读取部分）**
- 后端现在由 A 与 AI 助手实现（见技术文档第 7 章的分工变更）。
- 全局场景模板由启动脚本（`initial_data`）幂等创建，共 6 个（每个场景一个起步模板，`template_version = 1`）；`GET /scenarios` 返回已启用的全局模板和用户所属品牌的模板。
- `POST /tasks` 的 `brand_id` 在请求体里，所以先显式核验“是否为该品牌成员”（非成员 403）；商品不属于该品牌或不存在 404，已归档商品 409，场景不存在、已停用或属于其他品牌 404。任务与全部资料快照在**同一个事务**里保存，嵌入模型不可用返回 503 且什么都不留下。`brief` ≤2000 字，`required_terms` ≤20 条（去空白去重），`task_materials` ≤5 份、每份 ≤50000 字；`style` 缺省值：`length=medium`、`person=first`、`emoji_density=low`、`hashtag_count=5`。
- `GET /tasks`：`brand_id` 必填；`status` 取流程状态枚举，`sort` 只能是 `-created_at`（默认）或 `created_at`；分页同其他列表。
- 按资源 id 访问（`GET /tasks/{id}`、`/tasks/{id}/versions`、`/generation-versions/{id}`）：不存在与非成员一律 404。
- 流程状态转换的规则在 `app/domain/flow.py`：`ready_to_copy` 没有后续转换（编辑总是创建新版本）；确认的前置条件由 `confirm_blockers` 给出。
- 生成、编辑、重写、复检、确认、导出等写入接口尚未实现（后续步骤）。

### `POST /tasks/{task_id}/generate`
返回 202 与任务状态；支持 `Idempotency-Key`。

### `GET /tasks/{task_id}`
```json
{"id":"…","flow_status":"checking","progress":{"stage":"evidence"},"latest_version_id":"…"}
```
`flow_status`：`queued | generating | checking | checks_completed | needs_human_review | constraint_failed | edited_pending_recheck | ready_to_copy`。仅表示流程，不代表合规通过。

**生成的实现约定（2026-10-31）**
- `POST /tasks/{task_id}/generate` 立即返回 202 和任务当前状态（`generating`），生成在响应之后后台进行，客户端轮询 `GET /tasks/{id}`。只有 `queued` 的任务，或上一次因约束未通过而 `constraint_failed` 的任务可以（重新）生成，其他状态返回 409 `INVALID_STATE`；同一个 `Idempotency-Key`（≤100 字符）重复提交不会启动第二次生成。
- 任务多了 `last_error`（简短、不含密钥的原因）：`model_unavailable`（模型不可用，任务回到原状态，可直接重试）、`invalid_model_output`（模型多次返回不符合格式的输出，任务为 `constraint_failed`）。
- 一次生成最多 3 轮：第 1 轮正常生成，约束检查未通过则把问题告诉模型再生成，最多再 2 轮；每轮格式不符最多再问 1 次，因此一次生成最多 6 次模型调用。仍未通过时保存该版本并标 `constraint_failed`，检查结果里写明哪个标题、哪个字段、哪个词。
- 约束检查对**每一个标题候选**单独判定，对正文加标签判定字数、标签数量、必含词和禁用词；禁用词包括品牌档案的禁用词和商品的“禁止宣称”。
- 约束通过的版本状态为 `checking`，任务进度为 `evidence`：证据与合规检查是后续步骤，完成前版本不会变成 `checks_completed`，更不会是 `ready_to_copy`。
- 版本记录 `template_version`、`prompt_version`（`gen-v1`）、`voice_version`、`checker_version`（`constraints-v1`）、`model`，以及当次检索到的资料快照 `retrieved_sources`（含来源级别、文档与版本、分块 id、哈希和 200 字摘录）。
- 提示词只把**有来源**的卖点当作事实；无来源的卖点标为“未核实，只可参考”；任务资料标为“未审核”。
- 每次模型调用（含失败）写入 `llm_call_log`，用独立事务，调用失败回滚时也留痕。

**检查流程与状态（2026-10-31）**
- 生成后自动依次做：约束检查、事实证据、合规风险提示。任一阶段的版本状态：约束不通过为 `constraint_failed`（后面的检查不再运行）；约束通过后为 `checking`；全部完成后，只要还有未得到支持且无人确认的断言，或有未处理的 `block` 级风险提示，版本为 `needs_human_review`，否则为 `checks_completed`。**这些都是流程状态，不表示合规通过，也不表示事实已被验证。**
- 存在未处理的 `block` 级风险提示时，系统会自动改写，最多 2 轮：每轮把风险提示告诉模型，生成一个新版本（`origin = rewritten`，`parent_version_id` 指向被改写的版本，旧版本和它的提示保持不变），对新版本重新做全部检查；改写后的版本若约束不通过则为 `constraint_failed`。
- 检查过程中模型不可用时，版本保持 `checking`，任务 `last_error = model_unavailable`，之后可以重新检查（重新检查接口在后续步骤）。
- 重新检查会重新抽取断言；**措辞完全相同的断言会保留人工确认**，系统判定的 `status` 不被改写。

**事实证据的实现约定（2026-10-31）**
- 先由模型从标题候选、正文、标签里抽取可核查的事实性说法（最多 12 条），再对每条说法检索最多 3 段资料（本品牌已审核资料，以及本任务的任务资料），让模型判断资料是否支持。没有检索到任何资料的说法不调用模型，直接是 `evidence_missing`。
- 模型说“有依据”时，代码还会核对：引用的资料必须是刚才检索到的，引用的原文必须真的出现在该资料里（忽略空白和大小写）；核对不过的降级为 `needs_human_review`，理由写明“无法核实”。资料与说法矛盾也是 `needs_human_review`。`system_supported` 只表示资料里有对应表述，不表示说法属实。
- 证据项里：`source_level = task_material` 的来源只有 `snapshot_id`，没有 `document_id`，表示任务内资料，**未经审核**。
- `GET /generation-versions/{id}/evidence` 列出证据；版本详情里也带 `claim_evidence`。`POST /claim-evidence/{id}/confirm` 记录人工确认（`human_confirmed`、`note`、确认人与时间），不改变 `status`。按资源 id 访问：不存在或非本品牌成员一律 404。

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
体：`{"selected_title_index":0,"selected_cover_index":0}`。仅当约束已通过、无未处理的 `block` 级风险、各检查已针对最终文本运行、且**每条没有系统依据的断言都已有人工决定并且是“成立”**时才允许，否则 `INVALID_STATE`。成功后 `ready_to_copy`，记录 `confirmed_by/confirmed_at`。该状态不表示法律合规获批。

**编辑、重写、重新检查、确认与导出的实现约定（2026-10-31）**
- 都按版本的所属品牌做资源 id 授权：不存在或非本品牌成员一律 404；品牌任意成员（editor 或 admin）都可以操作，操作人写入审计。任务正在生成（`generating`）时，编辑、重写、重新检查返回 409。
- `POST /generation-versions/{id}/edit`（201）：请求体字段同版本内容（标题候选至少 1 个、正文非空、标签 ≤20、封面 ≤5，空白项被去掉）；创建新版本（`origin=edited`，`parent_version_id` 指向被编辑的版本，`model` 为空，因为文字是人写的），状态 `edited_pending_recheck`，成为任务的最新版本；原版本不变。
- `POST /generation-versions/{id}/recheck`（202）：立即把版本置为 `checking` 并返回，后台依次重跑约束、证据、合规。允许的起始状态：`checking`、`edited_pending_recheck`、`needs_human_review`、`checks_completed`、`constraint_failed`；`ready_to_copy` 是终态，返回 409。检查途中模型不可用时版本保持 `checking`，任务 `last_error=model_unavailable`，可再次重检。**重检不会自动改写**（自动改写只在生成之后发生）。
- `POST /generation-versions/{id}/rewrite`（202）：`target` 为 `titles | opening | body | cover`，`instruction` 可选（≤500 字）。同步调用模型生成改写结果并保存为新版本（`origin=rewritten`，指向被改写的版本；模型不可用返回 503 且不保存任何东西），随后后台自动对新版本做全部检查。提示词只让模型改写所选部分，其余原样保留。
- `POST /generation-versions/{id}/confirm`：体 `{selected_title_index, selected_cover_index?}`（索引越界 422）。**只有任务的最新版本可以确认**；条件：状态为 `checks_completed` 或 `needs_human_review`（即检查针对的就是这份文字）、约束已通过、没有未处理的 `block` 级风险提示；否则 409 `INVALID_STATE`，`message` 与 `details.reasons` 列出全部原因，`details.codes` 给出稳定的原因代码。
  **人在回路**：每条状态不是 `system_supported` 的断言都需要有人用 `POST /claim-evidence/{id}/confirm` 做决定——判定“成立”（建议写备注）后该断言放行，并在稿件和导出里标注为“人工确认，不是系统验证”；判定“不成立”或还没有决定，都不能确认（代码 `rejected_claims`、`unconfirmed_claims`），出路是改写稿件并重新检查，新版本的断言重新判断。系统的判定 `status` 不会被改写。成功后 `ready_to_copy`，记录确认人和时间，写 `version.confirm` 审计（含人工确认的断言数）。**这表示运营确认了文字，不表示合规通过，也不表示事实已被验证。**
- `GET /generation-versions/{id}/export?format=xhs_parts|markdown`：只有 `ready_to_copy` 才能导出（409）；`format` 缺省或不是这两个值 422。`xhs_parts` 返回 `{format,title,body,tags,counts,verification}`（`verification` 是 `{system_supported, human_confirmed}`，用来在界面上标注“其中 N 条为人工确认”；正文不夹带标注），标题取选定的标题，正文换行统一为 LF、去行尾空白、去掉 Markdown 标记（标题行 #、加粗、代码符号），保留 emoji；`tags` 不带 `#`；`counts` 是 `title_weight / body_units / tags_visible_units / tags_count`。`markdown` 返回 `{format,content}`，是唯一包含封面文案的格式；有人工确认的断言时，末尾有“人工核对记录（资料里没有依据，由人工确认，不是系统验证）”，逐条列出断言和备注。

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

### 给前端的补充说明（2026-11-01，回应 B 的对照审阅）
- **我在当前品牌里的角色**：`GET /brands` 的每一项带 `role`（`admin` 或 `editor`，就是当前用户在该品牌里的角色），导航按角色显示或隐藏就用它；`GET /users/me` 没有品牌角色。
- **任务列表项** `GET /tasks`：`id, brand_id, product_id, product_name, scenario_id, scenario_name, scene, style, brief, required_terms, flow_status, progress, latest_version_id, last_error, created_at`。`flow_status` 就是最新版本的状态。任务详情和 `generate` 的返回字段相同。
- **版本列表项** `GET /tasks/{id}/versions`：`id, task_id, version_no, parent_version_id, origin（generated | edited | rewritten）, flow_status, title_candidates, body, hashtags, cover_candidates, constraint_checks, retrieved_sources, template_version, prompt_version, voice_version, checker_version, model, selected_title_index, selected_cover_index, confirmed_at, created_at`。版本对比没有专门接口，由前端比较两个版本。
- **证据项**多了 `source_title`：已审核资料是文档标题，任务内资料是文件名；`quote` 是引用的原文。`document_id` 是逻辑文档 id（同一资料的所有版本共享），`document_version` 是版本号。
- **风险提示项**多了 `source_url`（规则当前的来源链接，通过 `rule_id` 取；模型语境层发现的提示没有规则，为空）；`source_name`、`source_clause`、`region_scope` 在提示里随记录保存。
- **风格参数** `style`：`tone` 自由文本（可空）；`length` ∈ `short | medium | long`（建议显示：偏短、适中、偏长）；`person` ∈ `first | second | third`（第一、第二、第三人称）；`emoji_density` ∈ `low | medium | high`（很少、适量、较多）；`hashtag_count` 0 到 10，默认 5。
- **`progress.stage`** 实际会出现的值：`retrieving`、`generating`、`evidence`、`compliance`、`rewriting`、`done`，没有进行中的阶段时为 `null`（`constraint_check` 保留，目前不单独出现，约束检查在 `generating` 与 `evidence` 之间瞬间完成）。
- **被拒绝的操作**（`INVALID_STATE`，409）的 `details` 里有 `current_state`；确认被拒时还有 `codes`（`status_not_confirmable`、`checks_not_run`、`constraints_failed`、`open_block_risks`、`rejected_claims`、`unconfirmed_claims`、`not_latest_version`）和 `reasons`（数组，每条一个原因，`message` 是它们用“；”连起来的文字；只有非最新版本时 `reasons = ["not_latest_version"]`）。前端可以用 `reasons` 逐条显示。
- **限流**：目前没有任何接口返回 `429 RATE_LIMITED`（没有实现限流）。前端保留通用处理（读取 `Retry-After`）即可，不需要为它设计专门的页面状态。
- **生成失败的展示**以任务的 `last_error` 为准：`model_unavailable`（模型不可用，任务回到原状态，可直接重试）、`invalid_model_output`（模型多次返回不合格的格式，任务为 `constraint_failed`）。
- **确认**：最新版本在 `checks_completed` 或 `needs_human_review` 时可以确认，前提是没有未处理的 block 级提示，且每条没有系统依据的断言都已有人工决定并且是“成立”。有断言“未决定”或被判“不成立”时确认按钮应禁用，旁边列出这些断言并提供“成立 / 不成立”的操作（调用断言确认接口，备注建议必填），不要让用户猜原因。人工确认过的断言要标注为“人工确认（非系统验证）”，版本详情的 `evidence_summary` 给出 `total, system_supported, human_confirmed, unconfirmed, rejected`。`selected_cover_index` 可选。`ready_to_copy` 是终态，不能再重检；非最新版本不能确认。

## 6. 合规规则（B）

- `GET /compliance-rules?layer=&rule_type=&severity=&brand_id=&page=`：登录用户可查全局规则与所属品牌规则。
- `GET /compliance-rules/{rule_id}`：规则详情。
- 字段：`id`、`brand_id|null`、`layer`、`rule_type`（`absolute_term | efficacy_claim | medical_term | data_claim | platform_rule | brand_forbidden`）、`pattern`、`is_regex`、`severity`、`suggestion`、`source_name`、`source_url`、`source_clause`、`region_scope`、`effective_from`、`effective_to`、`rule_version`、`enabled`。
- 规则的创建、修改、停用属 **P2**（品牌 admin）；P0 规则由种子数据或评测目录导入，不通过 API 编辑。

**合规规则与风险提示的实现约定（2026-10-31）**
- 本节取代上面“规则的创建、修改、停用属 P2”的说法：规则现在可由人在前端维护。`POST /compliance-rules` 创建**全局**规则（仅平台管理员）；`POST /brands/{brand_id}/compliance-rules` 创建**品牌**规则（仅该品牌 admin）；`PATCH /compliance-rules/{id}` 修改或停用（`enabled=false`），全局规则由平台管理员改，品牌规则由该品牌 admin 改；每次修改 `rule_version` 加 1，并写审计。读取：全局规则所有登录用户可见，品牌规则只对该品牌成员可见（否则 404）；带 `brand_id` 查询需是该品牌成员（否则 403）。
- 规则内容 `pattern`（≤200 字）可以是普通文字或正则；正则会被校验，嵌套重复等可能让检查卡住的写法和无效表达式返回 422。`layer = context` 由模型判断，不能用规则内容配置。
- 随项目提供的起步规则标为 `is_sample = true`，来源写“示例规则（来源待人工核对，不是正式依据）”；人工修改后不再是示例。**它们不是法律依据，使用前须按真实来源核对。**
- 三层：`lexicon`（命中即提示）；`efficacy_basis`（功效、医疗、数据类说法：该句有 `system_supported` 或已人工确认的断言支持时，`basis = found` 并从 `block` 降为 `warn`，否则 `basis = none` 保持原严重度）；`context`（模型读全文找没有违禁词的隐含说法，模型指出的句子必须真的出现在文中，否则丢弃）。
- 每条提示保存规则 id、规则版本和规则文字的副本（规则以后被改动或删除，历史记录不变），以及字段（`title.N`、`body`、`hashtags`、`cover.N`）和位置 `span`。
- `GET /generation-versions/{id}/compliance` 返回提示列表和 `unresolved_block`（未处理的 `block` 级提示数）；`POST /compliance-checks/{id}/resolve`（体 `{note}`）记录“有人处理过”，提示本身保留，**不表示文字合规**。
- 这些只是风险提示，供人工复核；任何界面或文案都不得称为“合规通过”或“法务批准”。

## 7. 评测（B）

- `GET /evaluation/datasets?kind=`：品牌 admin；`kind`：`generation | compliance | factcheck | brand_leak`。
- `POST /evaluation/datasets`（admin）：`{"name","kind","brand_id|null","cases":[{"input":{…},"expected":{…},"annotators":["…"]}]}`；创建后**版本固定**，修改产生新版本，旧版本保留。
- `GET /evaluation/datasets/{dataset_id}/cases?page=`
- `GET /evaluation/rubrics`：人工评分表（维度、分值、说明、`rubric_version`）。
- `POST /evaluation/runs`（admin，支持幂等）：`{"dataset_id","model_ids":["…"],"prompt_version":"…","baselines":["lexicon_only","no_verification"]}`；返回 202 与 `run_id`。
- `GET /evaluation/runs?dataset_id=&page=`；`GET /evaluation/runs/{run_id}`：样本数、各版本（dataset/model/prompt/checker/rubric）、指标明细、失败项；**不得只返回无定义的综合分**。
- `POST /evaluation/runs/{run_id}/ratings`：`{"result_id","scores":{"structure":4,"tone":3},"rubric_version","note"}`；评分者取自登录用户。
- `GET /evaluation/runs/{run_id}/agreement`：评分者人数、样本数与一致性统计（方法在响应中注明）。

**评测的实现约定（2026-10-31）**
- 权限：评测集、运行、结果、评分只对**品牌 admin**可见（品牌评测集），全局评测集对平台管理员和任一品牌的 admin 可见；创建品牌评测集需要该品牌 admin，创建全局评测集（`brand_id = null`）需要平台管理员（否则 403）。看不到的评测集、运行一律 404。
- 评测集类型与样本格式（创建时校验，不合格 422 并指出第几条）：
  - `compliance`：`input.text`；`expected.hit_words`（应当被命中的词）。
  - `factcheck`：`input.claim`、`input.sources`（1 到 5 段资料）；`expected.verdict` 为 `supported | insufficient | conflict`。
  - `generation`：`input.product_name`、`input.scene_name`，可选 `brand_name`、`category`、`scene_structure`、`brief`、`required_terms`、`style`、`facts`；`expected.forbidden_words` 可选。
  - `brand_leak` 属后续功能，创建评测集或运行返回 422。
- 版本：评测集创建后内容固定；带 `previous_version_id` 创建时生成同一 `group_id` 的下一个版本（类型和品牌必须相同），旧版本保留。每个版本有 `content_hash`。
- 运行（`POST /evaluation/runs`，202，后台执行，可带 `Idempotency-Key`）：`model_ids` 必须是 `GET /models` 里的模型（未知模型 422）；`factcheck`、`generation` 至少选一个模型，`compliance` 不用模型。`baselines` 按类型限定：`compliance` 只有 `lexicon_only`（只用词库层，不含功效依据层），`factcheck` 只有 `no_verification`（相信所有说法），`generation` 没有基线。
- 运行详情返回：样本数、各项版本（评测集版本、提示词版本、检查器版本、评分表版本、模型、基线）、**按系统分组的指标**（每个指标带 `name`、`value`、`definition`、`n`），以及失败项（哪个样本、哪个系统、简短原因）。**没有综合分。**一个样本失败不会中断整个运行，失败计入指标：生成类的失败算“未通过约束”，核查类的失败算“判断错误”。运行崩溃时状态为 `failed`，`error` 只含异常类型名。
- 指标：`compliance`——precision、recall、f1、exact_match_rate；`factcheck`——accuracy、**unsupported_accepted_rate**（没有依据或相矛盾的说法被误判为有依据的占比，越低越好）、supported_recall；`generation`——constraint_pass_rate、block_hint_rate、failure_rate、avg_latency_ms、avg_cost、avg_tokens。`avg_cost` 只在配置了价格时才有值。生成类评测只看模型的第一次回答，不做纠正重试。
- `GET /evaluation/runs/{id}/results` 列出逐项结果（输出、详情、是否通过、耗时、费用）。
- 评分：`GET /evaluation/rubrics` 返回评分表 `rubric-v1`（结构、调性、具体度、贴合资料，1 到 5 分，各维度分开，**不合成总分**）。`POST /evaluation/runs/{id}/ratings` 的评分者取自登录用户，四个维度都必须有分且在范围内，`rubric_version` 必须是当前版本；同一评分者对同一结果再次提交会替换之前的分数。`GET /evaluation/runs/{id}/agreement` 返回评分者人数、已评样本数，以及**每个维度**的评分者两两加权 Cohen's kappa 的平均值、完全一致比例和相差不超过 1 分的比例，`method` 字段写明计算方法；不足以计算时对应值为 `null`。
- `GET /models`（登录用户）：`{id, provider, model_name, enabled, price_in_per_1k, price_out_per_1k, price_version}`；价格来自配置（`DEEPSEEK_PRICE_IN_PER_1K`、`DEEPSEEK_PRICE_OUT_PER_1K`、`LLM_PRICE_VERSION`），没有配置时为 `null`，成本不会被猜测。`enabled` 表示是否配置了密钥。

## 8. 模型与成本（B）

- `GET /models`：登录用户；`{"items":[{"id","provider","model_name","enabled","price_in_per_1k","price_out_per_1k","price_version"}]}`。价格为配置数据，非硬编码。
- 调用日志不通过 API 暴露原始请求；费用在版本与评测结果里汇总。

## 9. 审计（A，P2）

`GET /audit-logs?brand_id=&action=&page=`（品牌 admin）：关键操作（入库、审核、停用、越权尝试）；P0 只写不读。

## 10. P1 接口（F13 审议稿与其他占位）

- 多模型对比（B）：`POST /model-comparisons`（幂等）；`GET /model-comparisons/{id}`：并列各模型的约束通过率、人工评分、延迟、费用；失败模型单独显示。
- 任务文件输入（A 解析、B 消费）：`POST /tasks` 的 `task_materials` 扩展为文件上传，只存任务快照，不建知识库索引。

### 10.1 F13：爆款结构分析（契约审议稿，待 A/B 确认，尚未实现）

仅支持用户手动贴入已获授权的文本，提取结构标签和抽象模板，不承诺传播效果；样本属于当前品牌，不进入知识库或任务检索。下列接口尚未实现。F15 不在本次交付范围。

#### 样本创建与读取

| 方法与路径 | 权限/请求 | 成功 |
|---|---|---|
| `POST /brands/{brand_id}/viral-samples` | 品牌成员；JSON `{text,note?,source_url?}` | 201 `ViralSample` |
| `GET /brands/{brand_id}/viral-samples` | 品牌成员；分页同 §1.3，sort 仅 ±created_at | 200 标准分页，items 为去掉 text 的样本元数据加 excerpt |
| `GET /viral-samples/{sample_id}`（新增读取建议） | 样本品牌成员 | 200 `ViralSample`，供刷新恢复 |
| `GET /viral-samples/{sample_id}/patterns`（新增读取建议） | 样本品牌成员；分页同 §1.3 | 200 标准分页，items 为已成功保存的模式，created_at DESC、id DESC |
| `GET /viral-patterns/{pattern_id}`（新增读取建议） | 模式品牌成员 | 200 `ViralPattern`，供分析结果刷新恢复 |

显式品牌路径非成员为 403；样本/模式 id 不存在或非成员为 404。平台管理员也不能跳过品牌成员检查。所有接口需 JWT。

创建示例：

```json
{"text":"演示样本：先提出场景，再描述香调，最后提出选择建议。","note":"自编演示样本","source_url":"https://example.com/note"}
```

`text` 必填，原始输入 1–5000 Unicode 码点；清除既有规则规定的隐藏话题后缀后去首尾空白，保存文本仍需 1–5000 码点。保留话题名，不按标题字数算法计数。`note` 可空，≤1000 码点；`source_url` 可空，≤2000 字符，仅允许合法 http/https URL，作为文本记录，服务端绝不访问、抓取或下载。UUID 格式错为 422。201 `ViralSample` 示例：

```json
{"id":"66666666-6666-4666-8666-666666666666","brand_id":"22222222-2222-4222-8222-222222222222","text":"演示样本：先提出场景，再描述香调，最后提出选择建议。","note":"自编演示样本","source_url":"https://example.com/note","created_at":"2026-11-01T00:00:00Z"}
```

列表 item 含 id/brand_id/note/source_url/created_at/char_count/excerpt（保存文本前 200 码点），不带 text；分页响应 `{items,total,page,page_size}`。样本创建无需幂等；重复请求会创建新样本。创建后只读，本稿不提供编辑/删除接口。

#### 分析与结果

`POST /viral-samples/{sample_id}/analyze`，品牌成员，JSON 请求 `{model_id}`（必须是 GET /models 已知模型，1–80 字符），建议客户端总是带 `Idempotency-Key`（1–100 字符）。同步分析，成功 201 `ViralPattern`；不创建独立后台作业，前端等待并可在网络恢复后重放同键或读取已保存模式。选择同步 201 是为匹配计划中同步暴露 503 的失败恢复，避免额外新增轮询作业契约。

```json
{"model_id":"deepseek-flash"}
```

`ViralPattern` 示例：

```json
{"id":"77777777-7777-4777-8777-777777777777","sample_id":"66666666-6666-4666-8666-666666666666","brand_id":"22222222-2222-4222-8222-222222222222","title_pattern":"场景与选择问题","hook_type":"场景设问","paragraph_structure":["引入场景","展开资料","收束建议"],"tone":"克制","emoji_usage":"少量分隔段落","hashtag_usage":"使用场景类话题","abstract_template":"围绕{{scene}}提出问题，以{{supported_facts}}展开，给出{{closing}}。","model_id":"deepseek-flash","prompt_version":"viral-v1","checker_version":"viral-copy-v1","created_at":"2026-11-01T00:00:00Z"}
```

- `title_pattern`、`hook_type`、`tone`、`emoji_usage`、`hashtag_usage` 为非空描述文本，各 ≤200 码点；不是前端写死的枚举。`paragraph_structure` 有序列表 1–20 条，每条非空、≤300 码点；`abstract_template` 非空、≤5000 码点，使用 `{{scene}}`、`{{supported_facts}}`、`{{closing}}` 等占位符，不保存样本长句。模型结果只接受本节结构字段；id/品牌/版本由服务端赋值。
- 输出先做结构校验，再做复制检查：样本与所有结构文本字段分别经过 Unicode NFKC、移除 Unicode 空白；任一输出字段出现与样本连续 ≥12 个相同码点即拒绝。包括 abstract_template，不仅检查模板字段，避免其他字段夹带原句。短样本仍接受但该阈值不能发现 <12 字复用；此检查不代表所有改写或授权问题均已排除。
- 模型结构或复制检查不满足时反馈一次并最多重试一轮（总计最多 2 次分析模型调用）。最终不合格返回拟新增 422 `INVALID_MODEL_OUTPUT`（不是既有任务 last_error 字段），details.reason 为 `schema_invalid` 或 `copied_text`；不保存不合格模式。模型超时/不可用返回 503 MODEL_UNAVAILABLE，不保存半成品。
- 分析过程为请求内“校验→模型分析→代码检查→提交成功结果”；不增改既有任务 flow_status。样本只读；每次非幂等重放的成功分析产生新模式，旧模式不覆盖。同步超时后用户可以用同键确认原结果。
- analyze 幂等按用户+sample_id+操作隔离，指纹为规范 JSON 请求体；成功记录保留至资源生命周期结束，相同体同键返回同一 201 模式；不同体 409 IDEMPOTENCY_CONFLICT；同键处理中 409 CONFLICT（reason=operation_in_progress）；失败释放键可重试。重放先重新授权，不重复模型调用和成功审计。

#### 转为品牌场景模板

`POST /viral-patterns/{pattern_id}/to-template`：**权限待 A 决定**，建议仅该品牌 admin，editor 返回 403；非成员与不存在仍为 404。以下请求、权限和示例属于此建议分支，不能在 A 确认前据此实施权限变更。

```json
{"name":"场景引导模板","scene":"seeding"}
```

`name` 去首尾空白后 1–100 码点；`scene` 只取现有 `seeding|review|tutorial|launch|promotion|story`。不接受 brand_id 或替换模式内容。成功 201 示例：

```json
{"id":"88888888-8888-4888-8888-888888888888","brand_id":"22222222-2222-4222-8222-222222222222","name":"场景引导模板","scene":"seeding","structure":"围绕{{scene}}提出问题，以{{supported_facts}}展开，给出{{closing}}。","template_version":1}
```

模式属于哪个品牌，模板就创建在哪个品牌，不能转成全局模板或另一品牌模板。结构来自已校验的 abstract_template，模板启用后由现有 GET /scenarios 返回给有权用户，不改变旧模板；不把样本原文带入模板。本操作可带 Idempotency-Key（同 analyze 的作用域规则，资源改为 pattern_id、操作独立）；无键重复转换会创建多个独立模板，不覆盖旧模板。创建与审计原子提交。

#### 错误、保留与审计

| HTTP / code | 条件与 details | 恢复 |
|---|---|---|
| 401 `UNAUTHENTICATED` | 任意接口未登录 | 登录后重试 |
| 403 `FORBIDDEN` | 显式品牌路径非成员；或 to-template 角色不足（待 A 定） | 不能越权 |
| 404 `NOT_FOUND` | 样本/模式不存在或非所属品牌成员 | 不泄露存在性 |
| 422 `VALIDATION_ERROR` | 空文本/超长、非法 URL/scene/model_id/UUID/分页；details.errors | 修正输入 |
| 422 `INVALID_MODEL_OUTPUT`（拟新增） | 分析重试后仍结构错/连续复制；details.reason | 换输入或新请求；不返回模型原始输出 |
| 409 `IDEMPOTENCY_CONFLICT` | 同键不同请求 | 换键 |
| 409 `CONFLICT` | 同键仍在处理；details.reason | 等待后原键重试 |
| 503 `MODEL_UNAVAILABLE` | 模型未配置、超时或不可用 | 样本保留，无模式半成品；原键重试 |
| 500 `INTERNAL_ERROR` | 意外故障，仅通用错误与 request_id | 按幂等键查询/重放 |

错误示例：

```json
{"error":{"code":"INVALID_MODEL_OUTPUT","message":"分析输出不符合结构要求","details":{"reason":"copied_text"},"request_id":"req-uuid"}}
```

- 没有样本/模式启停或草稿中间状态，因此本次没有需要 409 INVALID_STATE 的已定义转换；若以后增加删除/过期状态，须另补可读与操作矩阵，不能自行给已删除资源重新分析。
- **待 A 决定：样本保留期限**，以及到期是否删除原文、保留哪些元数据和关联模式、已转模板如何继续引用。当前契约不定期限、不增加自动清理任务；该问题需在实现前解决。另待 A 确认 to-template 权限是否采用本稿品牌 admin 建议。
- 每次模型调用（含失败及重试）独立记录 llm_call_log，不在错误/审计里保存原始敏感模型输出。成功创建样本写 viral.sample_create，成功分析写 viral.analyze，转换写 viral.to_template；detail 仅资源 id、长度、模型/版本，原文与原链接不写审计。失败不写成功审计；成功结果与审计原子提交，快照、旧模式不覆盖。
- 新增三个读取接口的理由：原占位只有创建/分析/转换，无法在页面刷新后恢复样本全文与已分析结果；读取仍沿用品牌成员隔离，不引入跨品牌访问。

## 11. 合同变更流程

1. 提案人先更新本文与 JSON 样例，说明兼容影响。
2. API 所有者与调用方共同审查，在 PR 评论里确认后更新 OpenAPI 与 DTO（GitHub 不强制批准，见 ADR-009，所以评论确认是必须的）。
3. 服务端先支持向后兼容，再合并前端；前端重新生成客户端，CI 的 `contract` 检查须无漂移。
4. 每个新增或修改的端点补成功、验证错误、未授权、越权测试。

## 12. 变更记录

- 2026-11-01 F13 契约审议稿：新增接口/字段、权限、幂等、错误与失败恢复；待 A/B 确认，尚未实现。用例 TC-146 至 TC-157。

- v1.1：补齐第 2、3、4（版本、分块、重建索引）、5（场景、风格、任务列表、局部重写、断言确认、选定标题、导出格式）、6、7（创建、评分、一致性）、8；明确 403 与 404 策略、分页、幂等、文件限制；关闭自助注册。
- v1.0：初版（见原 API_CONTRACT.md）。
