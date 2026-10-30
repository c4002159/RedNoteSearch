# ADR-001 数据库迁移所有权：各写各表

状态：已确认（2026-10-30）。
替代：两人协作手册与 AI_TEAM_GUIDE 中“A 独占 Alembic 迁移”的约定。

## 背景
两人都做全栈纵向切片（页面、接口、数据表、测试）。若只有 A 能写迁移，B 改自己的表要等 A，违背“全栈”职责，也让 B 的 PR 经常依赖 A 的合并顺序。

## 决定
1. 每位成员为**自己拥有的表**（技术文档 5.1）编写迁移：先改 SQLModel 模型，再 `alembic revision --autogenerate`，**人工审阅**生成内容后提交。
2. 迁移历史**保持线性**，不使用 `alembic merge` 产生合并节点。
3. CI 强制：
   - `alembic heads` 只能有 1 个；
   - 从空库升级到 head 成功，`vector` 扩展存在；
   - 可 `downgrade -1` 一步（破坏性变更须写回滚或兼容步骤）。
4. 两个 PR 同时含迁移时，**后合并者**先 rebase main，把自己迁移的 `down_revision` 改为 main 当前 head，重跑迁移检查，再请求合并。
5. 一个 PR 最多一条迁移；迁移文件名与说明写清所涉表。
6. 修改**对方拥有的表**或被引用的主键：必须经对方审查（CODEOWNERS 路径）；B 的表可以外键引用 A 的表，但不得改动被引用的主键。
7. 种子数据放种子脚本，不放迁移（枚举或参照数据除外）。
8. 模板的单文件 `models.py` 在 Phase 0 由 A 拆成 `models/` 包（identity、catalog、knowledge 归 A；generation、compliance、evaluation 归 B），`__init__.py` 汇总导入，保证 Alembic 能看到全部模型。
9. AI 助手可以起草迁移，但须由该表的 owner 审阅并对其负责（见 AI 协作约定）。

## 影响
- B 不再等待 A 即可改表；冲突由 CI 的单 head 检查发现，由后合并者处理。
- A 仍负责 CI 配置与 compose，但不再是迁移瓶颈。
- 需同步更新技术文档 5.3、7.1、13.2 与 AI_TEAM_GUIDE 的文件所有权条款。
