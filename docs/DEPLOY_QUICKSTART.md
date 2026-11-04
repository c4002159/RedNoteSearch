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

1. **填模型密钥**：平台管理员在网页的设置里填 DeepSeek（生成）和 DashScope（嵌入）的密钥。没有密钥时系统不会调用任何模型。
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
