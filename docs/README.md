# docs 目录索引

| 文件 | 内容 | 备注 |
|---|---|---|
| [TECHNICAL_DOC.md](./TECHNICAL_DOC.md) | 技术文档（开发协作基线）：需求与边界、架构、前端约束、数据库、分工、Git 与 CI、测试、AI 协作 | Markdown 版，供 AI 助手与 diff 使用；由 Word 版转换 |
| [TECHNICAL_DOC_v1.3.docx](./TECHNICAL_DOC_v1.3.docx) | 同一份技术文档的 Word 快照（v1.3，2026-10-30） | 快照，不随后续改动自动更新 |
| [API_CONTRACT.md](./API_CONTRACT.md) | 接口契约 v1.1，字段以此为准 | 改接口先改这里 |
| [TEST_CASES.csv](./TEST_CASES.csv) | 69 条测试用例 | 可用 Excel 打开 |
| [design/README.md](./design/README.md) | 设计稿交付约定：B 通过 PR 提交导出的 PNG 与每页 `spec.md`，目录与命名、必须覆盖的页面、自检清单 | 设计稿放在 `docs/design/<page>/` |
| [decisions/](./decisions/) | 决策记录 ADR-001 至 ADR-009 | 与其他文档冲突时，流程与规则以此为准 |

更新规则：技术文档有事实变化时，同时改 `TECHNICAL_DOC.md` 并在 PR 里说明；Word 快照只在发布新版本时重新导出。
