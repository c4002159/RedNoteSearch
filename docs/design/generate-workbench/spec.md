# 生成工作台

- 对应需求：F4、F5（场景模板与风格、结构化生成）、F12（任务文件输入）；#9（工作台）；TC-F07
- 路由：`/generate`
- 角色与权限：品牌成员（editor、admin）；任务资料的上传与列表同样只限任务所属品牌的成员
- 负责人：B（设计与实现）；A 审阅

## 状态清单
| 状态 | 图片 | 说明 |
|---|---|---|
| 填写与上限提示 | 01-generate-workbench-form.png | 场景、商品、简述（≤2000 字）、必含词（≤20 条）、风格；任务资料入口（创建任务前是锁定的）；简述接近上限、超限、必含词超限 |
| 任务资料与进度、失败 | 02-generate-workbench-materials-progress.png | F12 资料区的 6 种状态与 6 种错误；已创建、生成中、检查中；`model_unavailable`、`invalid_model_output`、409 |

## 区域与字段（接口以 `docs/API_CONTRACT.md` 第 5 节为准）
- 场景：`GET /scenarios`（`scene`、`name`、`template_version`）；商品：本品牌未归档商品；风格预设：`GET /brands/{id}/style-presets`，可另存。选项与展示名取自接口或契约枚举，不在设计里写死。
- 风格 `style`：`tone` 自由文本（可空）；`length` 偏短/适中/偏长（`short | medium | long`）；`person` 第一/第二/第三人称（`first | second | third`）；`emoji_density` 很少/适量/较多（`low | medium | high`）；`hashtag_count` 0 到 10，默认 5。
- 上限提示：`brief` ≤2000 字；`required_terms` ≤20 条（去空白去重）；粘贴文本每份 ≤50000 字、每任务资料 ≤5 份。
- 提交：`POST /tasks` 创建任务（201，`queued`），再 `POST /tasks/{id}/generate`（202，`Idempotency-Key`）开始生成。
- 进度：轮询 `GET /tasks/{id}`；三段由 `flow_status`（`queued`、`generating`、`checking`）决定，`progress.stage`（`retrieving`、`generating`、`evidence`、`compliance`、`rewriting`，或 `null`）只作为当前段下面的小字（检索资料、生成中、核对依据、风险提示、改写中），为 `null` 时不显示小字。只显示阶段，不显示假百分比。
- 失败：以任务的 `last_error` 为准：`model_unavailable`（任务回到原状态，可直接重试）；`invalid_model_output`（任务为 `constraint_failed`，约束未通过）。

### 任务文件资料（F12，契约已合并，实现 PR #40 在审）
- 接口：`POST /tasks/{id}/materials`（multipart，一个 `file`）；`GET /tasks/{id}/materials`。列表只显示 `filename`、`char_count`、`excerpt`（前 200 字），不显示全文、不显示哈希。
- 规则：只有 `queued` 的任务才能添加；每任务粘贴加文件合计 ≤5 份；每份解析后 ≤50000 字；PDF、DOCX ≤50 MB，md、txt、csv ≤5 MB；超长提示“大文档请走知识库”；**没有删除或替换**（A 已决定），上传错误后新建任务重来。
- 上传是同步的：请求一直等到解析和嵌入完成才返回，没有“解析中”状态可轮询，也没有后台任务。界面提示“解析大文件可能需要几分钟，请保持本页面打开，直到完成”，不显示假进度。上传期间同一任务的“开始生成”和其他上传会被后端等待，界面同时禁用它们。
- 错误区分显示：`FILE_TOO_LARGE`（`limit_bytes`）、`UNSUPPORTED_FILE_TYPE`（`allowed`）、`PARSE_FAILED`、`MATERIAL_TOO_LONG`（`char_count`、`limit_chars`）、`MATERIAL_LIMIT_EXCEEDED`（`material_count`、`limit_count`）、`INVALID_STATE`（`current_state`）；`503 MODEL_UNAVAILABLE` 时任务仍是 queued，可重试。错误都带请求编号（可复制）。

## 交互
- 创建任务按钮在必填项缺失或超限时禁用，原因写在旁边；提交中显示加载并不可再点（对应重复提交保护）。
- 任务已创建（queued）后：资料区解锁，可添加文件资料；“开始生成”随时可点。生成开始后资料区变为只读并说明原因。
- 刷新页面或断网重连：用 `GET /tasks/{id}` 恢复状态，输入与编辑不丢（TC-F07）。
- 重复提交返回 409 时显示当前状态并给“刷新状态”。

## 用到的组件与 token
下拉、文本域与字数组件、标签选择、按钮、上传组件、徽标、提示条、阶段进度条、请求编号复制；颜色、字号、间距只用 design-tokens 里的名字。

## 已决定
1. 上传同步、不轮询、不返回“解析中”；列表只显示文件名、字数、摘录。
2. 任务资料没有删除或替换。
3. 进度三段用 `flow_status`，`progress.stage` 只作小字。

## 未验证
1. 我没有上传文件，也没有调用任何接口；限额、错误码和 details 字段取自契约文字。
2. “创建任务”与“开始生成”分成两步按钮是我按接口（`POST /tasks` 与 `POST /tasks/{id}/generate`）画的；没有资料时是否合并为一个按钮，请 A 确认。
3. 简述“接近上限”的提示阈值（1800 字）是我定的，不是契约规定。
4. 风格预设下拉和“另存为预设”的具体交互按 `GET/POST style-presets` 推断。
5. 图里的文案和资料名都是自编示例，不是客户资料。

## 与契约或约束不一致的地方
1. 资料区在“创建任务”之前不可用（任务还没有 id），因此资料入口分在创建之后；如果希望创建任务时就能带文件，契约需要另外支持，目前不要求。
2. 契约没有“取消生成”接口，图中没有取消入口。
