> 本文件由《技术文档》Word 版（v1.3，2026-10-30）转换而来，供 AI 助手阅读与对比差异。与 `docs/decisions/`、`docs/API_CONTRACT.md` 冲突时，以后两者为准；Word 版是同一时刻的快照（`docs/TECHNICAL_DOC_v1.3.docx`）。

技术文档（开发协作基线）

项目名称：小红书美妆香氛文案智能体（RedNoteSearch）

团队编号：待定

文档信息

|  |  |  |  |
|---|---|---|---|
| 项目名称： | 小红书美妆香氛文案智能体 |  |  |
| 编制： | 成员 A / 成员 B | 编制日期： | 2026年10月 |
| 联系方式： | 待定 |  |  |
| 文档版本： | 1.3（同步仓库、CI 与分支保护的实际状态） | 版本日期： | 2026年10月 |
|  |  |  |  |

版本历史

| 版本 | 日期 | 修订人 | 说明 |
|---|---|---|---|
| 1.3 | 2026.10.30 | 产品经理 | 同步实际状态：仓库已私有并推送；CI 与分支保护已启用，不要求他人批准（ADR-009）；Items 已移除、models 已拆包；接口与 fake 已合入；覆盖率 93%；Python 3.14 与迁移已在 Linux CI 验证 |

# 0. 文档说明

本文是面向两名开发成员（成员 A、成员 B）的开发协作基线，整合了五份来源：《需求规格说明书》v1.0、《两人开发分工与协作手册》、API_CONTRACT.md、AI_TEAM_GUIDE.md、TEST_CASES.csv，并补充了前端约束、GitHub 仓库与 CI 约定、技术栈约定和待确认项。

| 主题 | 权威来源 | 冲突时 |
|---|---|---|
| 需求范围与指标 | 需求规格说明书 v1.0 | 本文第 1–2 章是其执行视图；范围变更须更新规格书 |
| API 字段、状态码、示例 | docs/API_CONTRACT.md（v1.1） | 字段以契约为准；本文第 6 章只做摘要 |
| AI 编码边界 | AI_TEAM_GUIDE.md | 本文第 11 章为整合版，二者须保持一致 |
| 测试用例 | docs/TEST_CASES.csv（67 条） | 本文第 10 章引用全部；TC-037 已并入 TC-005 |
| 流程、分支、CI、前端约束、技术栈 | 本文 | 修改须经 PR；GitHub 不强制批准（ADR-009），敏感路径须在评论里 @ 对方并等到确认 |

*表 0-1 文档权威来源*

标注“待确认”的内容是我在整合时的假设或发现的缺口，需要两位成员确认后才算生效，见第 13 章。

# 1. 项目概览与范围边界

## 1.1 目标与口径

- 系统目标：稳定产出可编辑、可核对、带风险提示的小红书候选稿；不承诺爆款率，互动数据只作上线后观察指标。
- 合规口径：“风险提示与规则辅助审核”，保留人工复核，不替代法务终审；界面与日志不出现“合规通过”“已验证事实”“法务批准”等措辞。
- 证据口径：“系统判定支持”仅表示匹配判断，不等于事实正确；审核入库只代表资料通过内部流程，不构成事实背书。
- 演示品牌：冰希黎（BOITOWN）；品牌手册为客户提供的资料，使用方式见 8.5 的数据风险。

## 1.2 范围

| 级别 | 内容 | 规则 |
|---|---|---|
| P0 必做 | F1–F11：品牌商品、知识库审核流、任务输入快照、场景与风格、结构化生成、约束检查、事实证据、合规提示、编辑与复制、评测、可运行 Demo | 全部完成并通过第 10 章验收后，才开始 P1 |
| P1 加分 | F12 文件任务输入、F13 爆款结构分析、F14 品牌隔离与串味测试、F15 多模型成本对比 | 单项独立交付，不得影响 main 的可启动状态 |
| P2 可选 | F16 图片 OCR、F17 候选封面图、F18 飞书批量入口与小红书小工具离线演示、全局搜索、审计页、复杂权限 | 不排期；需求冻结后新增项进候选清单 |
| 范围外 | 自动发布与账号运营；平台爬取；视频与音视频；小红书以外的平台；模型微调；法务终审；正式压测 | 不做；要做须先改规格书 |

*表 1-1 范围*

# 2. 需求清单、边界与验收

## 2.1 功能需求（含前端、后端、数据库归属）

两位成员都做全栈：各自负责一条纵向切片，从页面到接口到数据表到测试。公共壳与迁移的规则见第 7、8 章。

| 编号 | 需求与边界 | 负责 | 前端 | 后端 / 数据库 | 验收用例 |
|---|---|---|---|---|---|
| F1 | 品牌与商品、品牌档案（版本化）。品牌上下文由服务端从授权关系取；商品卖点须关联资料来源。品牌创建仅管理员，P0 可由种子数据提供 | A | 品牌切换、商品管理、品牌档案页 | brands、products、voice-profile；brand、brand_member、product、brand_voice_profile | TC-003、004 |
| F2 | 知识库审核流。管理员直接入库→approved 并记 admin_direct_ingest 审计；运营提交→pending_review，通过后才索引；待审永不检索；新版本重新审核，旧版本保留；停用而非物理删除；格式 PDF/DOCX/MD/CSV；不做扫描件 OCR | A | 资料列表与上传、待审队列、审核、版本与审核记录、停用 | knowledge-documents、knowledge-submissions、reviews、deactivate；解析与索引；kb_document、kb_review、kb_chunk、audit_log | TC-005–012、048 |
| F3 | 任务输入快照。当次资料保存内容快照与哈希，只属于该任务；之后修改、停用或提交入库不影响旧版本。A 提供存储与接口，B 通过统一接口读取 | A（存储） / B（消费） | 生成工作台中的资料输入区（B） | task_input 与快照接口（A）；证据消费（B） | TC-013、021 |
| F4 / F5 | 场景模板与风格、结构化生成：标题候选（每条加权长度 ≤20，纯中文 20 字、纯英文 40 字符）、正文（≤1000，去掉换行后的 UTF-16 码元）、标签（≤10）、封面文案候选 2–3 条；可局部重写；不做图片 | B | 生成工作台、场景与风格选择、结果页四类字段 | scenarios、tasks、generate、versions；scenario_template、style_preset、task、generation_version | TC-014、015 |
| F6 | 约束检查：标题加权长度 ≤20、正文 ≤1000、标签 ≤10、必含词、禁用词、字段完整；代码判定；失败按配置重试，仍失败为 constraint_failed | B | 约束结果面板、字数提示 | 约束服务；constraint_check | TC-016–018 |
| F7 | 事实证据：抽取断言，匹配已审核知识库或任务资料；状态 system_supported / evidence_missing / needs_human_review；证据不足不写具体事实；人工确认入口 | B | 证据面板：来源级别、文档版本、状态、人工确认 | 证据服务；claim_evidence | TC-019–021 |
| F8 | 合规风险提示三层：词库正则 / 语境 / 功效依据；规则带来源、版本、适用范围；block 级问题改写并重检；不称合规通过 | B | 风险面板（高亮、规则出处、严重度、建议）、规则查看页 | 合规服务；compliance_rule、compliance_check | TC-022–024 |
| F9 | 编辑与交付：编辑产生新版本并复检最终文本；运营确认得 ready_to_copy；复制为小红书格式；导出 Markdown | B | 编辑器、版本对比、确认、复制（含降级文本框） | edit、recheck、confirm；generation_version | TC-025–027 |
| F10 | 评测：固定版本测试集；人工评分规程与一致性；指标并列，不给单一综合分；费用与延迟可追溯 | B（指标与流程） / A（种子资料） | 评测集、评测运行、报告页 | evaluation；eval_dataset、eval_case、eval_run、eval_result、llm_call_log | TC-028–031 |
| F11 | 可运行 Demo：Compose、迁移、冰希黎种子数据、示例测试集与词库；干净环境可启动 | A 集成 / 双方供数据 | — | compose.yml、种子脚本、迁移 | TC-001、032 |
| F12 | P1：PDF/DOCX/CSV 作为任务输入。与知识库共用解析器，但存储、索引、生命周期独立；格式、大小、失败处理分别验收 | A 解析 / B 消费 | 任务页上传区 | 解析器复用 | TC-036 |
| F13 | P1：爆款结构分析（用户贴样本）。分析结构，不复刻原文；样本不入公共知识库；不爬取平台 | B | 分析页 | 分析服务；viral_sample、viral_pattern | TC-034 |
| F14 | P1：品牌隔离与串味测试。先做跨品牌检索拒绝与固定串味集；RLS 视时间 | A | 串味测试结果展示 | 检索过滤；可选 RLS | TC-033 |
| F15 | P1：多模型成本对比。同输入 2–3 个模型，并列约束通过率、人工评分、延迟、费用；失败模型单独显示 | B | 对比页 | 模型适配器复用 | TC-035 |

*表 2-1 功能需求与归属*

## 2.2 非功能需求

| 编号 | 类别 | 要求 | 验证 |
|---|---|---|---|
| NFR1 | 可追溯 | 每个版本记录模板、提示词、品牌档案、检查器版本；检索的 chunk；模型与参数；各检查的版本与结果；编辑后最终文本 | TC-032 |
| NFR2 | 安全与隔离 | 密码哈希；密钥只放环境变量；品牌上下文由服务端取，不信请求体 brand_id；越权被拒并写审计 | TC-003、004、007 |
| NFR3 | 准确性报告 | 合规召回与误报、事实支持率在固定测试集上报告，写明样本数、标注方法、版本；不拿同一批样本反复调规则再报效果 | TC-028、029 |
| NFR4 | 可靠性 | 模型超时、限流、空响应有显式错误与有界重试；用户输入与编辑不丢；任务状态可轮询恢复 | TC-031 |
| NFR5 | 成本与性能 | 每篇费用与延迟可见，价格做成配置；首字响应与检索延迟只记录并报告，目标待基线校准 | TC-030 |
| NFR6 | 可复现 | 干净环境按 README 启动，迁移、vector 扩展、种子数据可重复执行 | TC-001 |
| NFR7 | 隐私 | 界面说明品牌资料发往哪家模型；支持切换本地模型；日志不含密钥与完整敏感资料 | 代码审查 |
| NFR8 | 可维护 | 提示词、模板、规则为数据；领域层不依赖框架；迁移可从空库运行 | 第 9、10 章 |

*表 2-2 非功能需求*

## 2.3 关键业务规则

| 规则 | 内容 |
|---|---|
| 资料状态 | pending_review → approved \| rejected；approved → deactivated。管理员直接入库直接为 approved。修改已入库资料生成新版本并重新审核；新版本通过前，检索仍使用旧的当前版本；停用后新任务不检索，历史版本保留引用快照。审核记录只增不改 |
| 流程状态 flow_status | queued \| generating \| checking \| checks_completed \| needs_human_review \| constraint_failed \| edited_pending_recheck \| ready_to_copy。不使用 passed / approved |
| 证据状态 | system_supported \| evidence_missing \| needs_human_review；来源级别 approved_kb \| task_material（任务内资料未经审核，界面分开标注） |
| 确认语义 | ready_to_copy 仅表示运营确认稿件，记录 confirmed_by / confirmed_at；不表示合规获批 |
| 复检 | 任何编辑后的最终文本必须重新运行约束、证据、合规三项检查；旧版本与旧检查快照不被覆盖 |
| 重试与幂等 | 默认（提案，待 A、B 确认）：模型调用失败重试 ≤2 次（指数退避）；约束不通过重新生成 ≤2 次；合规改写 ≤2 轮；均可配置。生成接口使用 Idempotency-Key，防止重复生成 |
| 字数口径 | 已修订（ADR-004，2026-10-31）：与小红书发布页一致。标题：ASCII 可打印字符计 0.5、其余计 1，≤20；正文：去掉换行后的 UTF-16 码元数，emoji 计 2，≤1000；标签 ≤10，其可见字符计入正文预算。后端为权威，前端镜像同一规则，两边用同一组边界用例核对 |
| 禁用措辞 | 界面、接口说明、日志、导出文本中不出现：合规通过、已验证事实、法务批准、保证合规；CI 有扫描（见 9.3） |
| 日志脱敏 | 不记录密钥、密码、完整敏感资料；错误响应不返回 traceback、API 密钥或模型原始敏感内容 |

*表 2-3 业务规则*

| 动作 | 运营（editor） | 管理员（admin） |
|---|---|---|
| 直接入库 | 否（403） | 是 |
| 提交待审 | 是 | 是 |
| 审核、驳回、停用 | 否（403，写越权审计） | 是 |
| 任务内贴资料 | 是 | 是 |
| 查看资料来源与审核记录 | 是 | 是 |
| 确认稿件（ready_to_copy） | 是 | 是 |

*表 2-4 权限矩阵（后端强制，前端隐藏按钮不算控制）*

# 3. 架构与技术栈约定

## 3.1 总体架构

```
浏览器（React SPA）  ──HTTPS /api/v1──▶  FastAPI（模块化单体）
                                         API 层 → 服务层 → 领域层(纯逻辑) → 基础设施
                                                         │
                                  PostgreSQL + pgvector ◀┘ 　模型适配器 ──▶ 外部/本地大模型
```

- API 校验输入与身份；服务层编排用例；领域层做规则（不依赖 FastAPI、SQLModel、模型 SDK）；基础设施负责 DB、模型、解析。
- 所有品牌查询经服务端授权上下文过滤；耗时任务用 POST 创建加 GET 轮询，不把 SSE 当持久状态。
- 模型输出做 schema 校验；超时、限流、空响应有显式错误状态。

## 3.2 技术栈（以模板实际文件为准）

| 层 | 选型 | 约定 |
|---|---|---|
| 骨架 | fastapi/full-stack-fastapi-template（MIT），master 分支提交 f4bcfaba…，2026-10-26 | 一次性取快照，记录 SHA 到 README，不追随上游更新；已删其 .git |
| 后端 | Python 3.14（模板要求，已在 Windows 本地与 Linux CI 验证，CPython 3.14.9，见 ADR-003）、FastAPI、SQLModel、Alembic、uv 管理依赖 | 统一 SQLModel；依赖锁由 A 合并；新增依赖须先说明并获同意；新增依赖进入锁文件后由 CI 在 Linux 上再验证 |
| 数据库 | PostgreSQL 18，镜像 pgvector/pgvector:pg18；迁移 a1b2c3d4e5f6 启用 vector 扩展 | 扩展、迁移（空库升级、downgrade、alembic check）已在 Linux CI 验证；向量列、HNSW 与全文索引的迁移尚未编写 |
| 大模型 | DeepSeek、通义千问 Qwen（阿里云百炼）、OpenAI GPT 系列（ADR-006）；不接入 Claude | 默认自写薄适配器（调用、重试、记录 token 与费用）；LiteLLM 为候选，只用 MIT 部分；价格为带版本的配置数据；密钥只放 .env 与 CI 加密变量，CI 不用真实密钥 |
| 嵌入模型 | 阿里云百炼文本嵌入（ADR-006） | 具体型号与向量维度待查官方文档确认，写入首个 kb_chunk 迁移；改维度需重建索引 |
| 前端 | React、TypeScript、Vite；TanStack Router（文件路由）与 Query；Tailwind CSS 4 与 shadcn/Radix 组件；react-hook-form 与 zod；lucide 图标；sonner 通知；Biome 格式与检查 | 见第 4 章约束 |
| 接口客户端 | @hey-api/openapi-ts 从 OpenAPI 生成 frontend/src/client | 前端只用生成的客户端；后端改接口后重新生成并提交，CI 校验无漂移 |
| 测试 | 后端 pytest；前端 Playwright；覆盖率：领域层 ≥90% 加整体棘轮（ADR-002） | 领域层单元测试不依赖 DB 和模型；CI 不调用真实模型 |
| 部署 | Docker Compose；Traefik（模板自带） | 验收：干净环境可启动，迁移与种子数据可用 |
| 代码风格 | 模板的 prek（pre-commit 兼容）配置；Biome；后端 ruff 等以模板配置为准 | 提交前本地运行；CI 复跑 |

*表 3-1 技术栈*

## 3.3 仓库目录与所有权

```
RedNoteSearch/
  backend/app/
    api/routes/      brands.py products.py knowledge.py (A) | tasks.py generation.py evaluation.py (B)
    services/        knowledge/ (A) | generation/ compliance/ evaluation/ (B)
    domain/          prompt/ constraints/ grounding/ compliance/ scoring/ (B)
    infra/           parsing/ search/ db/ (A) | llm/ (B)
    models/          identity.py catalog.py knowledge.py (A) | generation.py compliance.py evaluation.py (B)
    alembic/         迁移（见 5.3 规则）
  frontend/src/
    routes/_layout/  品牌、知识库页 (A) | 生成、评测页 (B)
    components/      layout/ common/ (A 维护) | generation/ evaluation/ (B)
    client/          自动生成，禁止手改
  docs/              需求规格书、本文、API_CONTRACT.md、TEST_CASES.csv、decisions/
  .github/           workflows/ CODEOWNERS PULL_REQUEST_TEMPLATE.md
  AI_TEAM_GUIDE.md compose.yml README.md
```

*目录建议（Phase 0 由 A 落地，待确认）*

## 3.4 模块间接口（两人并行的前提）

| 接口 | 提供方 | 使用方 | 内容 |
|---|---|---|---|
| BrandAuthContext 依赖 | A | B | 从 JWT 与 brand_member 取得当前用户的授权品牌与角色；B 不自行解析 |
| KnowledgeSearch.search | A | B | 入参：授权品牌、查询、商品、任务；返回 chunk（含文档版本、来源级别）。只返回已入库、当前有效版本；永不返回待审、驳回、停用 |
| TaskInputRepository | A | B | 创建与读取任务资料快照（内容与哈希）；B 不直接读 A 的内部表 |
| VoiceProfileProvider | A | B | 返回当前生效品牌档案、优先词与禁用词 |
| LLM 适配器 | B | A（解析起草用到时） | 统一调用、重试、记录 token 与费用 |

*表 3-2 跨模块接口（先写接口与 fake 实现，再并行开发）*

# 4. 前端约束与页面规范

## 4.1 参考与取舍：千瓜后台

参考依据：一张千瓜后台截图（左侧导航、顶栏、认证弹窗）。截图只能支撑整体布局与视觉风格，其余页面交互未见，不据此推断。我们参考布局与交互模式，不复制其标志、配色数值、文案、插图、吉祥物或代码。视觉基线已确认（ADR-008）：由成员 B 按本章前端约束和 2.1 功能表出设计稿，成员 A 审阅确认后落地为设计 token 与公共组件；千瓜不决定主色。

| 观察到的特征 | 我们的做法 |
|---|---|
| 固定顶栏：品牌标志、导航折叠按钮、全局搜索框（主色“搜索”按钮）、两个描边胶囊按钮（功能地图、快捷访问）、右侧工具与头像 | 顶栏：标志、折叠按钮、当前品牌切换器、右侧用户菜单。全局搜索、功能地图属 P2，未实现时不显示，避免死按钮 |
| 左侧可折叠分组导航：图标加粗体组名加折叠箭头；子项两列排布；子项旁有小徽标（热、新） | 分组导航见 4.3；子项两列；徽标仅用于“待审数量”“P1”等有真实含义的标记 |
| 浅灰内容背景，白色卡片；居中弹窗卡片：图标、标题、说明、一个主按钮与一个次按钮 | 页面灰底白卡片；确认类操作（审核、停用、确认稿件）用居中弹窗，主按钮与次按钮 |
| 紫色系主色；右侧悬浮工具 | 主色与 token 以 B 的设计稿（经 A 确认）为准，不沿用千瓜紫色；不做悬浮挂件 |
| 以桌面端为主，大屏数据密集 | 桌面优先（≥1280 px），≥1024 px 不溢出；不做移动端适配 |

*表 4-1 千瓜参考与取舍*

## 4.2 前端硬约束

| 编号 | 约束 | 检查方式 |
|---|---|---|
| FC-01 | 沿用模板栈（React、TS、Vite、TanStack Router 与 Query、Tailwind 4、shadcn/Radix、react-hook-form 与 zod、lucide）；新增 UI 库或状态库须先说明并获双方同意 | PR 审查；依赖变更由 A 合并 |
| FC-02 | 只通过生成的 OpenAPI 客户端访问后端；禁止手写 fetch 到业务接口；不手改 src/client | CI 契约漂移检查 |
| FC-03 | 服务端状态用 TanStack Query；表单用 react-hook-form 加 zod；不在组件里硬编码接口地址 | PR 审查 |
| FC-04 | 颜色、圆角、间距只用设计 token（index.css 中的 CSS 变量与 Tailwind 主题），不写硬编码色值 | Biome 规则或 grep 检查 |
| FC-05 | 所有界面文案集中在 zh-CN 文案模块；状态与枚举的中文标签统一从映射表取，未知枚举降级显示原值并上报 | 单元测试：映射覆盖全部枚举 |
| FC-06 | 禁用措辞：合规通过、已验证事实、法务批准、保证合规；系统判定支持处须提示“非事实保证” | CI 扫描（9.3） |
| FC-07 | 每个异步视图必须有加载、空、错误、成功四种状态；错误提示展示 request_id | Playwright 用例 |
| FC-08 | 角色只决定导航与按钮的显示；权限以后端 403 为准，前端必须正确展示 403 | TC-F01 |
| FC-09 | 品牌由顶栏切换器选择，来源于 GET /brands；请求里的 brand_id 只表示目标资源，不代表授权 | PR 审查 |
| FC-10 | 未实现的功能不展示入口；P1、P2 入口默认隐藏，不放置死按钮或占位链接 | PR 审查 |
| FC-11 | 无障碍基础：表单控件有 label，键盘可达，焦点可见，文本对比度满足 WCAG AA | TC-F09 |
| FC-12 | 桌面优先，≥1280 px 为设计基准，≥1024 px 不出现横向溢出；不做移动端 | TC-F08 |
| FC-13 | 前端不保存密钥；令牌存放遵循模板方式；不把完整敏感资料写入控制台日志 | 代码审查 |
| FC-14 | 字数提示与后端口径一致，以后端结果为准；复制失败时提供可手动复制的纯文本框 | TC-F05、TC-027 |
| FC-15 | 页面文件、组件按 3.3 的所有权放置；公共壳与 components/common 由 A 维护，B 需要改动时提小 PR | CODEOWNERS |

*表 4-2 前端约束*

## 4.3 导航与页面清单

| 分组 | 页面 | 路由（建议） | 角色 | 负责 | 级别 |
|---|---|---|---|---|---|
| 创作 | 生成工作台 | /generate | editor、admin | B | P0 |
| 创作 | 任务与版本历史 | /tasks | editor、admin | B | P0 |
| 创作 | 结果页：四类字段、证据面板、风险面板、编辑、复检、确认、复制 | /tasks/:id/versions/:vid | editor、admin | B | P0 |
| 品牌与商品 | 品牌与切换 | /brands | 全部 | A | P0 |
| 品牌与商品 | 商品管理 | /brands/:id/products | editor 只读、admin 编辑 | A | P0 |
| 品牌与商品 | 品牌档案（版本） | /brands/:id/voice-profile | editor 只读、admin 编辑 | A | P0 |
| 知识库 | 资料列表与上传 | /knowledge | editor 提交、admin 直入库 | A | P0 |
| 知识库 | 待审队列与审核 | /knowledge/review | admin | A | P0 |
| 知识库 | 资料详情：版本与审核记录、停用 | /knowledge/:id | 全部查看、admin 操作 | A | P0 |
| 质量与评测 | 评测集 | /evaluation/datasets | admin | B | P0 |
| 质量与评测 | 评测运行与报告 | /evaluation/runs、/evaluation/runs/:id | admin | B | P0 |
| 质量与评测 | 合规规则：查看与维护（新增、修改、停用，示例规则标注来源待核对） | /compliance/rules | 全部查看、admin 维护 | A | P0 |
| 增强（P1） | 爆款结构分析；多模型对比 | /analysis/viral、/compare | editor、admin | B | P1 |
| 系统 | 用户设置（模板自带）；审计日志 | /settings、/admin/audit | 全部、admin | A | P0 / P2 |

*表 4-3 导航与页面*

### 4.3.1 前端分工（2026-11-01 起）
后端已经全部完成，接口见 `docs/API_CONTRACT.md`，前端只用生成的客户端。分工如下：

| | 设计稿 | 前端实现 |
|---|---|---|
| **B** | **全部页面**（包括 A 实现的页面）：设计稿是视觉基线（ADR-008），通过 PR 提交到 `docs/design/` | 生成工作台、任务与版本历史、结果页（四类字段、证据面板、风险面板、编辑、重写、复检、确认、复制、导出）、评测集、评测运行与报告、人工评分 |
| **A（与 AI 助手）** | 审阅、对照契约提出修改 | 应用壳（顶栏、可折叠分组导航、品牌切换、用户菜单）、设计 token 与公共组件、品牌与切换、商品管理、品牌档案、知识库（列表与上传、待审队列与审核、详情与停用）、合规规则查看与维护、用户设置 |

约定：
- **文件归属**：应用壳（`frontend/src/routes/_layout.tsx`、`components/Sidebar`）、设计 token（`index.css`）、`components/Common` 归 A；B 的页面放在各自的路由文件和 `components/` 下自己的目录里，需要改公共部分先提小 PR 并 @A。
- **顺序**：A 先根据 B 导出的设计稿做应用壳和 token，B 的页面接进壳里。壳完成前，B 可以先在自己的目录里写页面，用客户端和假数据开发。
- **设计稿是视觉参考**：字段、选项、文案以契约、文案模块和接口为准；图与契约冲突时先列出来问人（见 `docs/design/README.md`）。

## 4.4 状态标签与视觉映射

| 枚举 | 中文标签 | 色调 | 备注 |
|---|---|---|---|
| flow_status: queued / generating / checking | 排队中 / 生成中 / 检查中 | 灰 / 蓝 / 蓝 | 进行中状态，轮询刷新 |
| checks_completed | 检查已完成，请查看结果 | 中性蓝灰 | 不使用绿色与“通过”字样，避免暗示合规通过 |
| needs_human_review / edited_pending_recheck | 需人工复核 / 已编辑待复检 | 橙 |  |
| constraint_failed | 约束未通过 | 红 | 显示失败项 |
| ready_to_copy | 可复制（运营已确认） | 绿 | 不是合规结论 |
| evidence: system_supported | 系统判定支持 | 浅绿 | 附“非事实保证”提示 |
| evidence: evidence_missing / needs_human_review | 未找到证据 / 需人工复核 | 橙 |  |
| source_level: approved_kb / task_material | 已审核知识库 / 任务内资料（未审核） | 蓝 / 灰 | 分开显示 |
| 资料: pending_review / approved / rejected / deactivated | 待审核 / 已入库 / 已驳回 / 已停用 | 橙 / 绿 / 红 / 灰 |  |
| 合规 severity: block / warn | 必须修改 / 建议关注 | 红 / 黄 | 附规则出处与版本 |

*表 4-4 状态标签映射*

## 4.5 设计稿交付
设计稿由 B 通过 PR 提交到 `docs/design/<page>/`：导出的 PNG（每张 ≤500 KB，命名为序号加页面名加状态）加一页 `spec.md`（需求编号、路由、角色、状态清单、区域与字段来源、交互、用到的组件与 token、与契约不一致的地方）。设计工具的链接只能作参考，不能代替导出图片；示例资料用自编内容，不使用客户原文（ADR-007）。A 审阅后落地为 token 与公共组件，B 在 PR 评论里 @ A 并等到确认再合并（ADR-009）。AI 助手读图只当视觉参考，字段、选项、文案以契约与接口为准。完整约定与自检清单见 `docs/design/README.md`。

# 5. 数据库约定与表归属

## 5.1 表归属

| 归属 | 表 |
|---|---|
| A | tenant、app_user、brand、brand_member、product、brand_voice_profile、kb_document、kb_review、kb_chunk（vector）、task_input、audit_log |
| B | scenario_template、style_preset、task、generation_version、constraint_check、claim_evidence、compliance_rule、compliance_check、eval_dataset、eval_case、eval_run、eval_result、llm_model_config、llm_call_log |
| P1 | viral_sample、viral_pattern（B） |

*表 5-1 表归属*

## 5.2 命名与字段约定

- 主键 UUID；时间 timestamptz 且为 UTC；JSON 字段用 jsonb；枚举值与 API 一致，英文小写加下划线。
- 租户表带 tenant_id；品牌表带 brand_id。brand_id 只是数据归属，行级安全加跨品牌读取测试都通过后才可称“已实现隔离”。
- 价格、规则、模板、提示词版本作为数据存储；不写死在代码里。
- 检索只能读 status = approved 且 is_current 的文档版本；kb_review 与审计表只增不改。

## 5.3 迁移规则（已确认，见 ADR-001）

- 各写各表：每位成员为自己拥有的表（5.1）编写迁移，autogenerate 后人工审阅；一个 PR 最多一条迁移。
- 迁移历史保持线性，不用 alembic merge。CI 要求只有 1 个 head、可从空库升级到 head、vector 扩展存在、可 downgrade 一步。
- 两个 PR 同时含迁移时，后合并者 rebase main，把自己迁移的 down_revision 改为当前 head，重跑检查再合并。
- 改对方的表或被引用的主键须经对方审查；B 的表可外键引用 A 的表，但不得改被引用主键。种子数据放种子脚本，不放迁移。
- Phase 0 由 A 把模板的单文件 models.py 拆成 models/ 包（identity、catalog、knowledge 归 A；generation、compliance、evaluation 归 B）。AI 可起草迁移，但须由表 owner 审阅并负责。

# 6. API 契约摘要与缺口

## 6.1 约定

- 基路径 /api/v1；JSON snake_case；ID 为 UUID 字符串；时间为 ISO 8601 UTC；写接口需 JWT。
- 错误统一：{"error":{"code","message","details","request_id"}}；错误码：BAD_REQUEST 400、VALIDATION_ERROR 422、UNAUTHENTICATED 401、FORBIDDEN 403、NOT_FOUND 404、CONFLICT 409、RATE_LIMITED 429、MODEL_UNAVAILABLE 503、INTERNAL_ERROR 500。
- 新增字段默认可选；删除或改名须版本化；变更先提契约 PR，再改服务端，再改前端，并补成功、验证错误、未授权、越权测试。

## 6.2 端点摘要（v1.1，字段见 docs/API_CONTRACT.md）

| 分组 | 端点 | 负责 | 权限 |
|---|---|---|---|
| 认证（沿用模板） | POST /login/access-token；POST /login/test-token；GET、PATCH /users/me；用户管理 /users…。公开注册 /users/signup 必须关闭 | A | 登录 / 平台管理员 |
| 品牌 | GET /brands；POST、PATCH /brands；成员 GET、POST、PATCH、DELETE /brands/{id}/members（不得移除最后一位 admin） | A | 成员 / 平台管理员 / 品牌 admin |
| 商品 | GET、POST /brands/{id}/products；PATCH /products/{id}；POST /products/{id}/archive（软删除） | A | 成员读 / admin 写 |
| 品牌档案 | GET voice-profile；GET、POST versions；POST versions/{v}/activate；POST drafts（P1，须人工确认） | A | 成员读 / admin 写 |
| 知识资料 | POST knowledge-documents（admin 直入库，approved）；POST knowledge-documents/{id}/versions；POST knowledge-submissions（运营，pending_review）；GET 列表与详情；GET chunks；POST reindex；POST reviews；POST deactivate | A | 见权限矩阵 |
| 场景与风格 | GET /scenarios；GET、POST /brands/{id}/style-presets | B | 登录 / 成员 |
| 任务与生成 | POST、GET /tasks；POST /tasks/{id}/generate（202，幂等）；GET /tasks/{id}；GET versions；GET /generation-versions/{id} | B | 品牌成员 |
| 编辑与确认 | POST edit、rewrite、recheck、confirm（需选定标题与封面）；POST /claim-evidence/{id}/confirm；GET export?format=xhs_parts\|markdown（仅 ready_to_copy） | B | 品牌成员 |
| 合规规则 | GET /compliance-rules；GET /compliance-rules/{id}（增改属 P2） | B | 登录 |
| 评测 | GET、POST /evaluation/datasets；GET cases；GET rubrics；POST、GET runs；POST ratings；GET agreement | B | 品牌 admin |
| 模型 | GET /models（价格为配置数据） | B | 登录 |
| 审计（P2） | GET /audit-logs | A | 品牌 admin |

*表 6-1 端点摘要*

## 6.3 通用约定（v1.1 新增）

| 主题 | 约定 |
|---|---|
| 403 与 404 | 显式带 brand_id 且非成员：403；按资源 ID 访问无权资源：404，不泄露存在性；角色不足：403 并写越权审计 |
| 分页排序 | page、page_size（默认 20，最大 100，超过 422）；sort=-created_at；响应含 total、page、page_size |
| 幂等与轮询 | generate、评测运行、模型对比支持 Idempotency-Key；GET 轮询先 2 秒，退避到 5 秒；progress.stage 枚举固定 |
| 文件限制 | PDF 与 DOCX ≤50 MB（演示手册约 42 MB 不得被拒）；MD 与 CSV ≤5 MB；粘贴文本 ≤100 KB；超限 FILE_TOO_LARGE、类型不符 UNSUPPORTED_FILE_TYPE、解析失败 PARSE_FAILED，均不得落半成品索引 |
| 复制格式 xhs_parts | 标题、正文、标签三者分开（界面三个复制按钮）；标签不含 #，复制时拼成 #标签1 #标签2；粘贴不会变成话题（ADR-005）；封面文案不并入；仅 ready_to_copy 可导出 |
| 确认前置 | confirm 须选定 selected_title_index 与 selected_cover_index，且无未处理 block 级风险、检查已针对最终文本运行，否则 INVALID_STATE |
| 证据确认 | 系统判定与人工确认分开存储：claim-evidence confirm 不改变 status，只记录 human_confirmed 与确认人 |

*表 6-2 通用约定*

仍待补：P1 接口细节（爆款分析、模型对比、任务文件输入）；合规规则的增改（P2）。复制格式已按发布页实测改为标题、正文、标签三个独立复制（ADR-005）。

# 7. 双人分工（全栈纵向切片）

> **分工变更（2026-10-31）**：成员 B 因前端设计稿工作量大，**全部后端工作改由成员 A 与 AI 助手承担**，包括下面 7.2 里 B 的后端、数据库与测试职责（场景、任务、生成、约束、证据、合规、评测、模型适配器及对应的表和迁移）。B 专注设计稿与前端页面，继续以 `API_CONTRACT.md` 为对接依据；后端接口变化会在 PR 评论里通知 B。本章 7.2 保留作为功能划分，负责人以本说明为准。迁移仍保持线性（ADR-001），现在由 A 一方编写。

## 7.1 成员 A：平台、品牌与知识资料；main 维护者

| 层 | 职责 |
|---|---|
| 前端 | 应用壳（顶栏、可折叠分组导航、品牌切换、用户菜单）、design token、components/common（空、错、加载态、状态徽标、数据表）；品牌、商品、品牌档案页；知识库列表、上传、待审队列、审核、详情页 |
| 后端 | 认证与品牌授权依赖；brands、products、voice-profile、knowledge-*、reviews、deactivate；文档解析与索引；KnowledgeSearch、TaskInputRepository、VoiceProfileProvider；审计 |
| 数据库 | 第 5.1 表中 A 的全部表及其迁移（ADR-001）；种子数据（冰希黎，不含客户原文，见 8.5） |
| 集成与运维 | GitHub 仓库与分支保护、CI 裁剪与新增、compose、依赖锁、README 启动说明、main 的合并与发布 |
| 测试 | TC-001–013、033、036、038、039、043、044、047、048；TC-C01–C07；前端壳相关 TC-F01、F08、F09 |
| P1 | F14 品牌隔离与串味测试；F12 解析器 |

## 7.2 成员 B：生成、核验、合规与评测

| 层 | 职责 |
|---|---|
| 前端 | 生成工作台（场景、风格、brief、资料输入、进度）、结果页（四类字段、证据面板、风险面板、编辑、版本对比、复检、确认、复制）、任务历史、评测集与评测运行与报告页、合规规则查看页 |
| 后端 | scenarios、tasks、generate、versions、edit、recheck、confirm、evaluation；提示词装配、约束、证据、合规三层、改写重检；模型适配器与成本记录 |
| 数据库 | 第 5.1 表中 B 的全部表及其迁移（ADR-001）；评测种子（测试集、词库） |
| 测试 | TC-014–032、040–042、045、046；前端结果页相关 TC-F02–F07、F10 |
| P1 | F13 爆款结构分析；F15 多模型成本对比 |

## 7.3 公共文件与冲突预防

- A 独占：.github/、compose.yml、依赖锁文件、全局路由与导航、公共 DB session、公共前端壳与 components/common。
- 任何一方修改 API 契约、公共错误模型、认证与品牌授权、提示词或规则含义，须先提契约或说明性 PR，对方在评论里确认后再编码。
- 接口未就绪时，用契约示例与 fake repository 并行，禁止把另一模块的临时实现复制进 main。

## 7.4 阶段与退出条件

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| 0. 契约与骨架 | A：建仓库与首个快照、分支保护、CI 裁剪、前端壳与 token、移除 Items 示例；B：评审契约与缺口、写 fake repository 与前端线框、评测集草案 | main 上 CI 全绿；两台机器按 README 启动；pgvector 扩展与迁移可重复；契约 v1 与目录所有权已合入。进度（2026-10-30）：仓库、CI、分支保护、Items 移除、models 拆包、跨模块接口与 fake 已完成；应用壳与 token（等 B 设计稿）、覆盖率基线文件、嵌入验证、发布端实测未完成 |
| 1. P0 并行 | 各自纵向切片：页面、接口、表、测试；每 1–2 天一个小 PR | 各模块单元测试通过；main 始终可启动 |
| 2. P0 集成与验收 | 接通真实 DB、模型适配器与 UI；端到端闭环；关键安全测试 | 第 10.3 验收清单全通过；缺陷清零或明确记录 |
| 3. P1 | 按剩余时间：F14、F13、F15、F12（见协作手册取舍顺序） | 每项独立验收，不影响 P0 |

*表 7-1 阶段*

# 8. GitHub 仓库与 Git 协作

## 8.1 仓库与角色

| 项 | 约定 |
|---|---|
| 仓库 | https://github.com/c4002159/RedNoteSearch（核查时：公开、空仓库；已决定改为私有，见 ADR-007） |
| 成员 A（main 维护者，GitHub：c4002159） | 仓库管理员：配置分支保护与 CI、合并 PR、维护 main 与发布。A 的开发同样走功能分支与 PR；改敏感路径须 @ B 并等到确认 |
| 成员 B（分支开发者，GitHub：CHNERUI） | 写权限协作者：只在功能分支开发并提 PR；不直接推送 main |
| 状态 | 已完成：仓库私有；CHNERUI 已是写权限协作者；初始快照已推送；分支保护已启用（ADR-009） |

*表 8-1 仓库与角色*

## 8.2 分支与提交

- main 为唯一集成分支，受保护。初始快照是唯一允许直接推送 main 的操作，由 A 完成，之后立即启用保护。
- 功能分支：feat/<owner>-<ticket>-<short-name>；修复分支：fix/<owner>-<ticket>-<short-name>；从最新 main 拉出，建议 1–2 天内合并。
- 小步提交，动词开头；一个 PR 对应一个可验收功能；不把全仓格式化、业务变更、依赖升级混在一个 PR。
- 合并方式：Squash and merge；合并后自动删除分支。禁止强推 main；回滚用 revert PR。
- 骨架快照：来自 fastapi/full-stack-fastapi-template 的 master，记录 SHA 于 README，不追随上游。

## 8.3 main 分支保护（A 配置）

| 设置 | 值 |
|---|---|
| Require a pull request before merging | 开；批准人数 0（不要求他人批准，ADR-009）；新提交使旧批准失效；要求处理完所有评论 |
| Require review from Code Owners | 关（ADR-009）；CODEOWNERS 只用于自动请求对方审查 |
| Require status checks to pass | 开；必选检查见 9.2；要求分支与 main 同步（strict） |
| Do not allow bypassing / Include administrators | 开：A 作为管理员也不能绕过，否则“任何合并必须通过 CI”不成立 |
| Restrict force pushes / deletions | 禁止 |
| Allowed merge methods | 仅 Squash；合并后删除头分支 |

*表 8-2 分支保护*

对 main 启用上述保护需要先有 main 分支，且必选检查的名称要在 Actions 跑过一次后才出现在可选列表中。实际应用的配置见附录 A。

## 8.4 CODEOWNERS 与审查

- 默认 * 由 A、B 共同拥有：用于自动请求对方审查；GitHub 不强制批准（ADR-009），作者可以自己合并，合并条件只有必选 CI。
- 敏感路径（契约、迁移、认证与品牌授权、检索过滤、提示词与合规规则、.github、compose、依赖锁）的改动：作者合并前须在 PR 评论里 @ 对方并等到确认（人工约定，不是自动门槛，对应 TC-C06）；AI 助手须提醒作者这样做。
- CODEOWNERS 账号：@c4002159（A）、@CHNERUI（B）。

## 8.5 PR 流程与数据风险

| 要素 | 要求 |
|---|---|
| PR 必填 | 需求编号；目的与实现；修改文件；API、数据库、提示词、规则影响；权限与品牌隔离影响；测试命令与真实结果；UI 截图或手动步骤；已知限制与回滚方式；是否使用 AI 及其范围 |
| 合并门槛 | 必选 CI 全绿；敏感路径已在评论里 @ 对方并收到确认；无未解释的 TODO 与临时密钥；契约与迁移已同步；主分支可启动 |
| 冲突 | 先沟通文件 owner；先合并公共契约再合并调用方；不强推覆盖对方提交 |
| 数据风险 | 仓库改为私有（ADR-007）。客户已允许品牌手册用于开发与演示；仍不得提交 PDF 原件、截图、API 密钥与 .env（模板曾提交带 changethis 的 .env，须改为 .env.example，CI 生成临时 .env）；种子数据不放手册原文的大段拷贝 |

*表 8-3 PR 与数据*

# 9. CI 约定（GitHub Actions）

## 9.1 原则

- 任何分支合入 main 必须通过 CI：由分支保护的必选检查强制，而不是靠约定。
- CI 不调用真实模型、不使用真实密钥；模型一律 mock。真实模型评测手动运行并记录版本，不入 CI。
- 不得为让 CI 通过而删除或降低测试断言；失败先判断是实现缺陷还是契约需变更。

## 9.2 必选检查

| 检查 | 内容 | 来源 |
|---|---|---|
| pre-commit（lint） | prek 配置：Biome、Python 风格与类型检查等 | 模板已有 |
| test-backend | 起 pgvector 数据库，迁移，运行 pytest；领域层覆盖率 ≥90% 且整体不低于基线（ADR-002） | 模板已有，需改：镜像、去掉 Items 测试、覆盖率规则 |
| frontend-build | tsc 类型检查与 vite build | 新增（模板 build 脚本） |
| playwright | 端到端用例 | 模板已有，用例替换为本项目 |
| test-docker-compose | 干净环境 compose 启动冒烟 | 模板已有 |
| migrations | Alembic 单 head、空库可升级到 head、扩展存在 | 新增 |
| contract | 生成 OpenAPI 并重新生成客户端，git diff 须为空 | 新增 |
| forbidden-wording | 扫描源码、文案、导出模板中的禁用措辞（见 2.3） | 新增 |
| secrets-scan | 密钥与 .env 扫描（如 gitleaks） | 新增 |

*表 9-1 必选检查（名称以实际 workflow 的 job 名为准）*

## 9.3 模板自带 workflow 的处置（待 Phase 0 逐个核对）

- 保留并改造：pre-commit、test-backend、playwright、test-docker-compose、detect-conflicts、zizmor（workflow 安全检查）、guard-dependencies（核对用途后决定）。
- 先禁用或删除（面向模板作者仓库，或需要未配置的密钥与服务）：add-to-project、bump-pre-commit-hooks、create-draft-release、prepare-release、deploy、deploy-docker-compose、issue-manager、smokeshow。
- 覆盖率（ADR-002）：领域层 backend/app/domain 行覆盖率 ≥90%；整体采用棘轮，A 在 Phase 0 清理 Items 后实测一次并记录基线，之后只升不降；模板无关模块的排除须逐项列出理由。Items 清理后的 CI 实测为 93%（593 条语句，漏 43 条，58 个测试通过）；基线文件 docs/decisions/coverage-baseline.txt 尚未建立，写入前须负责人确认数值，当前仍用模板默认 90% 作下限。
- Action 版本：模板用提交 SHA 固定，保持这种做法；升级走单独 PR。

# 10. 测试策略与用例

## 10.1 测试分层

| 层 | 覆盖 | 通过条件 |
|---|---|---|
| 单元 | 约束字符计数、规则匹配、风险分级、断言映射、成本计算、状态转换 | 正向、边界、反向；不依赖真实模型与数据库 |
| 集成 | API + PostgreSQL/pgvector：品牌权限、审核状态、版本、索引、任务快照 | 测试数据库；待审与停用不可检索；跨品牌拒绝；迁移可从空库运行 |
| 契约 | OpenAPI 与 JSON 示例；前后端字段一致 | 成功、参数错误、未授权、越权响应符合契约；客户端无漂移 |
| 端到端 | 入库审核、生成、检查、编辑复检、复制、保存评测 | 按 README 可运行；关键流程可从 UI 完成 |
| 评测 | 固定版本测试集；仅词库基线、不核验基线、人工写作基线 | 记录样本数、评分规程、版本；指标并列、可重复；不把一次小样本结果当普遍效果 |

*表 10-1 测试分层*

## 10.2 用例清单（docs/TEST_CASES.csv，共 69 条）

由原 37 条整理而来：TC-037 已并入 TC-005（编号保留不再使用，共 69 条原用例）；TC-003 与 TC-012 按新的 403/404 策略与文件限制更新；新增 TC-038–048（契约补齐相关）、TC-F01–F10（前端）、TC-C01–C07（CI 与仓库）。

| ID | 级 | 主题 | 前置与步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| TC-001 | P0 | 干净环境启动 | 前置：空数据库；Docker 可用<br>步骤：按 README 执行 compose 启动、迁移、seed | API 健康；vector 扩展存在；页面可访问；seed 可重复执行不重复污染 | 集成/验收 |
| TC-002 | P0 | 用户登录与当前身份 | 前置：有效用户与无效密码<br>步骤：登录后请求 /me；再用错误密码登录 | 有效身份返回最小用户信息；错误凭据 401；不泄露 hash | 集成 |
| TC-003 | P0 | 品牌授权过滤 | 前置：用户 A 仅属于品牌 A<br>步骤：请求品牌 B 商品/资料/任务 | 显式带 brand_id 且非成员：403；按资源 ID 访问无权资源：404（不泄露存在性）；无数据泄露；记安全审计 | 集成/安全 |
| TC-004 | P0 | 品牌上下文不能被伪造 | 前置：用户有品牌 A 权限<br>步骤：在创建任务请求里传无权 brand_id=B | 服务端拒绝，不以请求字段建立品牌上下文 | 安全 |
| TC-005 | P0 | 管理员直接入库（含无需再走审核） | 前置：管理员；合法 PDF/DOCX/MD/CSV<br>步骤：管理员上传合法 PDF/DOCX/MD/CSV；检查状态、索引、版本、提交人、审计；用文档中的唯一短语检索；确认未调用运营审核接口 | 状态为 approved；索引就绪后可检索到唯一短语；来源、哈希、提交人和 admin_direct_ingest 审计事件可追溯；无需再走运营审核接口；editor 调用同接口得 403 | 集成/权限 |
| TC-006 | P0 | 运营资料提交待审 | 前置：editor 用户<br>步骤：提交补充资料；检索该资料关键短语 | 资料状态待审核；搜索结果不包含该资料 | 集成/安全 |
| TC-007 | P0 | editor 越权审核 | 前置：editor；待审文档<br>步骤：直接调用 approve/reject API | 403；资料状态未变；写入越权审计事件 | 安全 |
| TC-008 | P0 | 管理员通过资料 | 前置：管理员；待审资料<br>步骤：审核通过并查询索引 | 产生不可变审核记录；索引建立完成后新任务可检索 | 集成 |
| TC-009 | P0 | 管理员驳回资料 | 前置：管理员；待审资料<br>步骤：驳回并写理由；再次搜索内容 | 驳回原因和操作人可见；资料不参与检索 | 集成 |
| TC-010 | P0 | 已入库资料新版本 | 前置：资料 v1 已入库<br>步骤：编辑内容后提交 v2；审核前检索、审核后检索 | 审核前按有效版本政策检索；通过后新任务用 v2；v1 与历史引用仍保留 | 集成 |
| TC-011 | P0 | 停用资料 | 前置：资料已入库且被历史稿件引用<br>步骤：停用资料并分别查询新任务与历史稿 | 新任务不检索；历史 generation version 仍指向旧文档版本/chunk 快照 | 集成 |
| TC-012 | P0 | 文件格式和大小校验 | 前置：上传超限文件及不支持扩展名<br>步骤：分别提交：超限文件、不支持扩展名、损坏文件；再提交约 42 MB 的合法 PDF | 超限 FILE_TOO_LARGE、类型不符 UNSUPPORTED_FILE_TYPE、损坏 PARSE_FAILED，均为 422 且不落半成品索引；42 MB 合法 PDF 不被拒绝（PDF/DOCX 上限 50 MB，MD/CSV 上限 5 MB） | 集成 |
| TC-013 | P0 | 任务资料快照不变 | 前置：运营任务资料已创建<br>步骤：修改源文件或将资料提交知识库；读取旧生成版本 | 原任务快照/hash/引用不变；新任务按授权策略处理 | 集成 |
| TC-014 | P0 | 多场景模板版本 | 前置：已配置多个场景和模板版本<br>步骤：选择场景生成并读取 generation version | 记录正确 scenario/template version；旧版本仍可追溯 | 集成 |
| TC-015 | P0 | 结构化生成 schema | 前置：模型返回符合 schema 内容<br>步骤：提交生成任务 | 返回 title_candidates/body/hashtags/cover_candidates；缺字段响应按失败处理 | 契约/集成 |
| TC-016 | P0 | 标题加权长度边界 | 前置：候选标题：20 个汉字、21 个汉字、40 个英文或数字、41 个、10 个汉字加 20 个半角、10 个汉字加 21 个半角<br>步骤：运行约束检查 | 20 个汉字通过，21 个失败；40 个半角通过，41 个失败；10 汉字加 20 半角（权重 20）通过，加 21 半角（20.5）失败；ASCII 可打印字符计 0.5，其余计 1（ADR-004） | 单元 |
| TC-017 | P0 | 必含词与禁用词 | 前置：设置必含词及禁用词<br>步骤：分别输入通过、缺必含词、命中禁用词文本 | 检查结果精确标出字段和命中词；规则来自对应品牌 | 单元 |
| TC-018 | P0 | 约束失败重试上限 | 前置：模型连续返回不合格结果<br>步骤：执行生成流程 | 仅按配置次数重试；仍失败则 constraint_failed；不无限调用模型 | 集成 |
| TC-019 | P0 | 证据支持标注 | 前置：已审核资料含明确断言<br>步骤：生成包含该断言的笔记并查看 evidence | 展示“系统判定支持”、来源级别、文档版本、chunk 和理由；不显示事实保证 | 集成/人工评审 |
| TC-020 | P0 | 证据不足拒绝具体事实 | 前置：资料无具体数字/奖项/日期<br>步骤：提示模型生成该事实 | 结果不应编造具体断言，或标记 evidence_missing/needs_human_review 并阻止直接确认 | 评测/人工评审 |
| TC-021 | P0 | 任务资料与知识库证据分开 | 前置：同一断言仅在任务输入存在<br>步骤：生成并评测 | UI 区分任务资料与已审核知识库；指标分别统计；不把临时资料标成已审核 | 集成 |
| TC-022 | P0 | 合规规则命中和出处 | 前置：已登记规则带来源与版本<br>步骤：提交命中词、医疗表述和功效证据不足内容 | 返回规则 ID/版本/适用范围/严重度/span/建议；输出是风险提示 | 单元/集成 |
| TC-023 | P0 | 语境规则避免简单误报 | 前置：准备肯定、否定、引用语境样例<br>步骤：运行第二层风险判断 | 区分上下文；不因否定或讨论语境自动当作风险通过，必要时需人工复核 | 评测 |
| TC-024 | P0 | 改写后强制重检 | 前置：原稿存在 block 级风险<br>步骤：执行改写并检查日志/版本 | 改写生成新版本，约束/证据/合规检查均重新运行；保留前后稿 | 集成 |
| TC-025 | P0 | 运营编辑后复检 | 前置：已有 checks_completed 版本<br>步骤：编辑文本并保存 | 新 version_no，状态 edited_pending_recheck；旧检查快照未被覆盖 | 集成 |
| TC-026 | P0 | 运营确认状态命名 | 前置：最终稿检查完成并有人工作业确认<br>步骤：调用 confirm API | ready_to_copy 并记录确认人时间；界面不称“合规通过” | 集成/UI |
| TC-027 | P0 | 三个复制按钮 | 前置：ready_to_copy 稿件<br>步骤：分别点击复制标题、复制正文、复制标签并检查剪贴板 | 标题、正文、标签分别复制；标签为 #标签1 #标签2（单空格）；界面显示“已选 N / 10”与“粘贴不会变成话题”的提示；剪贴板不可用时提供手动复制降级 | 端到端 |
| TC-028 | P0 | 评测集版本固定 | 前置：有固定 eval_dataset version<br>步骤：运行一次评测并再次查看 | 记录 dataset/model/prompt/checker 版本、样本数及逐项结果，可重现 | 集成 |
| TC-029 | P0 | 人工评分一致性记录 | 前置：两位评分者完成量表<br>步骤：汇总结构/调性评分 | 保存评分者、量表版本与一致性统计；不输出无定义综合分 | 评测 |
| TC-030 | P0 | 模型费用和延迟日志 | 前置：模型 mock 返回 token/延迟数据<br>步骤：执行生成后查看 llm_call_log | 记录 provider/model/token/价格版本/cost/latency/status；错误调用也可追溯 | 集成 |
| TC-031 | P0 | 模型失败和超时 | 前置：模型 mock 超时/限流/空响应<br>步骤：执行生成 | 有界重试；用户输入保留；显示安全错误；状态不误报完成 | 集成/故障注入 |
| TC-032 | P0 | 完整追溯抽查 | 前置：已有已编辑任务版本<br>步骤：从版本追查 prompt/template/voice/checker/model/retrieved chunks/check snapshots | 可定位全部版本和来源；历史资料停用不破坏追溯 | 验收 |
| TC-033 | P1 | 跨品牌串味测试 | 前置：品牌 A/B 有互斥词与专属知识<br>步骤：以 A 权限生成，检查 B 专属词/事实是否泄露 | 跨品牌检索无结果；固定串味用例记录误泄露率 | 回归/安全 |
| TC-034 | P1 | 爆款结构不复刻原文 | 前置：用户提交一段样本笔记<br>步骤：运行结构分析并生成模板 | 输出结构标签和抽象模板；不得大段复用样本文句；样本不写入公共知识库 | 集成/人工评审 |
| TC-035 | P1 | 多模型同输入对比 | 前置：配置 2–3 个可用模型<br>步骤：提交同一 brief 批量运行 | 每个模型独立记录版本、延迟、费用、约束和人工评分；失败模型单独显示 | 集成 |
| TC-036 | P1 | 任务文件解析隔离 | 前置：上传有效/损坏 PDF、DOCX、CSV<br>步骤：作为任务输入解析后运行生成 | 显示解析摘要/错误；任务输入只存快照，不建知识库索引 | 集成 |
| TC-038 | P0 | 关闭自助注册 | 前置：生产或演示配置<br>步骤：调用 POST /users/signup | 被关闭（404 或 403），不能自助创建账号；账号只能由平台管理员创建 | 集成/安全 |
| TC-039 | P0 | 分页与排序约定 | 前置：列表数据超过 100 条<br>步骤：page_size=1000；sort=-created_at；未知过滤参数 | page_size=1000 返回 422 VALIDATION_ERROR；sort=-created_at 排序正确；未知过滤参数被忽略；响应含 total/page/page_size | 契约 |
| TC-040 | P0 | 断言人工确认与系统判定分离 | 前置：版本含 system_supported 断言<br>步骤：调用 claim-evidence confirm 设置 human_confirmed=false/true | status 不变；confirmed_by/at 记录；评测可分别统计“已审核来源支持”与“人工确认事实正确” | 集成 |
| TC-041 | P0 | 确认稿件的前置条件 | 前置：版本存在 block 级风险或未复检<br>步骤：调用 confirm（含/不含 selected_title_index） | 未满足前置返回 INVALID_STATE；满足后 ready_to_copy 并记录选定标题、封面、确认人；不称合规通过 | 集成 |
| TC-042 | P0 | 导出格式与状态限制 | 前置：一个 ready_to_copy 与一个未确认版本<br>步骤：export?format=xhs_parts 与 markdown | 未确认版本 INVALID_STATE；xhs_parts 返回 title、body、tags、counts 且 tags 不含 #；无 Markdown 标记；封面文案仅在 markdown 中 | 契约/端到端 |
| TC-043 | P0 | 生成幂等 | 前置：同一任务<br>步骤：相同 Idempotency-Key 重复调用 generate；同 key 不同体 | 相同体返回同一结果不重复生成；不同体 IDEMPOTENCY_CONFLICT | 集成 |
| TC-044 | P0 | 品牌成员与最后一位管理员 | 前置：品牌仅一位 admin<br>步骤：移除或降级该 admin | CONFLICT；至少保留一位 admin | 集成 |
| TC-045 | P0 | 评测集版本固定 | 前置：已创建评测集 v1<br>步骤：修改用例后保存 | 产生 v2，v1 不变；已运行的评测仍指向 v1 | 集成 |
| TC-046 | P0 | 评分与一致性 | 前置：两位评分者对同一运行评分<br>步骤：提交评分并查询 agreement | 记录评分者、量表版本、评分者人数与一致性方法；无评分者不输出一致性 | 集成 |
| TC-047 | P0 | 商品卖点来源 | 前置：商品卖点无来源<br>步骤：保存无 source 的卖点 | 保存为草稿，不参与“可作证据”；有已审核来源的卖点可作证据 | 集成 |
| TC-048 | P0 | 检索过滤组合 | 前置：同品牌含已入库、待审、驳回、停用、旧版本文档，另有其他品牌文档<br>步骤：对同一关键词检索 | 仅返回本品牌、approved、当前有效版本；任务内资料仅所属任务可见 | 集成/安全 |
| TC-049 | P0 | 正文 1000 码元边界 | 前置：正文：恰好 1000 与 1001 个 UTF-16 码元；含 emoji（计 2）与换行（不计）<br>步骤：运行约束检查 | 去掉换行后 1000 通过、1001 失败并标出字段；emoji 计 2；换行不计；标签的可见字符计入预算；与前端计数提示一致 | 单元 |
| TC-050 | P0 | 标签数量上限 | 前置：版本含 10 个与 11 个标签<br>步骤：运行约束检查 | 10 个通过；11 个失败并标出字段（发布页最多 10 个话题）；标签可见字符计入正文预算 | 单元 |
| TC-051 | P1 | 导入样本去除隐藏话题后缀 | 前置：用户粘贴从发布页复制的样本，含 [话题]# 后缀<br>步骤：导入爆款样本并分析 | [话题]# 被去除；样本文本中不出现该后缀；标签名保留 | 集成 |
| TC-F01 | P0 | 角色导航与后端 403 | 前置：editor 登录<br>步骤：查看导航；直接访问待审与评测路由或接口 | 导航不显示相应入口；页面正确展示 403；后端拒绝 | 端到端/安全 |
| TC-F02 | P0 | 禁用措辞扫描 | 前置：前端源码与导出模板<br>步骤：CI 扫描“合规通过”“已验证事实”“法务批准”“保证合规” | 无命中；checks_completed 显示无通过字样 | CI/单元 |
| TC-F03 | P0 | 异步视图四态 | 前置：资料列表、任务结果、评测报告<br>步骤：分别模拟加载、空、错误、成功 | 四态均有表现；错误态显示 request_id | 端到端 |
| TC-F04 | P0 | 状态标签映射完整 | 前置：后端枚举全集<br>步骤：遍历 flow_status、证据、资料、严重度枚举 | 均有中文标签与色调；未知枚举降级显示原值 | 单元 |
| TC-F05 | P0 | 字数提示与后端一致 | 前置：标题（汉字、半角、混合）与正文（含 emoji、换行）的边界样例<br>步骤：前端提示与后端判定对比 | 前端提示与后端判定一致；后端为权威；两边用同一组边界用例 | 单元/端到端 |
| TC-F06 | P0 | 品牌切换 | 前置：用户属于品牌 A、B<br>步骤：切换品牌；构造他人品牌 ID 的请求 | 列表与请求目标随之变化；越权请求被后端拒绝并展示 403 | 端到端/安全 |
| TC-F07 | P0 | 任务状态恢复 | 前置：生成进行中<br>步骤：刷新页面或断网重连 | 通过 GET /tasks/{id} 恢复状态；输入与编辑不丢 | 端到端 |
| TC-F08 | P0 | 分辨率 | 前置：主要页面<br>步骤：1280 与 1024 px 视口 | 无横向溢出 | 端到端 |
| TC-F09 | P0 | 无障碍基础 | 前置：表单与主要操作<br>步骤：键盘遍历；检查 label 与对比度 | 控件有 label，键盘可达，焦点可见，对比度满足 AA | 手动/自动 |
| TC-F10 | P0 | 证据与风险展示 | 前置：含证据与风险的版本<br>步骤：打开结果页 | 证据面板显示来源级别、版本、状态与“非事实保证”提示；风险面板显示规则出处、版本、严重度 | 端到端 |
| TC-C01 | P0 | 未过检查不可合并 | 前置：main 已启用保护<br>步骤：让一个必选检查失败 | 合并按钮不可用 | 仓库 |
| TC-C02 | P0 | 禁止直推 main | 前置：main 已启用保护<br>步骤：尝试直接推送 main（含管理员） | 被拒绝 | 仓库 |
| TC-C03 | P0 | 迁移线性与空库升级 | 前置：两个分支各加一个迁移<br>步骤：先后合并；单 head 时空库升级 | 多 head 时 CI 失败；单 head 空库升级成功且 vector 扩展存在；downgrade 一步可执行 | CI |
| TC-C04 | P0 | 契约漂移 | 前置：修改后端响应<br>步骤：不重新生成客户端即提 PR | contract 检查失败 | CI |
| TC-C05 | P0 | 密钥扫描 | 前置：PR 中加入假密钥<br>步骤：运行 secrets-scan | 失败 | CI |
| TC-C06 | P0 | 敏感路径改动须 @ 对方确认 | 前置：修改契约、迁移、认证与品牌授权、检索过滤、提示词与合规规则、CI 或依赖锁的 PR<br>步骤：检查 PR 描述与评论：作者已 @ 对方并收到确认；CODEOWNERS 已自动请求对方审查 | 评论里有对方的确认记录；GitHub 不强制批准（ADR-009），所以这是人工检查项，不是自动门槛 | 人工检查 |
| TC-C07 | P0 | 领域层覆盖率门槛 | 前置：domain 目录<br>步骤：运行覆盖率检查 | 领域层覆盖率低于 90% 时失败；整体覆盖率低于基线时失败 | CI |
| TC-052 | P0 | 创建品牌：创建者成为 admin 与默认租户 | 前置：平台管理员；尚无租户<br>步骤：POST /brands 创建品牌，再 GET /brands | 201；slug 自动生成（中文名为 brand-xxxxxxxx，重名自动加后缀）；创建者在 GET /brands 里角色为 admin；品牌归入默认租户；非平台管理员 403 | 集成 |
| TC-053 | P0 | 平台管理员无品牌数据万能钥匙 | 前置：平台管理员不是某品牌成员<br>步骤：调用 BrandAccessDep（或任一品牌范围内路由）访问该品牌 | 403；平台管理员只能管理品牌与成员（BrandManagerDep），要访问品牌数据须先成为成员 | 集成/安全 |

*表 10-2 测试用例*

## 10.3 P0 验收清单

- 两人在干净环境按 README 启动；迁移、vector 扩展、种子数据执行成功（待 Docker 实测）。
- 运营只能访问被授权品牌；管理员管理品牌与资料；权限由后端强制。
- 待审资料不参与检索；通过后可检索；新版本需重新审核；停用后新任务不引用，历史版本仍可追溯。
- 输出结构字段完整；标题字数、必含词、禁用词可确定性检查；失败状态不伪装成合规通过。
- 断言展示来源级别、文档版本、chunk 或任务快照、系统判断状态与人工确认；证据不足时不写具体事实。
- 合规风险展示规则来源、版本、适用范围；改写后复检；编辑后最终文本重新检查。
- 评测使用固定测试集与明确评分表；成本、延迟、约束与人工评分可追溯。
- 版本、提示词、检索片段、模型与参数、检查器版本及最终文本可回查；复制格式可从界面完成。
- main 上必选 CI 全绿，分支保护已启用。

# 11. 与 AI 协作的约定

AI 编码助手用于加快实现，不改变需求基线、接口、安全边界或合规口径；每项改动由团队成员审查并负责。以下整合自 AI_TEAM_GUIDE.md。

## 11.1 开始任务前

- 阅读需求规格书、本文、API_CONTRACT.md、AI_TEAM_GUIDE.md 与对应模块 README。
- 确认任务编号、负责人、可改与禁改文件、验收标准、测试命令；不明确先列问题，不猜权限与数据规则。
- 查看当前分支与未提交改动；保留他人工作，不覆盖、不重置、不格式化无关文件。
- 先给出不超过 5 行的实施计划；按小步修改。

## 11.2 文件所有权与禁止事项

- A 与 B 的文件范围见 3.3、7.1、7.2；共享契约与公共错误模型改动须先在 API_CONTRACT.md 提 PR，双方同意后再编码。
- AI 不得擅自：创建迁移、改公共 DTO、改 JWT 或品牌授权、引入依赖、变更提示词或规则含义、删除测试、改动 .github 与 CI。必须先说明并获模块 owner 同意。
- 前端补充：只用生成的 API 客户端；不手改 src/client；不引入新的 UI 库；颜色用 token；文案走文案模块；不放死按钮；使用禁用措辞即为缺陷。
- 客户已允许品牌手册用于开发与演示（含外部 AI 服务与大模型调用，ADR-007）；仍不得把 PDF 原件、截图、密钥或 .env 提交到仓库或贴进公开渠道。

## 11.3 架构边界与代码规范

- 模块化单体；领域逻辑不依赖 FastAPI、SQLModel、外部模型 SDK。
- 所有品牌查询经服务端授权上下文；不信请求体 brand_id。
- 待审、驳回、停用资料不进新任务检索；任务资料只属该任务，保存不可变快照与哈希。
- “系统判定支持”不等于事实正确；ready_to_copy 仅代表运营确认；最终编辑稿必须重新运行三项检查。
- 复用现有模式；不无故新增抽象层；函数短小，类型与 Pydantic 模型明确。
- 错误返回用契约统一格式；日志不泄露密钥、密码、完整敏感资料。
- 迁移可从空库执行、可审查；对模型输出做 schema 校验；超时、限流、空响应有显式错误状态；重试有上限。
- 字数约束规定计数口径并测试 emoji、空格、标点、组合字符边界。
- 不写无依据的法条解释；规则记录来源、条款、版本、适用范围、有效期。

## 11.4 测试与自检

- 改领域逻辑：补单元测试（正常、边界、失败）。改 API：补契约与集成测试，含 401、403、验证错误、跨品牌访问。改 UI：提供手动步骤或端到端用例，检查加载、错误、空状态。
- 改提示词、检索、模型：固定小样本回归，记录模型与提示词版本；不因一次成功就称准确。
- 不删除或降低既有断言以迎合实现。AI 不得声称执行了未实际运行的测试；报告精确命令与结果。
- 完成前：git diff --check；差异只涉及授权文件；运行所需测试或标明未运行及原因；检查权限、状态、错误边界、空值与恢复；更新契约、README、迁移说明；汇报改动、测试、风险、未完成项。
- AI 不自行合并或推送；等待人类审查。PR 描述注明 AI 使用情况。

已处理：模板的 `.agents`、`.claude` 目录里只有 library-skills，以及两个在本仓库里已变成无效文本文件的条目（fastapi、sqlmodel，上游本是指向 `.venv` 的符号链接），连同 `pyproject.toml` 里遗留的 `smokeshow` 依赖一起移除。

# 12. 开发环境与启动

## 12.1 前置

- Docker Desktop（需处于运行状态）、Git、uv、bun（模板前端用 bun）。Python 由 uv 按模板 .python-version 拉取 3.14（依赖兼容已验证，见 ADR-003），所有人用同一版本。
- 复制 .env.example 为 .env 并填入本地值；模板默认的 changethis 仅限本地，不得带入共享环境。
- 模型密钥（DeepSeek、阿里云百炼、OpenAI）只放本地 .env 与 CI 加密变量，不入库；CI 不使用真实密钥。

## 12.2 命令（取自模板 development.md，待首次启动验证）

| 目的 | 命令 |
|---|---|
| 只起数据库与邮件 | docker compose up -d db mailpit |
| 后端依赖与迁移 | cd backend；uv sync；uv run bash scripts/prestart.sh |
| 后端开发服务 | uv run fastapi dev |
| 前端开发服务 | cd frontend；bun install；bun run dev |
| 生成接口客户端 | bun run generate-client（后端接口变更后） |
| 整栈 | docker compose run --rm backend bash scripts/prestart.sh；docker compose watch |
| 后端测试 | cd backend；bash scripts/test.sh |
| 前端端到端 | cd frontend；bun run test |
| 格式与检查 | bash backend/scripts/lint.sh；frontend: bun run lint |

*表 12-1 常用命令*

当前状态：CI 已在 Linux 上验证整栈 compose 启动、迁移与后端测试；本机 Docker 引擎未运行，上述命令未在开发机上实测。

# 13. 沟通机制、风险与待确认项

## 13.1 沟通

- 每日 10 分钟同步：昨日完成、今日计划、阻塞与需要对方的接口。决策写入 docs/decisions/。
- 每个需求有唯一 owner 与验收人：owner 写实现与测试；另一人审查契约、安全边界与关键流程。
- 不确定的问题先记决策日志（选项、影响、负责人、截止时间），不得各自猜测写出两套实现。
- P0 范围冻结后，新增需求进候选清单，只有阻断验收或修复错误才打断当前工作。

## 13.2 已确认的决定

| 事项 | 决定 | 位置 |
|---|---|---|
| 仓库可见性 | 改为私有；客户已允许手册用于开发与演示；PDF 原件、截图、密钥、.env 不入库 | ADR-007 |
| 成员与权限 | A = c4002159（仓库所有者、main 维护者）；B = CHNERUI（写权限协作者，只在分支开发） | 8.1 |
| 迁移所有权 | 各写各表，迁移线性，CI 强制单 head | ADR-001 |
| 覆盖率 | 领域层 ≥90% 加整体棘轮 | ADR-002 |
| Python | 保持 3.14，Linux CI 首次运行再确认 | ADR-003 |
| 字数口径 | 与发布页一致：标题加权 ≤20、正文去换行后 UTF-16 码元 ≤1000、标签 ≤10 | ADR-004（修订） |
| 标签与复制 | 标题、正文、标签分开复制；粘贴不会变成话题 | ADR-005（修订） |
| 模型与嵌入 | DeepSeek、Qwen（百炼）、OpenAI GPT；嵌入用百炼文本嵌入；不接入 Claude | ADR-006 |
| 视觉基线 | B 的设计稿经 A 确认后为基线；千瓜只作布局与交互参考 | ADR-008 |
| 分支保护与审查 | 已启用：必选检查、PR、同步、管理员不绕过、仅 Squash；不要求他人批准，敏感路径靠评论确认 | ADR-009 |
| 骨架清理 | Items 示例已移除；models 拆成包；迁移 c3f9a7d1e2b5 删除 item 表；migrations 检查加 alembic check；跨模块接口与 fake 已合入 | PR #6、#8 |
| 契约不完整、用例重复、Python 兼容 | 已在上一版处理：契约 v1.1、用例合并为 67 条、Python 3.14 本地验证 | API_CONTRACT.md；TEST_CASES.csv；ADR-003 |

*表 13-1 已确认的决定*

## 13.3 仍待办与待确认

| # | 事项 | 负责 | 说明 |
|---|---|---|---|
| 1 | （已完成）仓库已设为私有，CHNERUI 已添加，初始快照已推送，分支保护已启用 | A | ADR-007、ADR-009 |
| 2 | 在发布页验证：点击“发布”时标题超限、正文超限、话题超过 10 个是否被拦截；标题里全角标点与 emoji 的计数（上限与主要计数规则已实测，见 ADR-004、ADR-005） | A 或 B | 结果记入 ADR-004、ADR-005 |
| 3 | 整体覆盖率基线数值 | A | CI 实测 93%；写入基线文件前须负责人确认 |
| 4 | Linux CI 上的 Python 3.14、迁移与数据库验证 | A | 首次 CI 运行 |
| 5 | 模板 workflow 逐个核对（已完成）；.agents、.claude 与 smokeshow 清理（已完成） | A | 已完成 |
| 6 | 阿里云百炼嵌入模型的型号与维度 | A | 查官方文档后写入首个 kb_chunk 迁移 |
| 7 | 重试默认值（模型调用 ≤2、约束重生成 ≤2、合规改写 ≤2） | A、B | 提案，待确认 |
| 8 | B 的设计稿，及由此产生的契约字段（场景与结构模板、受众与重点、高级约束、上传入口） | B（A 审阅） | 需要改契约时走契约变更流程 |
| 9 | P1 接口细节（爆款分析、模型对比、任务文件输入） | B / A | P0 验收后再补 |
| 10 | 成员 B 对 ADR-001 至 ADR-009 的知悉与复核 | B | 第一次同步会上记录 |

*表 13-2 仍待办与待确认*

## 13.4 已知风险

- 本机 Docker 未运行：本地无法跑后端测试、迁移与 Playwright，以 CI 结果为准；覆盖率已在 CI 测得 93%，尚未写入基线文件。
- 评审提供的外部链接（监管指南、飞书、小红书文档）我多数未逐个打开，规则登记前须通读原文。
- 竞品入口与 Jasper 反馈为抽样与待验证假设，不作强结论。

# 附录 A：仓库初始化与保护配置（已执行，记录实际值）

以下是 2026-10-30 实际执行的操作与最终生效的值（分支保护见 ADR-009）。初始快照是唯一一次直接推送 main，之后一律走 PR。

```
# 1. 初始快照（唯一允许的直推）
git init -b main && git add . && git commit -m "chore: initial snapshot from fastapi/full-stack-fastapi-template@f4bcfab"
git remote add origin https://github.com/c4002159/RedNoteSearch.git && git push -u origin main

# 2. 先让 Actions 在一个 PR 上跑一次，使检查名出现，再启用保护
gh api -X PUT repos/c4002159/RedNoteSearch/branches/main/protection --input protection.json

# protection.json（2026-10-30 实际应用的值，ADR-009）
{
  "required_status_checks": {"strict": true, "contexts": ["pre-commit-alls-green","alls-green-playwright","test-backend",
                             "test-docker-compose","migrations","contract","frontend-build","forbidden-wording","secrets-scan","Run zizmor"]},
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 0,
                                    "dismiss_stale_reviews": true, "require_code_owner_reviews": false},
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false, "allow_deletions": false,
  "required_conversation_resolution": true
}

# 3. CODEOWNERS
*                      @c4002159 @CHNERUI
/docs/API_CONTRACT.md  @c4002159 @CHNERUI
/backend/app/alembic/  @c4002159 @CHNERUI
/.github/              @c4002159 @CHNERUI
/compose.yml           @c4002159 @CHNERUI
```

# 附录 B：交付文件对应

| 文件 | 用途 |
|---|---|
| 需求规格说明书_小红书美妆香氛文案智能体.docx | 需求与架构基线 v1.0 |
| 两人开发分工与协作手册_….docx | 本文第 7、8、10 章的来源（原件在 Codex 输出目录） |
| docs/API_CONTRACT.md | v1.1，接口字段权威来源 |
| docs/TEST_CASES.csv | 67 条用例，本文 10.2 的来源 |
| docs/decisions/ADR-001 至 ADR-009 | 迁移、覆盖率、Python、字数口径、标签写法、模型与嵌入、仓库与客户资料、视觉基线、分支保护（不要求他人批准） |
| AI_TEAM_GUIDE.md | 更新版，放仓库根目录 |
| 本文 | 整合版技术文档；与上述文件冲突按第 0 章规则处理 |
