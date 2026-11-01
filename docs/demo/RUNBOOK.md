# 本地演示环境启动与录制

2026-11-02 实测。以下使用 PowerShell、已安装的依赖，以及项目 PostgreSQL/pgvector 的 `localhost:5433`。只占用后端 **8010**、前端 **5175**；不使用 8000、5174、8011、5176，不停止其他项目容器。

本轮实际验证的是离线开发演练，不是客户录制环境。客户录制应使用新库、真实嵌入与已审核真实资料；真实资料灌入和真实模型结果在本轮 **未验证**。不要把假模型演练录成客户效果。

## 1. 新建空库

在仓库的 `backend/` 目录打开终端。数据库连接凭据、超级用户邮箱与密码均 **见本机 `.env`**，不复制到本文或命令参数中。脚本只读取这些配置；不要打印 `DATABASE_URL`。

下面命令已实际执行：新建 `app_demo_recording`，已有同名库时拒绝，不覆盖。

```powershell
$env:UV_FROZEN = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONWARNINGS = 'ignore'
$env:APP_DEMO_DB = 'app_demo_recording'
@'
import os
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url
from app.core.config import settings
u = make_url(str(settings.DATABASE_URL)).set(host='localhost', port=5433)
name = os.environ['APP_DEMO_DB']
assert name.startswith('app_demo_')
with psycopg.connect(host=u.host, port=u.port, dbname='postgres', user=u.username,
                    password=u.password, autocommit=True, connect_timeout=5) as c:
    if c.execute('SELECT 1 FROM pg_database WHERE datname=%s', (name,)).fetchone():
        raise SystemExit('Target already exists; choose a fresh database name')
    c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
print('Created a new empty demo database')
'@ | uv run python -
```

同一终端设置临时数据库连接。输出由变量接收，不显示凭据；本机 `.env` 文件不变。

```powershell
$env:DATABASE_URL = @'
import os
from sqlalchemy.engine import make_url
from app.core.config import settings
print(make_url(str(settings.DATABASE_URL)).set(host='localhost', port=5433,
    database=os.environ['APP_DEMO_DB']).render_as_string(hide_password=False))
'@ | uv run python -
```

换终端时重新设置上述变量，确保仍指向这个新库；不要误连项目默认库。

## 2. 迁移、账号与场景初始化

以下命令已在新空库运行成功。

```powershell
uv run alembic upgrade head
uv run python -m app.initial_data
```

`initial_data` 创建或确保超级用户、场景模板和风格预设存在。登录账号与密码 **见本机 `.env`**；从网页登录表单进入，不读取令牌文件。普通演示账号可由平台管理员在“用户管理”创建；本轮也实际用自建账号从表单登录走查。客户录制库不要复用走查测试账号。

## 3. 资料与嵌入：两条流程不能混用

**离线开发演练（已执行）**：

```powershell
$env:LLM_MODE = 'demo_fake'
uv run python -m app.seed --fake-embeddings
```

实际创建了含“（演示）”商品、品牌档案、资料及评测集的演示品牌。这些自编占位资料仅用于开发。`demo_fake` 与假嵌入匹配，不需要模型密钥；它不代表真实模型效果，也不覆盖所有评测/爆款分析的模型调用。

**客户录制（本轮未验证）**：重新建立另一个空库，重复迁移和 `initial_data`。在本机配置真实模型与嵌入凭据，并使用 `LLM_MODE=real`。通过品牌、商品和知识库页面录入客户真实资料，确认来源、审核状态、索引状态及卖点关联。资料原件和本机灌入脚本不提交仓库。本轮没有执行客户真实资料灌入脚本，也没有验证该录制库的真实生成结果。

真实嵌入与 `--fake-embeddings` **不能混在一个资料库里**；不要仅切换模式就沿用假嵌入库。客户录制库不执行上面的假种子命令。`uv run python -m app.seed`（真实嵌入种子命令）在本轮 **未运行**，而且仍会产生占位内容，不能作为真实资料灌入替代。

## 4. 启动后端

保持同一终端的临时 `DATABASE_URL`。以下离线启动命令已运行，看到应用启动完成、监听 8010。

```powershell
$env:FRONTEND_HOST = 'http://localhost:5175'
$env:FASTAPI_ENV = 'development'
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

`LLM_MODE` 沿用第3节离线设置；客户真实模式启动本轮未验证。另开终端执行已验证的健康检查：

```powershell
Invoke-RestMethod http://localhost:8010/api/v1/utils/health-check/
```

本轮返回 `True`。`FRONTEND_HOST` 必须与实际前端地址一致，浏览器访问用 `localhost:5175`；本轮 OPTIONS 响应允许该来源。

## 5. 构建并启动前端预览

在仓库 `frontend/` 目录的另一个终端执行。以下命令已实际运行成功。

```powershell
$env:VITE_API_URL = 'http://localhost:8010'
bun run build
bunx vite preview --port 5175 --strictPort
```

打开 `http://localhost:5175/login`。`VITE_API_URL` 在构建时写入；修改 API 地址后必须重新 build，单改 preview 进程的变量无效。录制使用 **build 后的 preview**，不用 Vite dev。本轮生产预览中两种 TanStack 调试按钮均不存在；开发模式会出现悬浮入口，并可能遮挡表单按钮。

## 6. 录制前逐项检查

- 登录页和业务页无调试悬浮按钮；本轮生产预览已看到。
- 清空本站 localStorage 后首次为浅色；本轮模拟系统深色仍为浅色。清空会退出登录，随后从表单重新登录。
- 标题为中文页面名加 `- RedNoteSearch`；所需页面均实际打开后再确认。
- 客户库无“（演示）”占位商品，无走查测试账号、测试品牌、测试评测记录。**本轮离线库含演示商品，不满足这一项，不能直接录客户视频。**
- 真实资料已审核且可检索，商品卖点来源已核对；不把草稿卖点当依据。该客户库状态本轮未验证。
- 模型模式、嵌入与价格配置符合录制目的，实际生成/检查/导出完整走通。真实模型与费用本轮未验证。
- 在本机确认最终画面、数据与账号后再开始录制；不要把 `.env`、密钥或凭据显示在录屏中。

## 7. 停止与清理

在自己启动后端和 preview 的两个终端分别按 **Ctrl+C**。本轮已实际停止自己8010和5175的进程，不停止数据库容器或其他项目。

下面只删除本轮自行创建的一次性 `app_demo_recording`。真实录制库需保留或另做备份，不运行此清理。脚本发现仍有连接时拒绝，不强制终止连接。

在 `backend/` 目录运行（本轮已执行成功）：

```powershell
$env:APP_DEMO_DB = 'app_demo_recording'
@'
import os
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url
from app.core.config import settings
u = make_url(str(settings.DATABASE_URL)).set(host='localhost', port=5433)
name = os.environ['APP_DEMO_DB']
assert name == 'app_demo_recording'
with psycopg.connect(host=u.host, port=u.port, dbname='postgres', user=u.username,
                    password=u.password, autocommit=True, connect_timeout=5) as c:
    active = c.execute('SELECT count(*) FROM pg_stat_activity WHERE datname=%s', (name,)).fetchone()[0]
    if active:
        raise SystemExit('Stop this demo database clients before cleanup')
    c.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))
print('Removed only the temporary demo database')
'@ | uv run python -
```

关闭这些临时终端即可移除进程级环境变量；本轮未修改本机 `.env`，未删除既有走查库或默认项目数据。客户真实环境的备份恢复流程未验证。
