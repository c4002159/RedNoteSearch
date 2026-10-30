# RedNoteSearch：小红书美妆香氛文案智能体

面向美妆、香氛电商运营的网页应用：基于经审核的品牌与商品资料，生成可编辑的小红书笔记候选稿（标题候选、正文、标签、封面文案候选），给出事实出处与风险提示，由运营人工确认后复制发布。

> 合规能力是“风险提示与规则辅助审核”，不替代人工复核或法务终审。“系统判定支持”不等于事实正确。

## 来源与许可

骨架取自 [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)（MIT）`master` 分支，
提交 `f4bcfaba7c85be3c6332cc74a20819f586dcdbc6`（2026-10-26）。这是一次性快照，不追随上游更新。保留其 `LICENSE`。

本项目相对模板的改动：数据库镜像换为 `pgvector/pgvector:pg18` 并加启用 `vector` 扩展的迁移；`.env` 改为 `.env.example`；
删除模板作者专用的发布与部署 workflow；新增 `docs/`、`AI_TEAM_GUIDE.md`、`CODEOWNERS` 与 PR 模板。
模板的 `Items` 示例尚未移除（Phase 0 待办）。

## 文档入口（先读这些）

| 文件 | 内容 |
|---|---|
| [AI_TEAM_GUIDE.md](./AI_TEAM_GUIDE.md) | 与 AI 协作的边界、文件所有权、自检与 PR 规则 |
| [docs/API_CONTRACT.md](./docs/API_CONTRACT.md) | 接口契约 v1.1（字段以此为准） |
| [docs/TEST_CASES.csv](./docs/TEST_CASES.csv) | 64 条测试用例 |
| [docs/decisions/](./docs/decisions/) | 决策记录 ADR-001 至 ADR-008 |

## 分工与分支

- 成员 A（c4002159）：main 维护者；认证、品牌、商品、知识库、解析索引、审计及对应页面与数据表；应用壳；CI、compose、依赖锁。
- 成员 B（CHNERUI）：场景、生成、约束、证据、合规、评测、模型适配及对应页面与数据表。
- `main` 受保护：禁止直推；合并须通过必选 CI 并获另一位成员批准；功能分支 `feat/<owner>-<ticket>-<short-name>`，修复 `fix/<owner>-<ticket>-<short-name>`。

## 本地开发

前置：Docker Desktop（需运行）、Git、[uv](https://docs.astral.sh/uv/)、[bun](https://bun.sh/)。Python 由 uv 按 `.python-version` 拉取（3.14）。

```bash
cp .env.example .env        # 本地默认值，仅限本机；勿提交 .env，勿用于共享环境
docker compose up -d db mailpit
cd backend && uv sync && uv run bash scripts/prestart.sh && uv run fastapi dev
# 另开终端
cd frontend && bun install && bun run dev
```

整栈：`docker compose run --rm backend bash scripts/prestart.sh && docker compose watch`。
更多命令见 [development.md](./development.md)。**以上命令尚未在本项目中实测**（Docker 引擎未运行时无法验证）。

## 不得提交

品牌手册 PDF 原件、截图、API 密钥、`.env`。模型密钥（DeepSeek、阿里云百炼、OpenAI）只放本地 `.env`；CI 不使用真实密钥。
