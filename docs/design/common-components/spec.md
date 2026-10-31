# 公共组件状态图

- 对应需求：技术文档 4.2；FC-07（错误态显示 request_id）；ADR-004、ADR-005；API_CONTRACT 第 5 节（上传限制）
- 路由：无（组件）
- 角色与权限：无
- 负责人：B（设计）；A + AI 助手落地为 `components/Common`

## 状态清单
| 组件 | 图片 | 状态 |
|---|---|---|
| 按钮、输入、文本域、下拉、复选单选、标签选择 | 01-common-controls.png | 默认、悬停、焦点、禁用、加载、错误、超限 |
| 表格与分页、卡片、徽标、提示条、轻提示、加载/空/错误 | 02-common-data-feedback.png | 含状态徽标按技术文档表 4-4 |
| 弹窗（可确认、被拒、加载、失败）、401、403、404 | 03-common-dialogs-global.png | 403 整页含返回入口，不退出登录 |
| 上传 | 04-common-upload.png | 空闲、拖入、上传中、长时间解析、FILE_TOO_LARGE、UNSUPPORTED_FILE_TYPE、PARSE_FAILED、完成 |

## 区域与字段
- 确认弹窗被拒原因：错误响应 `INVALID_STATE` 的 `details.current_state`、`details.codes`、`details.reasons[]`；不自行编造原因。
- 错误态：错误信封 `{error:{code,message,details,request_id}}`；请求编号未知时显示"—"。
- 上传限制：PDF、DOCX ≤50 MB；md、txt、csv ≤5 MB；`FILE_TOO_LARGE` 的 `details.limit_bytes`；`UNSUPPORTED_FILE_TYPE` 的 `details.allowed`；`PARSE_FAILED`。
- 状态徽标的文案与色调取自技术文档表 4-4；"人工确认（非系统验证）"按 #32。

## 交互
- 表单提交中按钮显示加载并不可再点。
- 文本域超限变红但不截断（与发布页行为一致，ADR-004 实测）。
- 仅 401 退出登录；403、404 不退出。
- 错误态带重试；解析大文件要有长时间等待说明，不显示假进度。

## 用到的组件与 token
本批即定义这些组件；颜色、字号、间距只引用 design-tokens 里的名字。

## 与契约或约束不一致的地方
1. 上传"解析中"状态是否由接口返回、是否轮询，契约没写清，请 A 确认。
2. 确认按钮在前端已知条件不满足时禁用并列出原因（#32）；服务端返回 `INVALID_STATE` 时弹出兜底弹窗。两者的文案需 A 确认。
3. 焦点样式是提案。
4. 我没有实际上传文件，也没有调用任何接口；上限与错误码取自契约文字。
