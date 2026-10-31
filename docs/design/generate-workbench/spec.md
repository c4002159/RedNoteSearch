# 生成工作台

- 对应需求：F4、F5（场景模板与风格、结构化生成）、F12（任务文件输入）；#9（工作台）；TC-F07
- 路由：`/generate`；创建任务后地址带上任务 id：`/generate?task=<任务 id>`（见下“路由与刷新恢复”）
- 角色与权限：品牌成员（editor、admin）；任务资料的上传与列表同样只限任务所属品牌的成员
- 负责人：B（设计与实现）；A 审阅

## 状态清单
| 状态 | 图片 | 说明 |
|---|---|---|
| 填写、上限与禁用提示 | 01-generate-workbench-form.png | 场景、商品、简述（≤2000 字）、必含词（≤20 条）、**粘贴资料（文件名 + 正文，创建时随 `task_materials` 提交）**、风格；“有排队中的任务”入口；文件资料区（创建前锁定）；简述接近上限与超限、必含词超限、粘贴资料超 50000 字、文件名未填、已满 5 份 |
| 任务资料、进度、失败、创建错误、恢复与跳转 | 02-generate-workbench-materials-progress.png | F12 资料区 6 种状态与 7 种错误（含 500）；已创建、生成中、检查中；`model_unavailable`、`invalid_model_output`、409；创建任务时的 503、409（商品已归档）、404（场景已停用）、403；刷新恢复；完成后跳转；自动改写产生新版本 |

## 区域与字段（接口以 `docs/API_CONTRACT.md` 第 5 节为准）
- 场景：`GET /scenarios`（`scene`、`name`、`template_version`）；商品：本品牌未归档商品；风格预设：`GET /brands/{id}/style-presets`，可另存。选项与展示名取自接口或契约枚举，不在设计里写死。
- 风格 `style`：`tone` 自由文本（可空）；`length` 偏短/适中/偏长（`short | medium | long`）；`person` 第一/第二/第三人称（`first | second | third`）；`emoji_density` 很少/适量/较多（`low | medium | high`）；`hashtag_count` 0 到 10，默认 5。
- 上限提示：`brief` ≤2000 字；`required_terms` ≤20 条（去空白去重）；`task_materials` 每份 ≤50000 字、粘贴加文件合计 ≤5 份。
- **禁用词**：任务没有禁用词字段，所以表单里没有禁用词输入框；必含词旁边写“禁用词来自品牌档案和商品的‘禁止宣称’，这里不需要填写”（契约第 5 节：约束检查的禁用词包括品牌档案的禁用词和商品的“禁止宣称”）。
- **粘贴资料（创建时就能提交）**：`POST /tasks` 的 `task_materials`，每份 `filename` + `text`（≤50000 字）；资料只属于这个任务，不进入知识库。**文件上传不能在创建时提交**，要等任务创建（`queued`）后用 `POST /tasks/{id}/materials`。粘贴份数与文件份数合计 ≤5，界面显示“粘贴 N + 文件 M = K / 5 份”。
- 提交按钮（采纳 A 的回答）：主按钮“**创建并开始生成**”，依次调用 `POST /tasks` 与 `POST /tasks/{id}/generate`（带 `Idempotency-Key`）；次按钮“**仅创建，稍后添加资料**”，只调用 `POST /tasks`，之后在资料区上传文件，再点“开始生成”。主按钮的第二步失败时，任务停在 `queued`，地址已带任务 id，显示错误并给“开始生成”重试，不重复创建任务。
- 进度：轮询 `GET /tasks/{id}`；三段由 `flow_status`（`queued`、`generating`、`checking`）决定，`progress.stage`（`retrieving`、`generating`、`evidence`、`compliance`、`rewriting`，或 `null`）只作为当前段下面的小字（检索资料、生成中、核对依据、风险提示、改写中），为 `null` 时不显示小字。只显示阶段，不显示假百分比。
- 失败：以任务的 `last_error` 为准：`model_unavailable`（任务回到原状态，可直接重试）；`invalid_model_output`（任务为 `constraint_failed`，约束未通过）。

### 创建任务时的错误（图 02）
| 响应 | 含义（契约第 5 节） | 界面 |
|---|---|---|
| 503 | 嵌入模型不可用；任务与全部粘贴资料在同一个事务里，什么都没有保存 | “暂时无法创建任务”，填写内容保留，“再试一次”，带请求编号 |
| 409 | 商品已归档 | 提示换商品，刷新商品列表，商品字段标错 |
| 404 | 场景不存在、已停用或属于其他品牌 | 提示换场景，刷新场景列表，场景字段标错 |
| 403 | 不是该品牌成员（品牌 id 在请求体里，先核验成员关系） | 提示切换品牌 |

### 任务文件资料（F12，契约已合并，实现 PR #40 在审）
- 接口：`POST /tasks/{id}/materials`（multipart，一个 `file`）；`GET /tasks/{id}/materials`。列表只显示 `filename`、`char_count`、`excerpt`（前 200 字），不显示全文、不显示哈希。
- 规则：只有 `queued` 的任务才能添加；每任务粘贴加文件合计 ≤5 份；每份解析后 ≤50000 字；PDF、DOCX ≤50 MB，md、txt、csv ≤5 MB；超长提示“大文档请走知识库”；**没有删除或替换**（A 已决定），上传错误后新建任务重来。
- 上传是同步的：请求一直等到解析和嵌入完成才返回，没有“解析中”状态可轮询，也没有后台任务。界面提示“解析大文件可能需要几分钟，请保持本页面打开，直到完成”，不显示假进度。上传期间同一任务的“开始生成”和其他上传会被后端等待，界面同时禁用它们。
- 错误区分显示：`FILE_TOO_LARGE`（`limit_bytes`）、`UNSUPPORTED_FILE_TYPE`（`allowed`）、`PARSE_FAILED`、`MATERIAL_TOO_LONG`（`char_count`、`limit_chars`）、`MATERIAL_LIMIT_EXCEEDED`（`material_count`、`limit_count`）、`INVALID_STATE`（`current_state`）；`503 MODEL_UNAVAILABLE` 时任务仍是 queued，可重试。
- **500 `INTERNAL_ERROR`**：只有请求编号和通用说明。界面提示“先刷新资料列表确认有没有这一份，再决定要不要重传；重复上传可能多出一份”，并提供“刷新资料列表”。
- 错误都带请求编号（可复制）。

## 路由与刷新恢复（TC-F07）
- 创建成功后把地址改为 `/generate?task=<任务 id>`（不新增页面）。刷新或断网重连后，用 `GET /tasks/{id}` 恢复：`queued` 回到资料区（可继续添加、开始生成）；`generating`、`checking` 回到进度条继续轮询；已结束的直接打开结果页；任务不存在或不是成员为 404 整页。
- 没有 `task` 参数的 `/generate` 是空表单；若本品牌有 `queued` 的任务（`GET /tasks?brand_id=&status=queued`），表单上方显示“有 1 个排队中的任务还没有开始生成”和“继续这个任务”入口。这个入口是我加的，A 如不要可去掉。
- 未提交的表单草稿只存在页面里，刷新会丢；是否存本机草稿没有做设计。

## 完成后去向
- `flow_status` 变成 `needs_human_review`、`checks_completed` 或 `constraint_failed`，且 `progress.stage` 为 `null` 或 `done` 时，自动打开 `/tasks/:id/versions/:latest_version_id`（`latest_version_id` 取自 `GET /tasks/{id}`）；几秒没有跳转时给“查看结果”按钮。`constraint_failed` 也打开结果页，页面上写明哪个标题、哪个词没通过。
- 自动改写（有未处理的“必须修改”提示时最多 2 轮）会创建新版本，最新版本会变。工作台等改写结束（`progress.stage` 不再是 `rewriting`）再跳转，打开的就是最终的最新版本；已经在结果页的用户不被强行切换，只在页面顶部提示“这个任务有更新的版本 vN”（见结果页 spec）。

## 交互
- 创建按钮在必填项缺失或超限时禁用，原因写在按钮上方；提交中显示加载并不可再点（对应重复提交保护）。
- 任务已创建（queued）后：资料区解锁，可添加文件资料；“开始生成”随时可点。生成开始后资料区变为只读并说明原因。
- 重复提交返回 409 时显示当前状态并给“刷新状态”。

## 用到的组件与 token
下拉、文本域与字数组件、标签选择、按钮、上传组件、徽标、提示条、阶段进度条、请求编号复制；颜色、字号、间距只用 design-tokens 里的名字；输入框边框用新增的 `input-border`。

## 已决定
1. 上传同步、不轮询、不返回“解析中”；列表只显示文件名、字数、摘录。
2. 任务资料没有删除或替换。
3. 进度三段用 `flow_status`，`progress.stage` 只作小字。
4. 主按钮“创建并开始生成”，次按钮“仅创建，稍后添加资料”（A 的回答）。
5. 只做必含词，不做禁用词输入框；旁边写明禁用词来源。

## 未验证
1. 我没有上传文件，也没有调用任何接口；限额、错误码和 details 字段取自契约文字。
2. 简述“接近上限”的提示阈值（1800 字）是我定的，不是契约规定。
3. 风格预设下拉和“另存为预设”的具体交互按 `GET/POST style-presets` 推断。
4. 图里的文案和资料名都是自编示例，不是客户资料。
5. 粘贴资料 `filename` 的长度上限：契约只写了文件上传的文件名 1 到 300 个码点，`task_materials` 没写；界面暂不显示文件名字数。
6. 跳转条件“`progress.stage` 为 `null` 或 `done`”是我按契约补充说明的推断：自动改写期间任务的 `flow_status` 是否会先短暂变成上一个版本的状态，契约没有写，请 A 确认。
7. “有排队中的任务”入口、`/generate?task=` 的地址形式是我的建议（A 的原话是“建议路由带任务 id，或提供入口”）。

## 与契约或约束不一致的地方
1. 原稿写过“创建任务时不能带资料”，这是错的：粘贴文本在创建时就能提交（`task_materials`）。现在只有**文件上传**要等任务创建之后。
2. 契约没有“取消生成”接口，图中没有取消入口。
3. 主按钮的两步之间没有事务：创建成功但开始生成失败时，任务停在 `queued`。设计按“显示错误并重试第二步”处理；如果希望后端提供一次完成的接口，请 A 回复。
