# 前端与 Stitch 设计的视觉差异记录（草稿）

**对比基线 = main@7ffd043**。设计来源：`~/Downloads/stitch_rednotesearch_operations_workbench 3/`；`rednotesearch_5/code.html` 28,786 字节、`screen.png` 560,954 字节，均与指定核对值及本机 `(35).zip` 对应文件相符。

记录日期：2026-11-02。由 B 的 AI 助手 OpenAI Codex 执行本机只读查看、截图、DOM 样式读取及整理；不是 Ray 的人工设计验收。仅供 A 与 B 判断改动范围，本 PR 不修改应用实现。

## 设计稿来源与核对结果

使用本机 `~/Downloads/stitch_rednotesearch_operations_workbench 3/`。其中直接包含 59 个页面目录及 `airy_precision/DESIGN.md`，没有额外套一层目录。

| 核对文件 | 本机大小 | A 提供的大小 | 与本机 `(35).zip` 中同名文件逐字节比较 | SHA-256 |
|---|---:|---:|---|---|
| rednotesearch_5/code.html | 28,786 | 28,786 | 相符 | `f050fc23374c62c2bcb4d138757e0832cb1aa3b286f734f28ecb5b8fc7bc986f` |
| rednotesearch_5/screen.png | 560,954 | 560,954 | 相符 | `506be3e47a18fe7accf10b357e1367dd58c5b390d21b2a84875f19e2a7d88365` |

因此按指定核对条件使用该文件夹，未另外解压。核对只证明这两个指定文件与 ZIP 对应；不宣称对 ZIP 全部条目做过内容校验。原始 HTML/PNG/ZIP 不提交。仓库 `docs/design/*/spec.md` 与 ADR-008 仅用于路由对应、组件决策和识别已知有意不同。

实际发现 45 张原 PNG 不是 2560px 宽；该页 PNG 损坏，改用 code.html 渲染（`rednotesearch_16`，PNG 为 1600×1280 全黑）。所有并排图左侧统一采用**原始 code.html 在 1440×900 视口联网渲染的截图**，原 PNG 用于核图；右侧为本次前端截图。两边均等比缩到 720px 宽，保留全页高度，短侧下方补灰底，不拉伸或重排。商品与品牌档案的设计 HTML 只关闭预置抽屉后截图，没有改源文件。1280 两图单独标注。

设计系统有内部差异：`DESIGN.md` 的圆角/渐变描述与页面 HTML、已确认 token spec 并非一套值。样式实测以每页 HTML 为准，是否建议修复同时参照 token spec；不把系统字体、lucide、加深边框当成缺陷。

## 环境、方法与计数口径

- 对比前端：upstream main `7ffd043acc7fd7816a9223b3e24b67dc3958d38d`。先执行 `git fetch upstream main`，连接 GitHub 443 在 75 秒后超时；改用 GitHub API 核实 SHA，再由 codeload 下载该精确提交到新目录，未覆盖旧目录修改。
- 本机独立后端 `127.0.0.1:8010`，`LLM_MODE=demo_fake`；前端为该提交的生产构建，`VITE_API_URL=http://127.0.0.1:8010`。设计 HTML 由只监听回环地址的 8020 静态服务提供。
- 使用此前 `--fake-embeddings` 建立的演示库（冰希黎（演示）及隔离测试品牌）。本轮不 seed、不新建/编辑/删除业务数据，不点击生成、重写、结构分析或评测运行；只读取既有任务两版。登录/退出仅切换本机测试会话。403 使用既有测试编辑者；资源 404 使用该编辑者不可见的既有另一品牌任务。
- 视口由浏览器能力设置，并逐次读 `innerWidth/innerHeight` 验证；常规 1440×900，另测 1280×900 的工作台/结果页。截图为全页，故图片高度可能超过 900。加载未完成的截图已剔除。
- 高/中/低为视觉影响判断，不是像素相似度或缺陷严重性。每一行是一个可定位观察，不按 CSS 属性数重复计数。A=全局壳；B=组件样式；C=页面布局/文案；D=有依据的有意不同。D 单列不计缺陷。共同壳差异在每个有稿页面重复计数，跨页总数不代表独立修复项数。
- 场景、商品、样本数量、当前状态、空/加载/错误、角色可见导航及测试账号文字，不据此判缺陷。无对应设计稿的页面不报“0 个缺陷”，而是“无法计”。本轮爆款/评测有仓库 PNG，仅其骨架可目测；无原始 HTML，不做样式实测。

## 总表

| 页面 | A/B/C 条数 | 高 | 中 | 低 | D（不计缺陷） | 最影响观感的三项 |
|---|---:|---:|---:|---:|---:|---|
| 生成工作台 | 7 | 2 | 3 | 2 | 2 | 场景选择；主栅格；顶栏与 Logo |
| 任务列表 | 7 | 0 | 4 | 3 | 1 | 顶栏与 Logo；列顺序与内容；历史展开方式 |
| 独立任务版本历史 | 5 | 0 | 3 | 2 | 1 | 顶栏与 Logo；信息架构；版本呈现 |
| 任务结果页 | 7 | 2 | 3 | 2 | 1 | 右侧检查面板；内容与操作顺序；顶栏与 Logo |
| 版本对比 | 6 | 2 | 2 | 2 | 2 | 对比卡片组织；新增内容底色；顶栏与 Logo |
| 知识库列表 | 6 | 0 | 3 | 3 | 2 | 顶栏与 Logo；筛选与说明层次；表格与容器 |
| 待审队列 | 5 | 0 | 2 | 3 | 1 | 顶栏与 Logo；说明层次；导航密度与顺序 |
| 风险提示规则 | 6 | 0 | 4 | 2 | 1 | 顶栏与 Logo；筛选组织；说明与操作 |
| 爆款结构分析 | 3 | 0 | 2 | 1 | 1 | 顶栏与 Logo；筛选骨架；导航密度与顺序 |
| 评测运行 | 3 | 0 | 2 | 1 | 1 | 顶栏与 Logo；筛选骨架；导航密度与顺序 |
| 品牌与切换 | 6 | 0 | 4 | 2 | 1 | 顶栏与 Logo；左右比例；成员呈现 |
| 商品管理 | 6 | 1 | 2 | 3 | 1 | 列表形态；顶栏与 Logo；来源与状态 |
| 品牌档案 | 6 | 1 | 3 | 2 | 1 | 详情分组；顶栏与 Logo；左右比例 |
| 用户设置 | 6 | 1 | 3 | 2 | 2 | 内容布局；顶栏与 Logo；页签 |
| 403 权限页 | 5 | 0 | 3 | 2 | 1 | 顶栏与 Logo；错误内容容器；标题 |
| 404 资源页 | 5 | 0 | 3 | 2 | 1 | 顶栏与 Logo；错误内容容器；标题 |

可比页面共 89 条跨页观察：高 9、中 46、低 34；另有 D 20 条。爆款与评测仅按仓库压缩 PNG 比页面骨架，未测样式；独立版本历史仅有行内历史参考，均属于部分可比。请按后文公共样式去重后估工，不把这个总数当独立问题数量。

本轮分组：13 个原始 HTML 对应页面、2 个仅有仓库 PNG 的骨架目测页面、1 个仅有行内模式参考的独立版本页；无对应设计稿 0 个。D 单独计数，不进入 A/B/C 总数。

## 每页明细

### 生成工作台

设计：`rednotesearch_5`。

前端：`/generate`；代码：`frontend/src/routes/_layout/generate.tsx`。并排图：[`generate-gap.png`](visual-gap/generate-gap.png)，94,541 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 场景选择 | 六张卡片、32px 彩色图标块和模板版本 | 一个原生下拉；没有卡片图标块 | C | 高 | 页面层 |
| 主栅格 | 表单与右侧竖向进度分栏；表单外卡片约 643px | 表单铺满内容区；商品与场景在同一行。当前为空表单，进度栏有无不计缺陷，仅比较表单分栏 | C | 高 | 页面层 |
| 控件密度 | 商品下拉高 44px，风格输入高 40px，圆角 8px | 下拉与输入高 36px，圆角 6px | B | 中 | 组件层+页面层 |
| 风格与必含词 | 风格区嵌在白色大卡片中；必含词用标签颗粒 | 风格独立带边框卡片；必含词是多行文本域 | C | 中 | 页面层 |
| 文字与操作 | “任务简述（选填）”“必含词”“生成” | “创作要求”“必须包含的词”“创建并开始生成”及“仅创建，稍后添加资料” | C | 低 | 页面层 |
| 边框 | 稿中下拉/输入以低色阶填充为主 | 加深输入边框 #80849a；为既定可辨识性决定，不计缺陷 | D | 低 | token层 |

### 任务列表

设计：`rednotesearch_27`。

前端：`/tasks`；代码：`frontend/src/routes/_layout/tasks/index.tsx`。并排图：[`history-gap.png`](visual-gap/history-gap.png)，74,404 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 列顺序与内容 | 创建时间、商品、场景、状态、最新版本、操作 | 商品、场景、状态、创建时间、操作；没有最新版本列 | C | 中 | 页面层 |
| 历史展开方式 | 同表格内展开版本历史 | “查看”进入独立任务详情页 | C | 中 | 页面层 |
| 表格密度 | 表头 12px、700，左右内边距 16px | 表头 12px、600，高 44px（设计 40.5px），竖向内边距为 0 | B | 中 | 组件层 |
| 标题字重 | 24px / 600 | 24px / 700 | B | 低 | 页面层 |
| 页头 | 副标题较短；筛选下拉在页头下方 | 多一句进入版本对比的说明，并有“新建任务”入口 | C | 低 | 页面层 |

### 独立任务版本历史

设计：`rednotesearch_27`（只有表格内展开历史，没有独立详情页）。

前端：`/tasks/:taskId`；代码：`frontend/src/routes/_layout/tasks/$taskId/index.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 信息架构 | 参考稿只有任务表格内的版本展开行，无独立详情页 | 独立详情含任务标题、元数据、三阶段进度和版本卡片行 | C | 中 | 页面层 |
| 版本呈现 | 版本号/状态/时间/操作表格 | 每版一行，显示来源、标题、时间、状态与“打开” | C | 中 | 页面层 |
| 对比入口 | 行内版本可选；设计不含本独立页完整对应 | 左右版本下拉放在版本列表标题旁 | C | 低 | 页面层 |

### 任务结果页

设计：`rednotesearch_38`。

前端：`/tasks/:taskId/versions/:versionId`；代码：`frontend/src/routes/_layout/tasks/$taskId/versions/$versionId.tsx`。并排图：[`result-gap.png`](visual-gap/result-gap.png)，139,686 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 右侧检查面板 | 一个面板内用约束/证据/风险页签切换 | “下一步”、字数、事实、风险四个纵向独立区块 | C | 高 | 页面层 |
| 内容与操作顺序 | 标题→正文→标签→封面；复制操作在页顶 | 标题→封面→正文；复制区在左栏下方，含四个只读文本框 | C | 高 | 页面层 |
| 内容卡片 | 24px 内边距，淡边框（#c3c6d7 / 40%）和细阴影 | 16px 内边距，实色边框 #c3c6d7，无可见阴影 | B | 中 | 页面层+token层 |
| 复制区域体量 | 页顶小按钮组；正文与标签保持内容卡片 | 额外复制区含 Markdown 全文，左栏因此明显更长 | C | 中 | 页面层 |
| 标题与文字 | “标题候选”“正文内容”“推荐标签”“封面文案候选” | “候选标题”“正文”“话题”“封面文字候选”；页头为版次与来源 | C | 低 | 页面层 |

### 版本对比

设计：`rednotesearch_43`。

前端：`/tasks/:taskId/compare`；代码：`frontend/src/routes/_layout/tasks/$taskId/compare.tsx`。并排图：[`compare-gap.png`](visual-gap/compare-gap.png)，111,034 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 对比卡片组织 | 每个版本一整张卡片，卡片内从标题到正文、标签、封面 | 每个字段独立横向区块，区块内部再分左右两列 | C | 高 | 页面层 |
| 新增内容底色 | 浅绿色新增标记，文字仍可辨认 | 右侧新增行使用 bg-tone-ok，即深绿 #166534，文字仍为深色 | B | 高 | 页面层 |
| 差异标记 | 词段级删除线和局部底色突出 | 本次看到整行块状红/绿背景，缺少设计中的局部删除线效果 | C | 中 | 页面层 |
| 标题排版 | 24px / 600，实测 line-height 20px | 24px / 700，line-height 32px | B | 低 | 页面层 |
| 规范冲突 | 原始 HTML 新增标记是浅绿 | 仓库 task-history/spec.md 要求新增用浅蓝；后续以 spec 决策，不照抄旧绿稿 | D | 低 | 页面层 |

### 知识库列表

设计：`rednotesearch_37`。

前端：`/knowledge`；代码：`frontend/src/components/Knowledge/DocumentList.tsx`。并排图：[`knowledge-gap.png`](visual-gap/knowledge-gap.png)，92,924 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 筛选与说明层次 | 页头后有浅蓝说明条；筛选为独立白色低阴影条 | 说明在副标题；两个原生下拉和“清除筛选”直接排在背景上 | C | 中 | 页面层 |
| 表格与容器 | 淡阴影、低对比度分隔 | 实线外框、实线分隔、无可见阴影 | B | 中 | 组件层+页面层 |
| 状态徽标 | 示例徽标含不同填充/留白处理 | 复用 StatusBadge，胶囊形、较紧的统一内边距 | B | 低 | 组件层 |
| 操作与文字 | “上传知识库资料”；筛选强调当前资料状态 | “上传资料”；副标题强调当前版本与检索条件 | C | 低 | 页面层 |
| 版本和文件名 | 原图存在独立版本信息和文件名式标题 | main 已决定标题不带扩展名、版本放标题下（#111/#114），不建议恢复旧列 | D | 低 | 页面层 |

只核对已入库资料的列表。上传弹窗、审核抽屉、解析失败/超长文件等状态没有操作或测量。

### 待审队列

设计：`rednotesearch_52`。

前端：`/knowledge/review`；代码：`frontend/src/routes/_layout/knowledge/review.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 说明层次 | 独立浅蓝“资料生效规则”提示条 | 说明放在标题下方的普通副标题 | C | 中 | 页面层 |
| 页头与筛选 | “待审队列”加数量徽标 | “待审队列与审核”，并有类型下拉和“清除筛选” | C | 低 | 页面层 |
| 返回入口 | 面包屑体现知识库→待审队列 | 右上“返回资料列表”链接 | C | 低 | 页面层 |

状态边界：本次前端为空列表，设计有演示数据行。行数、缺少演示行、未出现的行内按钮均不计差异；有数据时的完整表格/审核内容未验证。

### 风险提示规则

设计：`rednotesearch_16`。

前端：`/compliance/rules`；代码：`frontend/src/routes/_layout/compliance/rules.tsx`。并排图：[`rules-gap.png`](visual-gap/rules-gap.png)，123,005 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 筛选组织 | 白卡内层级/类型横向数量标签，带搜索/筛选组 | 全局/品牌按钮组，层级/类型/严重度原生下拉 | C | 中 | 页面层 |
| 说明与操作 | 独立蓝色操作提示条；导入等集中在页头 | 副标题和普通说明段；四个操作按钮在右上 | C | 中 | 页面层 |
| 局部壳尺寸 | 此页 HTML 侧栏 200px，标题 x=232px | 当前公共侧栏 256px，标题 x=288px | A | 中 | 组件层 |
| 名称 | “合规规则维护”“合规规则” | “风险提示规则”；只记录文案，不建议回退弱化风险提示的说明 | C | 低 | 页面层 |

状态边界：本次前端为空列表，设计有演示数据行。行数、缺少演示行、未出现的行内按钮均不计差异；有数据时的完整表格/审核内容未验证。

### 爆款结构分析

设计：仓库压缩 PNG `docs/design/viral-analysis/01-sample-list-and-add.png`。**无 code.html，未做样式实测**；仅目测页头、筛选与空状态骨架。

前端：`/viral-samples`；代码：`frontend/src/routes/_layout/viral-samples/index.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 字体与图标 | 原始 HTML 的公共替代决定见上文；本页 PNG 字体/图标库未实测 | 系统字体栈、lucide（来自代码）；本页不据 PNG 断言字体差异 | D | 低 | token层+组件层 |
| 筛选骨架 | 排序位于独立白色筛选条（仅目测） | 排序下拉直接放在页面背景上 | C | 中 | 页面层 |
| 页头文字 | 爆款结构分析 · 样本；简短结构提取说明 | 爆款结构分析；副标题另说明授权边界与检索范围 | C | 低 | 页面层 |

数据行、表头在当前空列表中未呈现，标为 **未验证（库中无数据）**；不把空状态替代演示数据行算作缺陷。爆款卡片行已由 #112/spec 决定，不要求恢复旧图表格。

### 评测运行

设计：仓库压缩 PNG `docs/design/evaluation/03-run-list-and-run-detail.png`。**无 code.html，未做样式实测**；仅目测页头、筛选与空状态骨架。

前端：`/evaluation/runs`；代码：`frontend/src/routes/_layout/evaluation/runs/index.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 字体与图标 | 原始 HTML 的公共替代决定见上文；本页 PNG 字体/图标库未实测 | 系统字体栈、lucide（来自代码）；本页不据 PNG 断言字体差异 | D | 低 | token层+组件层 |
| 筛选骨架 | 带标签的评测集下拉在独立白色筛选条内（仅目测） | 下拉直接放在页面背景上，当前空列表居中提示 | C | 中 | 页面层 |
| 页头操作与文字 | 副标题说明异步运行状态；图中无新建按钮 | 副标题说明固定版本与指标；右上有新建运行按钮（未点击） | C | 低 | 页面层 |

数据行、表头在当前空列表中未呈现，标为 **未验证（库中无数据）**；不把空状态替代演示数据行算作缺陷。

### 品牌与切换

设计：`rednotesearch_28`。

前端：`/brands`；代码：`frontend/src/routes/_layout/brands.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 左右比例 | 品牌列表 5/12、成员区 7/12 | 两个接近等宽的栏 | C | 中 | 页面层 |
| 成员呈现 | 姓名、邮箱、角色、操作表格 | 成员列表行，姓名和邮箱上下排，角色下拉在同一行 | C | 中 | 页面层 |
| 卡片 | 24px 内边距、细阴影、品牌行含明显标记 | 列表/成员卡片 16px 内边距、实线边框、无可见阴影 | B | 中 | 页面层 |
| 页头字重 | 24px / 600 | 24px / 700 | B | 低 | 页面层 |

### 商品管理

设计：`rednotesearch_2`。

前端：`/products`；代码：`frontend/src/routes/_layout/products.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 列表形态 | 商品/产品线/类目/来源/状态/操作表格 | 每商品一张卡片行，信息上下叠放 | C | 高 | 页面层 |
| 来源与状态 | 有来源数在表格列，状态单独徽标 | 有来源数作为第二行文字，状态并入描述行 | C | 中 | 页面层 |
| 标题字重 | 24px / 600 | 24px / 700 | B | 低 | 页面层 |
| 入口文字 | “编辑”“归档” | 另加“查看”；页头为“新增商品” | C | 低 | 页面层 |

仅对比列表/只读详情，未在前端打开编辑、新建或保存；设计侧只关闭预置抽屉。不能据此评价前端编辑抽屉的还原程度。

### 品牌档案

设计：`rednotesearch_33`。

前端：`/voice-profile`；代码：`frontend/src/routes/_layout/voice-profile.tsx`。本页仅记录文字差异，未输出并排图。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 详情分组 | 语气/优先词/禁用词以彩色标签颗粒和语义分区呈现 | 关键词/优先词/禁用词均为竖向纯文字列表 | C | 高 | 页面层 |
| 左右比例 | 版本栏约 1/3，详情约 2/3 | 版本栏与详情接近等宽 | C | 中 | 页面层 |
| 详情层级 | 详情标题 20px / 700，分组有色条/图标/留白 | 详情标题 16px / 600，小标题与正文紧凑叠排 | B | 中 | 页面层 |
| 页头动作 | “基于当前版本新建版本”在详情区 | “基于所选版本新建”在页头 | C | 低 | 页面层 |

仅对比列表/只读详情，未在前端打开编辑、新建或保存；设计侧只关闭预置抽屉。不能据此评价前端编辑抽屉的还原程度。

### 用户设置

设计：`rednotesearch_21`。

前端：`/settings`；代码：`frontend/src/routes/_layout/settings.tsx`。并排图：[`settings-gap.png`](visual-gap/settings-gap.png)，65,701 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 内容布局 | 基本资料与密码两个并列卡片；顶部还有页签示意 | 页签切换单卡片；当前只显示“我的资料” | C | 高 | 页面层 |
| 页签 | 16px 图标文字和底部蓝色横线 | 14px 胶囊页签，选中项使用浅色底和细阴影 | B | 中 | 组件层 |
| 表单卡片 | 24px 内边距、无外边框、细阴影 | 20px 内边距、1px 实线外框、无可见阴影 | B | 中 | 页面层 |
| 文案 | “基本资料”“保存”“管理当前账户的基础名片与登录鉴权凭证” | “我的资料”“保存资料”“管理你的个人资料与登录密码。” | C | 低 | 页面层 |
| 按钮渐变 | 此页 HTML 含 #3B82F6→#2563EB 渐变 | 当前实心 #2563eb；token spec 明定实心，不建议仅按这页恢复渐变 | D | 低 | 组件层 |

### 403 权限页

设计：`403_rednotesearch_1`。

前端：`/evaluation/runs（既有编辑者）`；代码：`frontend/src/components/Common/ForbiddenPage.tsx`。并排图：[`403-gap.png`](visual-gap/403-gap.png)，45,799 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 错误内容容器 | 中心白色卡片、较大装饰图标与主次返回入口 | 内容直接放页面背景，无白卡；一个边框返回入口 | C | 中 | 组件层 |
| 标题 | 24px / 600 | 20px / 600 | B | 中 | 组件层 |
| 文字 | “无权访问该品牌或操作” | “没有权限查看这个页面”；本次入口为评测页，未把场景文字区别当功能缺陷 | C | 低 | 组件层 |

### 404 资源页

设计：`404_rednotesearch`。

前端：`/tasks/:otherBrandTaskId（既有编辑者）`；代码：`frontend/src/components/Common/ForbiddenPage.tsx`。并排图：[`404-gap.png`](visual-gap/404-gap.png)，43,660 字节。

| 维度 | 设计稿怎样 | 我们怎样 | 类别 | 影响 | 来源层级 |
|---|---|---|---|---|---|
| 顶栏与 Logo | Logo 与品牌切换器同在全宽顶栏 | Logo 在侧栏顶部；顶栏从侧栏右侧开始 | A | 中 | 组件层 |
| 导航密度与顺序 | 常见侧栏项高 34px，知识库在质量与评测之前 | 常见侧栏项高 32px；质量与评测在知识库之前，并有增强/外观入口 | A | 低 | 组件层 |
| 字体与图标 | Plus Jakarta Sans、Material Symbols | 系统字体栈、lucide；已决定的替代，不计缺陷 | D | 低 | token层+组件层 |
| 错误内容容器 | 中心白卡、搜索插画式图标、较完整的返回说明 | 直接在背景上排锁定高度的错误内容、单一返回入口 | C | 中 | 组件层 |
| 标题 | 24px / 600 | 20px / 600 | B | 中 | 组件层 |
| 文字 | “资源不存在或无权访问” | “没有找到这个内容”；下方直写不区分不存在和权限 | C | 低 | 组件层 |

## 1280×900 补测与额外 404

| 页面 | 实际观察 | 证据 |
|---|---|---|
| 工作台 | 页面仍是商品/场景双下拉加纵向表单；没有设计的场景卡与右侧竖向进度。没有将长页面的纵向滚动算作溢出。 | [generate-1280-gap.png](visual-gap/generate-1280-gap.png) |
| 结果页 | 仍是内容/检查两栏；当前两栏及复制文本域可见，未看到横向挤出视口的内容。未验证非空证据/风险长内容。 | [result-1280-gap.png](visual-gap/result-1280-gap.png) |
| 未知路由 404 | 实际看过大号 404 与返回按钮，无业务壳；无对应独立稿，不计作资源 404 缺陷。 | 仅文字记录，不出图 |

## 样式实测对比

以下均为浏览器原始 DOM 的 `getComputedStyle` 取值，非 Tailwind 类名换算。Tailwind CDN/字体样式在设计页可加载；CSS 字体栈不等于每个汉字实际所用字形。DF=`"Plus Jakarta Sans"`；SF=`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`。字体栈差别均属 D。

`border-width/style/color` 保留四边 shorthand；例如 `0px 0px 1px` 表示底边 1px。`normal` 是浏览器返回值，不当成 0。阴影仅去掉纯透明的零尺寸占位层后比较，其他值不做视觉近似；未测元素写“无对应元素”，不填 0。高度是本次内容状态的高度，卡片高度不用于判断还原程度。

### 公共元素表（每类各取一次）

其它页面复用同类元素时记“同上”，本轮不逐页重复实测表。卡片取设计表单容器与前端风格卡作容器样式比较，内容高度不计缺陷。主按钮均为新建动作；次按钮为设计复检与前端返回任务，只比较样式。

| 元素 | 属性 | 设计稿实测值 | 前端实测值 | 是否相同 | 来源层级 / 前端文件位置 |
|---|---|---|---|---|---|
| 工作台标题 | font-family | DF | SF | 否（D） | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | font-size | 24px | 24px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | font-weight | 700 | 700 | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | line-height | 32px | 32px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | background-color | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | background-image | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | border-width | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | border-style | solid | solid | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | border-radius | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | box-shadow | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | padding | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | height | 32px | 32px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台标题 | gap | normal | normal | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:752 |
| 工作台副标题 | font-family | DF | SF | 否（D） | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | font-size | 14px | 14px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | font-weight | 400 | 400 | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | line-height | 20px | 20px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | color | rgb(80, 95, 118) | rgb(95, 99, 114) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | background-color | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | background-image | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | border-width | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | border-style | solid | solid | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | border-radius | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | box-shadow | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | padding | 0px | 0px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | height | 20px | 20px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 工作台副标题 | gap | normal | normal | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:753 |
| 表单/风格卡片及内边距 | font-family | DF | SF | 否（D） | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | font-size | 14px | 16px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | font-weight | 400 | 400 | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | line-height | 20px | 24px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | background-color | rgb(255, 255, 255) | rgb(255, 255, 255) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | background-image | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | border-width | 0px | 1px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | border-style | solid | solid | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | border-radius | 12px | 12px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | box-shadow | rgba(0, 0, 0, 0.05) 0px 1px 2px 0px | none | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | padding | 24px | 16px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | height | 961px | 146px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 表单/风格卡片及内边距 | gap | normal | normal | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:315 |
| 文本输入框（语气） | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | font-size | 14px | 14px | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | font-weight | 400 | 400 | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | line-height | 20px | 20px | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | background-color | rgb(240, 243, 255) | rgba(0, 0, 0, 0) | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | background-image | none | none | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | border-width | 0px | 1px | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | border-color | rgb(229, 231, 235) | rgb(128, 132, 154) | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | border-radius | 8px | 6px | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | box-shadow | none | rgba(0, 0, 0, 0.05) 0px 1px 2px 0px | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | padding | 0px 12px | 4px 12px | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | height | 40px | 36px | 否 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 文本输入框（语气） | gap | normal | normal | 是 | 组件层；frontend/src/components/ui/input.tsx:11 |
| 商品下拉 | font-family | DF | SF | 否（D） | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | font-size | 14px | 14px | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | font-weight | 400 | 400 | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | line-height | 20px | normal | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | background-color | rgb(240, 243, 255) | rgb(249, 249, 255) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | background-image | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | border-width | 0px | 1px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | border-style | solid | solid | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | border-color | rgb(229, 231, 235) | rgb(128, 132, 154) | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | border-radius | 8px | 6px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | box-shadow | none | none | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | padding | 0px 40px 0px 14px | 0px 12px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | height | 44px | 36px | 否 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 商品下拉 | gap | normal | normal | 是 | 页面层；frontend/src/routes/_layout/generate.tsx:71 |
| 创作要求文本域 | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | font-size | 14px | 14px | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | font-weight | 400 | 400 | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | line-height | 20px | 20px | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | background-color | rgb(240, 243, 255) | rgb(240, 243, 255) | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | background-image | none | none | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | border-width | 0px | 1px | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | border-color | rgb(229, 231, 235) | rgb(128, 132, 154) | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | border-radius | 8px | 6px | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | box-shadow | none | rgba(0, 0, 0, 0.05) 0px 1px 2px 0px | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | padding | 12px | 8px 12px | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | height | 84px | 98px | 否 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 创作要求文本域 | gap | normal | normal | 是 | 组件层；frontend/src/components/ui/textarea.tsx:10 |
| 侧栏普通项 | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | font-size | 14px | 14px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | font-weight | 400 | 400 | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | line-height | 20px | 20px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | color | rgb(67, 70, 85) | rgb(17, 28, 45) | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | background-color | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | background-image | none | none | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | border-width | 0px | 0px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | border-radius | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | box-shadow | none | none | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | padding | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | height | 34px | 32px | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏普通项 | gap | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | font-size | 14px | 14px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | font-weight | 600 | 500 | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | line-height | 20px | 20px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | color | rgb(37, 99, 235) | rgb(17, 28, 45) | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | background-color | rgb(239, 244, 255) | rgb(239, 244, 255) | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | background-image | none | none | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | border-width | 0px | 0px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | border-radius | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | box-shadow | none | none | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | padding | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | height | 34px | 32px | 否 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 侧栏选中项 | gap | 8px | 8px | 是 | 组件层；frontend/src/components/ui/sidebar.tsx:496 |
| 顶栏 | font-family | DF | SF | 否（D） | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | font-size | 14px | 16px | 否 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | font-weight | 400 | 400 | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | line-height | 20px | 24px | 否 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | background-color | rgb(255, 255, 255) | rgb(255, 255, 255) | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | background-image | none | none | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | border-width | 0px 0px 1px | 0px 0px 1px | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | border-style | solid | solid | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | border-color | rgba(195, 198, 215, 0.3) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | border-radius | 0px | 0px | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | box-shadow | rgba(0, 0, 0, 0.02) 0px 1px 8px 0px | rgba(0, 0, 0, 0.02) 0px 1px 8px 0px | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | padding | 0px 32px | 0px 16px | 否 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | height | 64px | 64px | 是 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 顶栏 | gap | normal | 12px | 否 | 组件层；frontend/src/routes/_layout.tsx:36 |
| 主按钮（档案新建） | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | font-size | 13px | 14px | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | font-weight | 600 | 500 | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | line-height | 18px | 20px | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | color | rgb(255, 255, 255) | rgb(255, 255, 255) | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | background-color | rgb(37, 99, 235) | rgb(37, 99, 235) | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | background-image | none | none | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | border-width | 0px | 0px | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | border-radius | 8px | 6px | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | box-shadow | rgba(37, 99, 235, 0.25) 0px 4px 14px 0px | none | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | padding | 8px 16px | 8px 16px | 是 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | height | 34px | 36px | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 主按钮（档案新建） | gap | 6px | 8px | 否 | 组件层；frontend/src/components/ui/button.tsx:12 |
| 次按钮（结果复检 / 任务返回） | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | font-size | 13px | 14px | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | font-weight | 500 | 500 | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | line-height | 18px | 20px | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | color | rgb(17, 28, 45) | rgb(17, 28, 45) | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | background-color | rgb(255, 255, 255) | rgb(249, 249, 255) | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | background-image | none | none | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | border-width | 1px | 1px | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | border-color | rgba(195, 198, 215, 0.5) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | border-radius | 8px | 6px | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | box-shadow | rgba(0, 0, 0, 0.05) 0px 1px 2px 0px | rgba(0, 0, 0, 0.05) 0px 1px 2px 0px | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | padding | 6px 12px | 0px 12px | 否 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | height | 32px | 32px | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 次按钮（结果复检 / 任务返回） | gap | 6px | 6px | 是 | 组件层；frontend/src/components/ui/button.tsx:15 |
| 状态徽标（可复制） | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | font-size | 12px | 12px | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | font-weight | 500 | 500 | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | line-height | 16px | 16px | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | color | rgb(22, 101, 52) | rgb(22, 101, 52) | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | background-color | rgb(220, 252, 231) | rgb(220, 252, 231) | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | background-image | none | none | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | border-width | 0px | 0px | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | border-style | solid | solid | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | border-radius | 9999px | 1.67772e+07px | 否 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | box-shadow | none | none | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | padding | 4px 10px | 2px 8px | 否 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | height | 24px | 20px | 否 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 状态徽标（可复制） | gap | 4px | 4px | 是 | 组件层；frontend/src/components/Common/StatusBadge.tsx:14 |
| 表格表头 | font-family | DF | SF | 否（D） | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | font-size | 12px | 12px | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | font-weight | 700 | 600 | 否 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | line-height | 16px | 16px | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | color | rgb(67, 70, 85) | rgb(95, 99, 114) | 否 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | background-color | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | background-image | none | none | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | border-width | 0px | 0px | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | border-style | solid | solid | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | border-color | rgb(229, 231, 235) | rgb(195, 198, 215) | 否 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | border-radius | 0px | 0px | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | box-shadow | none | none | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | padding | 12px 16px | 0px 16px | 否 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | height | 40.5px | 44px | 否 | 组件层；frontend/src/components/ui/table.tsx:20 |
| 表格表头 | gap | normal | normal | 是 | 组件层；frontend/src/components/ui/table.tsx:20 |

## 新增内容深绿底色：已查实为缺陷

页面：`/tasks/:taskId/compare`，本机既有任务第 1→2 版的右侧新增段“本地复跑演示”“演示用假模型。”和封面文字。组件：`frontend/src/routes/_layout/tasks/$taskId/compare.tsx` 的字段对比组件，右侧分支 `className=... bg-tone-ok`（约第 46–47 行）；背景来自 `frontend/src/index.css` 的 `--tone-ok: #166534`，文字继承 `--foreground: #111c2d`。

| 元素 | getComputedStyle 背景色 | getComputedStyle 文字色 | 类名 / 来源 |
|---|---|---|---|
| 前端右侧新增段 | `rgb(22, 101, 52)`（#166534） | `rgb(17, 28, 45)`（#111c2d） | `bg-tone-ok`；继承深色文字 |
| 原始设计同类新增词段“工位上的清冷感” | `rgb(220, 252, 231)`（#dcfce7） | `rgb(22, 101, 52)`（#166534） | `bg-[#dcfce7] text-[#166534] px-1 rounded` |

结论：**缺陷，非已知有意不同（B，高；页面层）**。前端把设计中用作文字的深绿 token 用作背景，且没有浅色前景覆盖；现有 `docs/design/task-history/spec.md` 又明确要求新增内容采用浅蓝标记，两份依据均不支持当前深绿底。后续应由 A 确定采用 spec 的浅蓝方案；不在本 PR 改色，也没有以“已测对比度”作为结论。此项已包含在版本对比差异计数内，不重复加总。

## 五个数值抽查

只做以下五项复读，未全量复核。报告数值与本次浏览器复读相符：

| 抽查项 | 本次值 | 报告/采样值 | 结果 |
|---|---|---|---|
| 语气输入高度 | `36px` | `36px` | 相符 |
| 风格卡片 padding | `16px` | `16px` | 相符 |
| 档案页主按钮阴影 | `none` | `none` | 相符 |
| 侧栏白底内层宽度 | `255px` | `255px` | 相符 |
| 工作台标题字号 | `24px` | `24px` | 相符 |

侧栏白底内层 255px 加外层 1px 边界占位 256px，两个口径不混写。

## 公共样式：去重后的改动位置与估工

以下是建议量级而非执行承诺。影响页数限本次 16 个已查看页面/状态；字体与图标、输入边框不纳入必须修复。A 负责公共壳、Common、token，B 不能直接改这些文件。本次提交没有实施任何一项。

| 层级 | 项目 | 建议位置 | 本轮可见影响页数 | 估计改动量 | 组件结论 |
|---|---|---|---:|---|---|
| token | 控件圆角映射 | frontend/src/index.css（--radius 及映射） | 16 | 5–15 行，但改 --radius 会同时波及胶囊/卡片，需逐组件校验 | 只改 token 就能对齐（仅同一圆角变量覆盖的局部；不能对齐高度/布局） |
| token | 辅助文字与边框颜色 | frontend/src/index.css | 16 | 0 行建议；#5f6372 与 #80849a 属已决定的加深 | 只改 token 就能对齐颜色，但建议保留当前取值 |
| 组件 | 主/次 Button 高度、字号、发光阴影 | frontend/src/components/ui/button.tsx | 16 | 10–25 行；依据页面变体处理，不能把所有按钮变渐变 | 要改组件 |
| 组件 | Input 填充底/40px 高度/圆角 | frontend/src/components/ui/input.tsx | 2 | 5–15 行；保留加深边框；本轮只在工作台和设置实际测到 Input | 要改组件 |
| 组件 | Textarea 内边距与圆角 | frontend/src/components/ui/textarea.tsx | 2 | 5–15 行；页面 rows 另调 | 要改组件 |
| 组件 | 表头字重/字号、行与分隔线 | frontend/src/components/ui/table.tsx | 2 | 10–25 行；本轮有数据表为任务列表和知识库 | 要改组件 |
| 组件 | StatusBadge 留白和色调 | frontend/src/components/Common/StatusBadge.tsx | 5 | 5–15 行；本轮任务列表、详情、结果、知识库、档案看过状态 | 要改组件；不把设计旧版绿色支持标签带回来 |
| 组件 | 顶栏 Logo/侧栏组织/用户区 | frontend/src/routes/_layout.tsx；components/Sidebar/AppSidebar.tsx、Main.tsx、User.tsx、BrandSwitcher.tsx；components/ui/sidebar.tsx | 16 | 60–140 行；菜单角色差异不计缺陷，Logo 移位不能只改色值 | 要改组件 |

实测相近、无需为追稿改动的部分：常见页面顶栏均 64px；常见侧栏外层占位均 256px（前端白底内层 255px；规则页稿是例外）；工作台标题均 24/32px、700，#111c2d；选中侧栏底色均 #eff4ff；工作台文本域底色均 #f0f3ff；多数内容卡片圆角均 12px。存在这些相同取值，不等于整页已完成视觉验收。

## 我们的判断

作为本轮设计对比助手，建议先处理：

1. **先修版本对比的深绿底色可读性。** 本轮直接看到右侧新增块是 #166534 深底配深字；它不需要等待全局换肤，且 task-history spec 要求的新增色本来是浅蓝。这里仅报告观感，未运行无障碍对比度仪器，不宣称检查通过。
2. **如果目标是让首屏更接近稿，优先决定工作台场景卡与表单分栏、结果检查面板。** 生成中进度栏是否缺失需同状态再核，本轮不作缺失结论。这些是明显的结构差异；单改 token 不能得到设计中的信息层级。应先由 A 确认交互，再动实现，避免为了截图破坏已实现的流程。
3. **再统一控件与卡片密度。** 36px 对 40/44px、6px 对 8px、16px 对 24px、实边框对淡边框/阴影，是跨页重复差异，组件与页面两层都要处理。先做代表组件再复核完整页面，勿直接把 --radius 全局调大就算结束。
4. **壳的 Logo 位置与侧栏顺序应由 A 集中处理。** 它影响全部页面，但当前并不是功能缺失；若时间有限，可在核心流程布局之后修。

可以保留或先不修：系统字体与 lucide；加深的输入边框；token spec 已决定的实心主按钮；知识库无扩展名标题和标题下版本信息；必要的长说明、只读复制文本框和人工判断说明。设计的假数据、过期绿色“支持”徽标及不同页面互相矛盾的渐变/圆角，不应直接恢复。商品卡片行、设置单页签等没有在现有记录中找到明确的视觉取舍确认，列为待 A 决定，不擅自标 D。

## 未验证

- 没有验证全部 59 张稿的每种状态；只覆盖本表列出的原始目录。没有统计像素差异率，不声称给出“还原百分比”。
- 待审队列有数据时的表格与审核详情；规则有数据时的规则行/详情；爆款有样本/结构详情；评测有运行数据的报告页，均未验证。未运行模型补数据。
- 上传、编辑、新建、删除、确认、复制、导出等写入/业务操作本轮未执行；未比较这些弹窗/抽屉的交互和错误状态。未测生成中/慢模型、非空事实与风险长文、移动端、折叠侧栏、暗色、其他浏览器或操作系统。
- 403 截图来自评测页角色禁止访问；没有实操待审页的授权变更。未知路由 404 仅作文字记录，不代替资源 404。
- 未用真实客户库或客户资料，未读最终演示库真实模型结果。当前数据均为假嵌入演示资料与此前本机走查记录。
- Google 字体按 CSS 栈记录，没有逐字形追踪实际回退字体；设计按钮的悬停/动画状态不作为稳定基线。源稿内允许空/错误演示的区域不计缺陷。

## 本轮实际执行的主要命令与检查

```text
git fetch upstream main  # 75 秒连接超时，未声称 fetch 成功
# GitHub API 核实 main 后下载固定提交，不使用浮动 main ZIP
curl --fail --location --max-time 90 https://codeload.github.com/c4002159/RedNoteSearch/zip/7ffd043acc7fd7816a9223b3e24b67dc3958d38d -o work/visual-main.zip
VITE_API_URL=http://127.0.0.1:8010 bun run --cwd <固定快照>/frontend build
LLM_MODE=demo_fake FASTAPI_ENV=development FRONTEND_HOST=http://127.0.0.1:8010 uvicorn app.main:app --host 127.0.0.1 --port 8010
python3 -m http.server 8020 --bind 127.0.0.1 --directory <指定设计文件夹>
# 浏览器：固定视口；DOM snapshot；getComputedStyle；全页截图
# Python/Pillow：等比并排、PNG 调色板压缩、核实每张 <=500000 字节
```

构建包含 TypeScript 构建检查且成功。并排图使用调色板压缩，仅作布局目测，颜色数值以公共元素表的 DOM 实测为准。零宽边框的颜色差异和内容驱动的尺寸差异不自动计缺陷。项目依赖在前一轮已安装，本轮只复用；没有新增依赖、修改锁文件、CI、前端源文件或后端实现。提交前实际检查：`bunx tsc --noEmit`、`bash scripts/check-forbidden-wording.sh`、`git diff --cached --check` 均成功。`bunx biome check --write --no-errors-on-unmatched docs/design/VISUAL_GAP.md` 成功退出但 Checked 0 files（Markdown 不受支持），没有声称格式化了 Markdown。另检查本报告禁用措辞、链接、图片格式/大小与暂存文件白名单；不把视觉判断当成功能回归结果。

## 图片清单与大小

| 图片 | 字节 |
|---|---:|
| [generate-gap.png](visual-gap/generate-gap.png) | 94,541 |
| [history-gap.png](visual-gap/history-gap.png) | 74,404 |
| [result-gap.png](visual-gap/result-gap.png) | 139,686 |
| [compare-gap.png](visual-gap/compare-gap.png) | 111,034 |
| [knowledge-gap.png](visual-gap/knowledge-gap.png) | 92,924 |
| [rules-gap.png](visual-gap/rules-gap.png) | 123,005 |
| [settings-gap.png](visual-gap/settings-gap.png) | 65,701 |
| [403-gap.png](visual-gap/403-gap.png) | 45,799 |
| [404-gap.png](visual-gap/404-gap.png) | 43,660 |
| [generate-1280-gap.png](visual-gap/generate-1280-gap.png) | 115,426 |
| [result-1280-gap.png](visual-gap/result-1280-gap.png) | 170,763 |
