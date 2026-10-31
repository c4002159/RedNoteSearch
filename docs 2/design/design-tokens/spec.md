# 设计 token 规格

- 对应需求：技术文档 4.2（FC-04：颜色、字号、间距只用 token）、4.4（状态标签映射）；ADR-008
- 路由：无（规格页）
- 角色与权限：无
- 负责人：B（整理）；A 审阅并落地到 `frontend/src/index.css`

## 状态清单
| 内容 | 图片 | 说明 |
|---|---|---|
| 语义色、徽标、状态映射 | 01-design-tokens-colors.png | token 名取自设计稿导出的 Tailwind 配置；设计稿里直接写色值的，页面里“建议补名字”一栏 |
| 字体、间距、圆角、阴影、控件尺寸 | 02-design-tokens-type-space.png | 数值取自设计稿 code.html；字体按“落地用系统字体栈”标注 |

## 区域与字段
- 全部数值来自 Stitch 导出的 `code.html` 与 Tailwind 配置，不是新设计。落地以 `index.css` 为准，由 A 映射到前端现有的 shadcn 变量（`--background`、`--primary` 等），不改名。
- `primary #004ac6` 标为“链接文字色”，`primary-container #2563eb` 标为“主按钮色”，避免两个名字混用。
- 辅助文字与占位符的 `outline` 由 `#737686` 加深为 `#5f6372`。我们没有实测对比度，不写“已通过无障碍检查”；只给出调整后的值，**待实现时用工具核对**。
- 状态标签与颜色对应关系见技术文档表 4-4。`system_supported`（“系统判定支持”）改为浅蓝（soft-blue：文字 `#1E40AF`，底 `#DBEAFE`），不用绿色，旁边保留“非事实保证”提示；`ready_to_copy`（“可复制（运营已确认）”）保留绿色；“人工确认（非系统验证）”按 #32，中性蓝灰。
- 场景图标底色只用于场景卡片 32px 图标块。

### 状态徽标映射（改动处）
| 枚举 | 标签 | 色调 |
|---|---|---|
| `checks_completed` | 检查已完成，请查看结果 | 中性蓝灰 |
| `evidence: system_supported` | 系统判定支持 | 浅蓝（原为绿色，已改）；旁附“非事实保证” |
| `ready_to_copy` | 可复制（运营已确认） | 绿色（保留） |
| `human_confirmed` | 人工确认（非系统验证） | 中性蓝灰 |

## 字体（已决定）
落地用系统字体栈：`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`。设计稿里的 Plus Jakarta Sans **暂不引入**（demo 需离线运行、不新增依赖）；设计稿的视觉保留，字号、行高、字重不变。

## 交互
无。焦点样式（2px 主色外框；输入框 3px 浅蓝光圈）A 已同意。

## 用到的组件与 token
本页即 token 清单。

## 已决定的事项
1. 颜色基线：**以实际屏幕为准**（`#f9f9ff`、`#c3c6d7`、`#2563eb` 实心），不用 `DESIGN.md` 里的渐变和另一套色值。
2. 品牌色块金色只用于品牌切换器的 16px 色块，不作为通用品牌色。
3. 没有跑过对比度检查脚本；颜色值读取自导出文件，调整后的值待实现时用工具核对。
