# 交接文档：接手的 AI 助手先读这个

截至 2026-11-01，后端 P0 与 P1 都已合并进 `main`（P1：F12 #40、F14 #41、F13 #42、规则批量导入 #46、停用原因 #47；B 的设计稿第一、二批 #44、#45）。本文件由 A 的 AI 助手维护；事实以代码、`git log`、`docs/API_CONTRACT.md` 和 `docs/decisions/` 为准，冲突时听它们。接手后第一件事：`git fetch`、切到最新 `main`、读完本文件，再动手。

## 0. 一分钟版本

- 项目：小红书美妆香氛文案智能体（演示品牌：冰希黎）。仓库 `c4002159/RedNoteSearch`（私有）。A = `c4002159`（main 维护者，也是你的用户），B = `CHNERUI`。
- **后端 P0 与 P1 全部完成并已合并进 `main`**（P1 = F12 任务文件输入、F13 爆款结构分析、F14 品牌串味测试、合规规则批量导入导出与模板；F15 不做）；B 只做设计稿和前端页面。前端还没有开始写页面（B 的第一、二批设计稿已合并，后续批次在路上）。
- `main` 受保护：不能直推，必选 CI 全绿才能合并（只允许 Squash）。**你做的任何改动都通过 PR 进来，坏了不会影响 `main` 上已有的东西。**
- 出现不确定的事：先问 A，不要猜；涉及合同、迁移、品牌授权、提示词与规则含义、CI、依赖锁的改动，要在 PR 评论里 @CHNERUI 等他确认。

## 1. 已经完成的（都在 main，都有测试）

| 领域 | 内容 | 主要位置 |
|---|---|---|
| 平台 | 认证（沿用模板）、统一错误信封、品牌与成员、品牌授权依赖 | `backend/app/core/errors.py`、`api/brand_deps.py`、`routes/brands.py` |
| 商品与品牌档案 | 商品（软删除、卖点来源校验）、品牌档案（版本化，每品牌唯一生效） | `routes/products.py`、`routes/voice_profile.py` |
| 知识库 | 上传（PDF/DOCX/MD/TXT/CSV，PDF 与 DOCX ≤50 MB、文本 ≤5 MB）、解析分块嵌入、审核、版本、停用、重建索引、向量检索 | `services/knowledge*.py`、`routes/knowledge.py` |
| 任务 | 场景模板、风格预设、任务（含资料快照）、版本 | `routes/tasks.py`、`services/tasks.py`、`services/task_input.py` |
| 生成与检查 | 提示词、模型适配器、约束检查、事实证据（代码核对模型的引用）、合规风险提示（可维护的规则，三层）、自动改写（≤2 轮） | `domain/`、`services/generation.py`、`pipeline.py`、`evidence.py`、`compliance.py` |
| 编辑与交付 | 编辑、局部重写、重新检查、确认、导出（`xhs_parts`、`markdown`） | `routes/versions.py`、`services/versions.py` |
| 人在回路 | 没有系统依据的断言必须由人逐条决定，成立才放行，导出里标注“人工确认，不是系统验证” | `domain/flow.py`、`services/versions.py` |
| 评测 | 版本固定的评测集、三类评测（合规、核查、生成）、有定义的指标、人工评分与一致性 | `routes/evaluation.py`、`services/evaluation*.py` |
| 演示数据 | `python -m app.seed`（占位内容，全部标“演示”） | `backend/app/seed.py` |

**验证过的**：347 个测试在真实 PostgreSQL+pgvector 上通过，覆盖率 97%（基线 93），领域层 99%（门槛 90）；整栈 Docker 启动验证过；用真实的 DeepSeek 与百炼跑过一次完整流程（生成约 24 秒，防编造有效）。**没验证的**：真实模型的准确率与费用（价格没配置，费用显示为空，不猜）；评测集只有几条演示样本，说明不了模型好坏。

## 2. 在等什么（卡点）

- **等 B**：① 整体框架的设计稿（顶栏、导航、品牌切换、用户菜单、token、公共组件），A 靠它做应用壳；② 发布页实测（标题/正文/话题超限时“发布”会不会被拦；标题里全角标点与 emoji 的计数；标签空格的计数），结果影响 ADR-004；③ `docs/compliance/SOURCES.md` 的只含文档的 PR；④ B 在 PR #32、#31、#30 评论里对新规则的确认。
- **等 A 决定**：要不要做 P1（品牌串味测试、多模型成本对比、爆款结构分析）；提示词要不要调得更克制（模型会自己补资料里没有的使用建议，被系统拦下来人工复核）。
- B 的助手会话 GitHub 只读，推不了；A 在处理（安装 Claude 的 GitHub 应用）。

## 3. 接下来的任务（按优先级）

1. **日常同步检查**（每次开工先做，见 `CLAUDE.md`“协作节奏”）：`gh pr list`、读 PR 评论与 Issues、看 B 的新分支，汇总给 A；回复 B 要 @ 他。**不要替 A 向 B 发消息，除非 A 明确要求。**
2. **前端（A 负责的部分）**：B 的设计稿到了以后，先做应用壳（顶栏、可折叠分组导航、品牌切换、用户菜单）、设计 token、`components/Common`；再做品牌与商品、品牌档案、知识库（列表与上传、待审队列与审核、详情与停用）、合规规则维护（全局规则仅平台管理员、品牌规则仅品牌 admin；示例规则显示“来源待核对，不是正式依据”）、用户设置。只用生成的客户端；页面规范见 `docs/TECHNICAL_DOC.md` 第 4 章和 `docs/design/README.md`。B 的页面（工作台、任务历史、结果页、评测）由 B 实现，接进 A 的壳。**合规规则维护页必须含批量导入、导出和下载模板（要求见 `docs/P1_PLAN.md` 第 6 节，后端先出契约），这是 demo 里“留给客户可更改的地方”，不要漏。**
3. **文档同步（已做一轮，2026-11-01）**：技术文档第 3、5、7、10、13 章已按现状更新，ADR-011、ADR-012 已补；第 9 章与第 10.2 节用例总表仍是旧数字，以 `docs/TEST_CASES.csv` 为准。原要求：`docs/TECHNICAL_DOC.md` 的第 3、5、7、9、10 章要对照现状更新（Markdown 版为准；Word 版 `TECHNICAL_DOC_v1.3.docx` 已落后，不再维护）；补一份 ADR 记录“人在回路确认规则”和“后端分工变更”（编号接 ADR-010 之后）；`docs/decisions/README.md` 的索引同步。
4. **Demo 准备**（交付物是源码加视频加技术文档，不上云）：写视频要录的完整流程脚本；A 在前端录入真实合规规则；用真实的已审核资料替换演示数据；需要看费用时让 A 在本机 `.env` 配 `DEEPSEEK_PRICE_IN_PER_1K`、`DEEPSEEK_PRICE_OUT_PER_1K`、`LLM_PRICE_VERSION`；录视频前在干净环境再做一次整栈启动验证。
5. **P1 已完成**（F12、F13、F14、规则批量导入导出与模板、停用原因；F15 不做）：契约与实现均已合并，见 `docs/P1_PLAN.md`。只用假模型和本地数据库测过，没用真实模型跑过；演示前建议在干净环境各跑一遍真实流程。

## 4. 固定工作流（每个改动都照这个来）

1. `git fetch`，从最新 `main` 拉分支，命名 `feat/a-<主题>`、`fix/a-<主题>` 或 `docs/a-<主题>`。**不要在 `main` 上直接改。**
2. 先写不依赖数据库和模型的纯逻辑（`backend/app/domain/`，不得 import FastAPI、SQLModel、模型 SDK），再接服务、路由。每个功能都要有成功、校验错误、未授权（401）、越权（403 或 404）、跨品牌访问的测试。**不要删除或放宽已有测试的断言。**
3. 本地检查（在仓库根目录，`UV_FROZEN=1`，Windows 设 `PYTHONUTF8=1`）：
   - `uv run ruff check backend`、`uv run ruff format --check backend`、`uv run mypy backend/app`、`uv run ty check backend/app`
   - 数据库测试：起 Docker 数据库（见第 6 节），`cd backend && uv run alembic upgrade head && uv run alembic check && uv run pytest`；覆盖率用 `uv run coverage run -m pytest` 再 `coverage report`
   - 改了接口：`bash scripts/generate-client.sh`，提交 `frontend/src/client`（若只有 `main.tsx`、`utils.ts` 的行尾噪声，`git checkout --` 还原）
4. 同步更新 `docs/API_CONTRACT.md`（只增不改字段含义）、`docs/TEST_CASES.csv`（新增用例编号，接在最后一个之后）。改了迁移，`alembic heads` 必须只有一个，新迁移的 `down_revision` 是当前唯一的 head，不用 `alembic merge`。
5. 提交信息末尾带共同作者行，推送分支，用 `gh pr create` 开 PR，PR 描述按模板写：需求编号、目的与实现、修改文件、权限与隔离影响、**测试命令与真实结果（没跑过的写“未验证”，不要声称跑过）**、已知限制与回滚方式。
6. 等 CI 全绿（`mergeStateStatus` 为 `CLEAN`）。分支落后于 `main` 时 `gh pr update-branch <编号>`，等 CI 重新跑。
7. 合并只用：`gh pr merge <编号> --squash --match-head-commit <完整 sha>`。**不要用 `--delete-branch` 合并被别的 PR 叠着的分支**（GitHub 会把叠在上面的 PR 关掉）；叠放 PR 先把目标分支改到 `main`，再合并。**不要强推、不要绕过保护、不要改分支保护设置。**
8. 触及合同、迁移、品牌授权、检索过滤、提示词与规则含义、CI、依赖锁的 PR，在 PR 评论里 @CHNERUI；没有收到确认也可以按 A 的指示合并，但要在回复里说明。
9. 合并后在最终回复里告诉 A：做了什么、验证了什么、没验证什么、下一步需要 A 决定什么。

## 5. 红线（不得违反）

- **安全**：密钥只放本机 `.env`（已被 git 忽略），不得进仓库、日志、PR、聊天；不提交 `.env`、品牌手册 PDF 原件、截图、`scripts/set-api-keys.ps1`。测试和 CI 里一律用假模型，不调用真实模型。
- **防编造**：事实只能来自已审核资料和任务资料；证据的“成立”必须由代码核对（引用的资料存在、原文真的出现在里面），不能只信模型；系统判定 `status` 与人的决定分开存放，不改写。
- **措辞**：任何界面、提示词、文档、导出里不得出现“合规通过”“已验证事实”“法务批准”“保证合规”等（CI 有 `forbidden-wording` 检查）。`ready_to_copy` 只表示运营确认了文字；人工确认的断言必须标注为“人工确认，不是系统验证”。
- **品牌隔离**：品牌 id 只来自路径或资源本身，不信请求体；路径里有品牌的路由非成员返回 403，按资源 id 访问不存在或非成员一律返回 404；平台管理员不是品牌数据的万能钥匙。
- **数据规则**：待审、驳回、停用、被取代的资料不可检索；任务资料快照只增不改；`kb_review` 与 `audit_log` 只增不改；编辑与重写总是创建新版本。
- **合同**：已有字段的含义不改；只增字段；字数口径见 ADR-004/005（标题 ASCII 可打印字符计 0.5、其余计 1，≤20；正文去换行后的 UTF-16 码元，≤1000；标签 ≤10 且其可见字符计入正文）。
- **不做**：自动发布、爬取平台、视频、其他平台、模型微调、法务终审、云端部署。

## 6. 本机环境与坑（Windows）

- **Docker**：A 的 Docker Desktop 在运行，但 AI 的 shell 里调不到 `docker`；用终端面板工具运行 docker 命令（每次开新标签，最多 6 个，用完关闭）。**A 的机器上还有别的项目的容器（Dify、MySQL、Redis 等）占着 5432 端口，永远不要停它们。** 我们的数据库用 `docker compose` 的 `db` 服务，宿主机端口通过 `POSTGRES_PORT` 改成 5433，同时 `DATABASE_URL` 的端口一起改；容器名 `app-db-1`。临时数据库 `app_real` 用来跑真实模型的端到端检查。
- **Python/uv**：`uv sync` 时设 `UV_FROZEN=1`，否则 `uv.lock` 的 revision 会被改成 3，要保持为 5。后端的虚拟环境不在仓库里，自己建。
- **中文系统**：设 `PYTHONUTF8=1`，否则读邮件模板会报 `gbk` 错误。
- **文件写入**：多行的 Python、迁移、测试文件，用写文件工具写，不要在 shell 里用带引号的 heredoc（多次因引号转义失败）；批量修改用小脚本并 `assert` 要替换的文本存在。文件写入保持原有行尾（CRLF 或 LF）。
- **模型**：DeepSeek（`deepseek-flash`、`deepseek-v4-pro`）和百炼嵌入（`text-embedding-v4`，1024 维）。密钥在 A 的本机 `.env`。
- **GitHub**：你（A 的助手）的 `gh` 是 A 的账号。PR 的 Auto-fix 监控由 A 开启，没有明确要求不要自己开。

## 7. 如果出了问题：怎么回到好的状态

- `main` 受保护，坏改动进不了 `main`，除非 CI 全绿后被合并；真合并了才发现问题，用**新 PR 里 `git revert` 对应的合并提交**，不要 `reset`、不要强推。
- 后端 P0 完成时的安全点：标签 `backend-p0-complete`（指向写完本文件之后的 `main`）。需要整体回看时：`git diff backend-p0-complete..main` 看之后改了什么。
- 数据库迁移的回滚：每个迁移都有 `downgrade`；回滚用 `alembic downgrade <上一个 revision>`，只在自己的本地数据库上做。
- 接手后发现之前的结论与代码不符，以代码和测试为准，并把差异记在 PR 里告诉 A。

## 8. 关键文件索引

- 协作规则：`CLAUDE.md`、`AI_TEAM_GUIDE.md`、`docs/INTEGRATION_FOR_B.md`
- 需求与架构：`docs/TECHNICAL_DOC.md`（第 2 章需求、第 4 章前端、第 5 章数据库、第 7 章分工、第 10 章测试）
- 接口：`docs/API_CONTRACT.md`（第 1 节通用约定，第 5 节任务与生成及“给前端的补充说明”，第 7 节评测）
- 测试用例：`docs/TEST_CASES.csv`；决策：`docs/decisions/`（ADR-001 到 ADR-010）
- 设计稿交付：`docs/design/README.md`
