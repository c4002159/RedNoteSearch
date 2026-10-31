# RedNoteSearch：给 AI 助手的开发指引

这是“小红书美妆香氛文案智能体”仓库。两名成员各负责一条纵向切片：A（c4002159）负责认证、品牌、商品、知识库、应用壳、CI；B（CHNERUI）负责场景、生成、约束、证据、合规、评测。你在帮其中一位成员工作，先确认你在帮谁。

## 开始任何任务前
1. 读下面导入的 `AI_TEAM_GUIDE.md`（协作边界、文件所有权、自检）和决策索引。
2. 读 `docs/TECHNICAL_DOC.md` 中与任务相关的章节：需求与边界（第 2 章）、架构与技术栈（第 3 章）、前端约束（第 4 章）、数据库（第 5 章）、分工与阶段（第 7 章）、Git 与 CI（第 8、9 章）、测试（第 10 章）。
3. 接口字段以 `docs/API_CONTRACT.md` 为准；用例见 `docs/TEST_CASES.csv`；每条决策的细节在 `docs/decisions/`。
4. 与上述文件冲突时：契约字段听 `API_CONTRACT.md`，流程与规则听 `docs/decisions/`，其余听 `docs/TECHNICAL_DOC.md`。

@AI_TEAM_GUIDE.md
@docs/decisions/README.md

## 当前状态（2026-10-30；会过时，以 `git log` 与 `docs/decisions/` 为准）
- `main` 受保护：禁止直推，必选 CI 全绿才能合并，管理员也不能绕过，仅 Squash；**GitHub 不强制他人批准**（ADR-009）。改契约、迁移、认证与品牌授权、检索过滤、提示词与合规规则、CI、依赖锁时，要提醒作者在合并前于 PR 评论里 @ 对方并等到确认。
- 模板的 `Items` 示例已移除；`backend/app/models/` 是包，新增模型文件后必须在 `models/__init__.py` 里导入，否则 `alembic check` 会失败。迁移各写各表，保持线性（ADR-001）。
- **品牌授权**：路由里用 `backend/app/api/brand_deps.py` 的 `BrandAccessDep`（成员）、`BrandAdminDep`（品牌 admin）、`BrandManagerDep`（平台管理员或品牌 admin，用于管理品牌与成员），不要自己解析品牌或信任请求体里的 `brand_id`；平台管理员不是品牌数据的万能钥匙。商品（`/brands/{id}/products`、`/products/{id}`）与品牌档案（`/brands/{id}/voice-profile`）已实现；B 取品牌档案用 `app.services.voice_profiles.DbVoiceProfileProvider`（实现 `VoiceProfileProvider` 端口），商品卖点的 `evidence_status=linked` 才可作证据。错误统一为 `{"error":{"code","message","details","request_id"}}`（`backend/app/core/errors.py`）：抛 `HTTPException` 或 `NotFoundError`、`ConflictError` 即可，不要自己拼错误响应；前端只在 401 时登出。
- 跨模块接口与内存 fake 在 `backend/app/ports/` 与 `backend/app/fakes/`；B 的领域逻辑可以直接基于它们开发。纯逻辑测试要覆盖模板那个自动连数据库的 fixture（参考 `backend/tests/ports/conftest.py`）。
- 字数口径与发布页一致（ADR-004 已修订）：标题 ASCII 可打印字符计 0.5、其余计 1，≤20；正文去掉换行后的 UTF-16 码元，emoji 计 2，≤1000；标签 ≤10；标题、正文、标签分开复制，粘贴不会变成话题（ADR-005 已修订）；模型供应商与嵌入模型见 ADR-006（嵌入默认 `text-embedding-v4`，1024 维，已于 2026-10-31 实际调用验证，写入与查询都显式传 `dimensions=1024`）。
- 整体覆盖率在 CI 实测 93%；领域层要求 ≥90%（ADR-002）。
- 不得提交：品牌手册 PDF 原件、截图、API 密钥、`.env`（ADR-007）。

## 设计稿
设计稿由 B 通过 PR 提交到 `docs/design/`（导出的 PNG 加每页一份 `spec.md`），约定见 `docs/design/README.md`。AI 读图只当视觉参考，字段、选项、文案以契约、文案模块和接口为准；图与契约冲突时先列出来问人，不要自己选一边。

## 减少合并冲突（两人并行开发）
- 开工前先同步 `main`；分支一两天内合并；一个 PR 只动一类共享文件，不要把依赖升级、公共组件改动混进业务 PR。
- **自动生成的文件不要手工合并**：`frontend/src/routeTree.gen.ts`、`frontend/src/client/**` 冲突时，合并 `main` 后重新生成再提交（仓库根目录：`bun run --filter frontend build`、`bash scripts/generate-client.sh`），CI 的 `contract` 检查会验证。
- 锁文件（`uv.lock`、`bun.lock`）冲突时以 `main` 为底重新生成，不要手改；新增依赖先在 PR 里说明用途与许可证。
- `backend/app/models/__init__.py`、`backend/app/api/main.py` 冲突时，保留双方各自新增的导入与路由行。
- 迁移出现两个 head：后合并者把自己迁移的 `down_revision` 改为 `main` 当前的 head，再确认 `alembic heads` 只有一个；不用 `alembic merge`（ADR-001）。
- `docs/API_CONTRACT.md`、`docs/TEST_CASES.csv` 冲突时保留双方的条目，不要丢掉对方的内容。
- 导航（`AppSidebar.tsx`）、公共组件、设计 token 归 A；B 需要加入口时提小 PR，不要在业务 PR 里顺手改。
- Git 发现不了的冲突：改 `ports/` 接口、契约字段、状态枚举、错误码之前，先 @ 对方确认；不能为了解决冲突删对方的代码或测试。
- 解决冲突后重新跑本地能跑的检查，并等 CI 通过；不要声称本地跑过没跑的检查。

## 本机的限制
本地没有 Docker 时，后端测试、迁移、Playwright 跑不了，以 CI 结果为准，不要声称本地跑过。
