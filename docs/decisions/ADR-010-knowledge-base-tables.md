# ADR-010 品牌与知识库表结构的细化

状态：已确认实现方案（2026-10-31，成员 A 的实现）；表在 CI 的 PostgreSQL 上的验证见 PR。细化技术文档 5.5 与 ADR-001、ADR-006。

## 范围
新增六张表：`tenant`、`brand`、`brand_member`、`kb_document`、`kb_review`、`kb_chunk`（迁移 `d4e1b8c6a2f7`）。`product`、`brand_voice_profile`、`audit_log` 等随后续 PR 补充。

## 决定与理由
1. **文档版本用“一版一行”**：`kb_document` 每行是一个版本；`group_id` 标识跨版本的逻辑文档，`(group_id, version)` 唯一，`supersedes_id` 指向上一版，`is_current` 标记检索可用的版本。契约和 `ports` 里的 `document_id` 取 `group_id`，`document_version` 取 `version`；`kb_chunk.document_id` 引用具体版本那一行。
2. **“当前版本唯一”不用数据库部分唯一索引**，由服务层在事务里保证（审核通过时先取消同组旧版本的 `is_current`）。原因：本地无法跑 PostgreSQL，部分唯一索引与 `alembic check` 的兼容性无法在本机验证，先用普通索引 `ix_kb_document_group_current`。
3. **状态用字符串加 CHECK 约束，不用 PostgreSQL 枚举类型**：枚举值来自 `app/models` 里的 `StrEnum`，CHECK 由同一份枚举生成；改枚举只需要改约束，不需要 `ALTER TYPE`。
4. **向量列 `vector(1024)`**（ADR-006，已实际调用验证）；HNSW 索引用余弦距离（`vector_cosine_ops`）。改维度需要重建全部嵌入与索引。
5. **暂不建 `tsv` 全文检索列**：中文需要先分词，混合检索是渐进项；等实现时再加迁移。
6. **`metadata` 列命名为 `meta`**：`metadata` 是 SQLAlchemy 声明式基类的保留名。
7. **`tenant` 与 `brand.tenant_id` 现在就建**（非空）：以后再补会遇到回填问题。`app_user` 暂不加 `tenant_id`，用户与品牌的关系由 `brand_member` 表达。
8. **外键删除规则**：品牌删除会级联删除其文档、分块与评审；用户删除只把 `submitted_by`、`actor_id` 置空，保留审核历史；`brand_member` 随品牌或用户级联删除。
9. **`kb_review` 追加式**：应用只插入，不更新或删除；这一点目前靠服务层约定，没有数据库触发器。
10. **新依赖**：`pgvector`（Python 包，0.5.1），只用其 SQLAlchemy 的 `Vector` 类型。锁文件格式 `revision` 保持为 5。

## 影响与风险
- **本地没有 PostgreSQL**，迁移的升级、回滚、`alembic check` 与向量查询测试只能在 CI 里验证；本地已验证：模型导入、类型检查、结构测试（不需要数据库）、迁移生成的离线 SQL 与模型生成的 DDL 一致。
- 与 B 的关系：B 的表（`task`、`generation_version` 等）可以外键引用 `brand`，但不得改动被引用的主键（ADR-001）。

## 后续补充（2026-10-31，知识库入库与检索）
- `kb_review.action` 增加 `admin_direct_ingest`（迁移 `f6b3d8e1a4c2`），用于记录管理员直接入库的审计事件。
- 新依赖 `pypdf`（BSD-3-Clause）与 `python-docx`（MIT，间接依赖 `lxml`，BSD-3-Clause），只用于解析上传的 PDF 与 DOCX，不做 OCR。
- 嵌入在写入前完成、一次性提交；没有后台任务队列，入库请求同步等待嵌入（单文件 ≤ 10 MB，演示规模可接受）。文件原件不保存，只保存分块与校验和，所以重建索引使用已保存的分块。

## 待办
- `task_input` 任务资料快照表与 `audit_log`；资料与商品的关联（`KnowledgeSearch` 的 `product_id` 过滤）。
- `audit_log` 的模型与迁移（`product`、`brand_voice_profile` 已在迁移 `e5a2c9d7b3f1` 中完成）。
