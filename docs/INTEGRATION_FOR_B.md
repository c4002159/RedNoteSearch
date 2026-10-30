# 给 B 与 B 的 AI 助手：如何接入 A 已交付的部分

本文件由 A 维护，随 A 的交付更新（见文末“最后更新”）。**写 B 的代码前先读本文件，并用 `git log`、`alembic heads` 核对它没有过时。** 与它冲突时，契约字段听 `API_CONTRACT.md`，流程规则听 `docs/decisions/`。

## 1. 原则：只依赖端口，不依赖 A 的实现细节

B 的领域逻辑（约束、证据匹配、合规、评测、生成编排）**只 import `app.ports`**，真实实现通过依赖注入拿到。这样 A 内部怎么改都不影响 B，单元测试用 `app.fakes` 里的内存实现即可，不需要数据库。

| 端口（`app.ports`） | 真实实现 | 测试用 fake | 状态 |
|---|---|---|---|
| `KnowledgeSearch` | `app.services.knowledge_search.DbKnowledgeSearch(session, embedder)` | `app.fakes.knowledge.FakeKnowledgeSearch` | 已实现（PR #17） |
| `VoiceProfileProvider` | `app.services.voice_profiles.DbVoiceProfileProvider(session)` | `app.fakes.voice.FakeVoiceProfileProvider` | 已实现（PR #16） |
| `TaskInputRepository` | `DbTaskInputRepository(session)`（随任务资料快照的 PR 交付） | `app.fakes.task_input.FakeTaskInputRepository` | 进行中 |
| `EmbeddingProvider` | `app.infra.dashscope.DashScopeEmbeddingProvider()` | `app.fakes.embedding.FakeEmbeddingProvider` | 已实现（PR #17） |

改任何端口（签名、字段、语义）都是契约变更：先在 PR 里 @ 对方，不要为了方便单方面改。

## 2. 检索语义（`KnowledgeSearch`）——生成与证据必须按这个理解

- 只返回**本品牌、`approved`、当前版本、已建好索引**的分块；待审、驳回、停用、被取代的版本永不出现。
- `KnowledgeChunk.document_id` 是**逻辑文档 id（`group_id`）**，`document_version` 是版本号；`chunk_id` 指向具体分块。证据记录请同时保存 `document_id`、`document_version`、`chunk_id`、`content_hash`，不要只存文本。
- `score = 1 - 余弦距离`，越大越相关；它只表示检索相关，**不代表事实正确**，“系统判定支持”仍需 B 的证据匹配逻辑和人工确认。
- `task_material` 只在传入 `task_id` 且该任务有快照时返回，且只返回该任务自己的快照。`product_id` 目前不起作用（资料尚未关联商品）。
- 模型不可用时抛 `ModelUnavailableError`（HTTP 503）：生成流程要把它当作可恢复的显式错误状态，不要吞掉。

## 3. 商品与品牌档案

- 商品表 `product`：`selling_points` 是 JSONB 列表，每条有 `text`、可选 `source_document_id`、`source_chunk_id`。**只有有来源的卖点（`evidence_status = linked`）才能作为证据**；无来源的是草稿。`restricted_claims` 是该商品不得使用的宣称，合规检查应读取。
- 品牌档案：`VoiceProfileProvider.get_active(brand_id=…)`，没有生效版本返回 `None`；任务要记录用到的 `version`（契约 `voice_version`）。

## 4. 写路由的规则

- **品牌授权**：路由里用 `app.api.brand_deps` 的 `BrandAccessDep`（成员）、`BrandAdminDep`（品牌 admin）。品牌 id 只来自 URL 路径，不信请求体里的 `brand_id`；平台管理员不是品牌数据的万能钥匙。品牌在路径里的路由，非成员返回 403。
- **按资源 id 访问**（任务、版本、资料等路径里没有 brand_id 的）：先读资源，再用资源自己的 `brand_id` 查成员关系；**资源不存在与非成员一律返回 404**。可照抄 `app/api/routes/knowledge.py` 里的 `get_document_access` / `get_document_admin`。
- **错误**：不要自己拼 `{"detail": …}`。在服务层抛 `app.services.errors` 里的 `NotFoundError`（404）、`ConflictError`（409）、`InvalidStateError`（409）、`ParseError`（422）、`ModelUnavailableError`（503）；需要新的错误类型时加在 `errors.py` 并在统一处理里映射，并把错误码写进契约。统一错误信封见 PR #15（`{"error":{"code","message","details","request_id"}}`），前端只在 401 登出。
- **分页**：`page` ≥ 1，`page_size` 默认 20、最大 100，越界 422（`Query(ge=…, le=…)`）。
- **客户端**：改了接口后运行 `bash scripts/generate-client.sh` 并提交 `frontend/src/client`，CI 的 `contract` 会检查；不要手改生成文件。

## 5. 数据库与迁移（ADR-001）

- 各写各表：B 只写自己的表和迁移；可以外键引用 A 的表（`brand`、`product`、`kb_document`、`kb_chunk`、`user`），**不得改 A 的表**，也不得改被引用的主键。
- A 的表：`tenant`、`brand`、`brand_member`、`product`、`brand_voice_profile`、`kb_document`、`kb_review`、`kb_chunk`，以及即将加入的 `task_input`、`audit_log`。
- 迁移保持线性：开工前运行 `alembic heads`，你的 `down_revision` 必须是当时唯一的 head；合并前如果 `main` 又前进了，把你的 `down_revision` 改到新的 head，再确认只剩一个 head。不使用 `alembic merge`。
- 新模型文件要在 `app/models/__init__.py` 里导入，否则 `alembic check` 失败。
- 本机没有 Docker 时，数据库测试与迁移只能看 CI，不要声称本地跑过。

## 6. 测试约定

- 纯逻辑测试不要连数据库：参考 `backend/tests/ports/conftest.py` 覆盖模板的 autouse `db` 夹具。
- 需要数据库的接口测试：参考 `backend/tests/api/routes/test_brands.py` 里的 `_create_brand`、`_add_member`、`_make_user`；测试用嵌入器用 `app.dependency_overrides[get_embedder]` 换成 `FakeEmbeddingProvider`，**不要在测试里调用真实模型**。
- 改接口要覆盖 401/403（或 404）、校验错误和跨品牌访问；不降低既有断言。

## 7. 模型调用与密钥

- 密钥只放本地 `.env`（已被 git 忽略），不得进仓库、日志、PR 或聊天；变量名见 `.env.example`（`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`OPENAI_API_KEY`）。
- 生成用 DeepSeek（`deepseek-flash`、`deepseek-v4-pro`）等见 ADR-006；LLM 适配层归 B。嵌入统一走 `EmbeddingProvider`，维度固定 1024，不要在别处另建嵌入。
- 对模型输出做 schema 校验；超时、限流、空响应要有显式错误状态，重试有上限。

## 8. 当前请 B 确认的事项（在对应 PR 的评论里回复）

| PR | 请确认 |
|---|---|
| #14 品牌授权 | `BrandAccessDep` / `BrandAdminDep` 的语义与你的路由需求一致；路径里有 brand_id 的 403、按资源 id 的 404 这套约定可接受 |
| #15 错误信封 | 错误响应改为 `{"error":{…}}`、令牌无效 401、前端只在 401 登出；你的前端代码若读过 `detail` 需要改 |
| #16 商品与档案 | `selling_points` 的 `evidence_status`、`restricted_claims` 字段够不够你的证据与合规逻辑；`VoiceProfile` 字段够不够生成用 |
| #17 知识库 | `KnowledgeChunk.document_id = group_id` 的含义；`score` 够用；新增依赖 `pypdf`、`python-docx`；迁移 `f6b3d8e1a4c2` |
| 其他 | 发布页两条规则请你实测后告知：超限时“发布”按钮是否拦截；标题里全角标点与 emoji 的计数（ADR-004 待验证项） |

## 9. 遇到不确定时

- 契约没写、端口没说清的，先在 PR 评论里 @ A 问，不要猜；A 同样会 @ 你。
- 需要 A 的表加字段、加索引或加端口方法：开一个只含该变更和理由的小 PR（或 issue），由 A 实现。
- 冲突处理见 `CLAUDE.md` 的“减少合并冲突”。

最后更新：2026-10-31（PR #14–#17 之后）。
