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
- 跨模块接口与内存 fake 在 `backend/app/ports/` 与 `backend/app/fakes/`；B 的领域逻辑可以直接基于它们开发。纯逻辑测试要覆盖模板那个自动连数据库的 fixture（参考 `backend/tests/ports/conftest.py`）。
- 字数口径用字素簇（ADR-004）；复制格式的标签写纯文本 `#标签`（ADR-005）；模型供应商与嵌入模型见 ADR-006（嵌入默认 `text-embedding-v4`，1024 维，写迁移前须实际调用验证）。
- 整体覆盖率在 CI 实测 93%；领域层要求 ≥90%（ADR-002）。
- 不得提交：品牌手册 PDF 原件、截图、API 密钥、`.env`（ADR-007）。

## 本机的限制
本地没有 Docker 时，后端测试、迁移、Playwright 跑不了，以 CI 结果为准，不要声称本地跑过。
