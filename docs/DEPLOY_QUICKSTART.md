# 一键部署指南（单机，Docker）

适合：一台电脑或一台服务器，几个人在内网或本机使用。需要的只有 **Docker Desktop**（Windows / macOS）或 Docker Engine（Linux）。不需要安装 Python、Node 或数据库，也不需要云服务。

## 1. 启动

先安装并打开 Docker Desktop，等右下角图标显示运行中，然后在源代码目录里运行：

**Windows（PowerShell）**

```powershell
powershell -ExecutionPolicy Bypass -File deploy\start.ps1
```

**macOS / Linux**

```bash
bash deploy/start.sh
```

想带上演示数据（演示品牌、商品、资料，内容都标注【演示数据】）：Windows 末尾加 `-Demo`，macOS / Linux 末尾加 `--demo`。

第一次运行会：
1. 自动生成 `deploy/.env`，里面是随机的密钥、数据库密码和**管理员密码**，同时在终端显示一次。这个文件请保管好，不要提交、不要发给别人。
2. 构建并启动数据库和应用（第一次需要几分钟下载与构建，之后很快）。
3. 自动建表并创建管理员账号。

完成后打开 <http://localhost:8000>，用 `admin@example.com` 和终端里显示（或 `deploy/.env` 里 `FIRST_SUPERUSER_PASSWORD`）的密码登录。

## 2. 登录后先做三件事

1. **填模型密钥**：平台管理员在网页的设置里填 DeepSeek（生成）和 DashScope（嵌入）的密钥，**两个都要填**，缺一个都不能完整使用：只填 DeepSeek 时爆款分析可用，上传资料和生成会失败；只填百炼时生成、检查、评测会失败。没有密钥时系统不会调用任何模型。申请网址：[DeepSeek 开放平台](https://platform.deepseek.com)（“API Keys”页，文档见 [api-docs.deepseek.com](https://api-docs.deepseek.com)）、[阿里云百炼控制台](https://bailian.console.aliyun.com)（“API-KEY”页，步骤见[帮助文档](https://help.aliyun.com/zh/model-studio/get-api-key)；申请时地域选“北京”）。平台页面可能调整，以官网当前显示为准；两者都按用量计费，费用以平台账单为准。
2. **改管理员邮箱**：把默认的 `admin@example.com` 换成真实邮箱，并在用户管理里为同事建账号（系统不开放自助注册）。
3. **装浏览器插件（可选）**：在系统的“插件密钥”页下载插件，按页面说明在 Chrome / Edge 里加载。

## 3. 日常操作

在 `deploy` 目录里运行（Windows 与 macOS / Linux 相同）：

| 操作 | 命令 |
|---|---|
| 查看状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f app` |
| 停止（数据保留） | `docker compose stop` |
| 再次启动 | `docker compose start`，或重新运行启动脚本 |
| 升级到新版本 | 拿到新源码后重新运行启动脚本，数据库会自动升级 |
| 备份数据库 | 见下方“备份与恢复”（不要用 `>` 重定向，Windows PowerShell 会把备份存成 UTF-16，文件损坏） |
| 恢复备份 | 见下方“备份与恢复”；**会覆盖现有数据，先确认** |
| 彻底删除（**数据一并删除**） | `docker compose down -v` |

### 备份与恢复

在 `deploy` 目录下的终端里运行。备份文件在容器内生成后用 `docker compose cp` 取出，不经过终端重定向：

```text
docker compose exec -T db pg_dump -U postgres -Fc -f /tmp/backup.dump app
docker compose cp db:/tmp/backup.dump backup.dump
```

恢复会覆盖现有数据，操作前先确认。把要恢复的 `backup.dump` 放到 `deploy` 目录，系统保持运行，再依次执行（只停应用，数据库保持运行）：

```text
docker compose stop app
docker compose cp backup.dump db:/tmp/backup.dump
docker compose exec -T db pg_restore -U postgres -d app --clean --if-exists --no-owner --exit-on-error /tmp/backup.dump
docker compose up -d --wait app
```

## 4. 常见问题

- **提示 Docker 没运行**：先打开 Docker Desktop，等它完全启动。
- **8000 端口被占用**：编辑 `deploy/.env`，改 `APP_PORT=8080`，再重新运行启动脚本。
- **别的电脑要访问**：同一局域网用 `http://这台电脑的IP:8000`；并在 `deploy/.env` 里取消注释并填写 `PUBLIC_URL`，与访问地址一致。公网访问请放在带 HTTPS 的反向代理（如 Nginx、Caddy）后面，不要直接暴露 8000 端口。
- **忘记管理员密码**：打开 `deploy/.env` 查看。若已在网页里改过密码，则以改后的为准。
- **邮件（找回密码）**：默认没有配置邮件，不会发信。需要时在 `deploy/.env` 增加 SMTP 变量并在 `deploy/compose.yml` 的 `app.environment` 里传入。
- **数据存在哪里**：Docker 卷 `rednote_rednote-db-data`；删除容器不会丢，`down -v` 才会。

## 5. 给技术人员

- 单镜像：后端镜像构建时会编译前端并由后端一起提供页面，所以只有 `db` 与 `app` 两个容器。
- 每次启动都会运行迁移（`alembic upgrade head`）和管理员初始化，重复运行是安全的。
- 与仓库根目录的 `compose.yml`（开发/CI 用，含 Traefik 与 adminer）互不影响；`deployment.md`、`deployment-docker-compose.md` 是模板自带的云端与域名部署说明，面向有域名的服务器，**不是**本指南的流程。

## 6. 离线安装包

配套 Docker Desktop Windows x64 安装器版本： **4.98.0.245422**；应用镜像为 linux/amd64。系统要求以 [Docker 官方 Windows 安装页](https://docs.docker.com/desktop/setup/install/windows-install/)为准，本说明写于 **2026-11-05**：WSL ≥2.1.5；Windows 10 22H2（19045）或 Windows 11 23H2（22631）及以上，并满足官方列出的版本与维护支持范围；至少 8 GB 内存、64 位 Intel/AMD 处理器支持 SLAT、BIOS/UEFI 开启虚拟化。`wsl --install` 命令的 Windows 10 2004 下限不是 Docker Desktop 的系统下限。安装方式、离线 WSL 步骤以包内 README 为准。

客户拿到的是预构建镜像、启动/停止脚本和一页安装说明，不需要源码、Python、Node 或单独安装数据库。先安装并打开 Docker Desktop（Linux 容器模式，Compose 须支持 `--wait` 和 `--pull never`），Windows 双击包内 `启动.bat`；macOS/Linux 同样提供启动脚本 `启动.sh`。首次自动导入镜像、生成随机密钥和管理员密码、创建本机数据卷，健康检查通过后打开浏览器。后续启动保留配置与数据；停止不删除卷。启动会检查宿主机端口与登录页；失败不会自动 down，按包内 README 的“修改端口”处理。不要把安装目录放入共享盘或云同步目录。

交付人员在可联网构建的电脑上运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-offline-package.ps1 -OutputDirectory "D:\交付\RedNoteSearch离线安装包"
```

脚本 fetch 后从最新 `origin/main` 创建独立的干净检出构建镜像，版本标签取其提交号；不会把当前工作区未提交的应用改动编入镜像。输出目录必须为空。只按白名单复制离线脚本，保存两份镜像 tar，写入 `VERSION.txt` 和 `SHA256SUMS.txt`（不包含校验文件自身）。安装包输出、临时检出及 tar 不进 Git；包内不带环境配置、密钥、真实资料或内部协作文档。

`deploy/start.ps1` / `start.sh` 仍是原来的源码构建入口，行为不变；离线入口使用 `deploy/offline/compose.offline.yml`，没有 build，启动显式禁止拉取。离线版保留原两服务、健康检查、初始化命令和环境变量含义。默认同为 `rednote` 项目和数据卷，因此不要在同一台机器同时启用源码版与离线版；切换前先停止并备份，并将原 `deploy/.env` 复制到离线包根目录，避免对原数据卷使用新密码。启动与停止入口从 VERSION.txt 读取镜像标签，并原子同步 `.env` 的 APP_TAG（缺失时补入），保持其他配置不变。升级后先运行启动入口，再新开终端执行 Compose 手工命令；无需再设置 APP_TAG，避免旧环境变量覆盖它。升级保留原配置与卷，只更换镜像和脚本；降级应用不等于降级数据库，操作前备份。

模型功能仍需联网：管理员在设置中填模型密钥，只有调用模型时相关文本才发往模型服务。启动包不含密钥。验证范围：仅完成本机 Windows 环境的启动、登录与数据保留检查；macOS/Linux、真实模型功能及第二台电脑尚未验证。

同机重装时，没有 `.env` 但已有本项目数据卷会提前停止；启动失败若检测到数据库密码认证失败，也会提示保留旧配置或手工清空数据的两个选项。请按包内“这台电脑以前装过本系统怎么办”操作：保留数据需复制原 `.env`；放弃全部旧数据才在安装目录的终端运行 `docker compose -f compose.offline.yml down -v`，删除后无法恢复。修改端口时，`APP_PORT=8080` 和 `PUBLIC_URL=http://localhost:8080` 是 `.env` 中的内容，不是终端命令。

客户操作提示：资源管理器打开安装目录，在地址栏输入 `powershell` 后按回车即可打开本目录终端；数据卷是 Docker 保存数据库的本机目录，删了就没有了；网页改过密码后 `.env` 的初始密码不会同步，忘记新密码请找管理员重置。
