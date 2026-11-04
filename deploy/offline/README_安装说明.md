# RedNoteSearch 离线安装说明

1. **先准备 Docker**：从 [Docker Desktop 官网](https://www.docker.com/products/docker-desktop/)安装适合本机的版本（Docker Desktop 不随包附带，约 600 MB，安装它需要联网）。
   - 配套 Windows 安装器版本：**4.98.0.245422**；应用镜像为 linux/amd64，需 Intel/AMD 64 位处理器，其他架构需另制包。
   - 系统要求以 [Docker 官方 Windows 安装页](https://docs.docker.com/desktop/setup/install/windows-install/)为准，本说明写于 **2026-11-05**：WSL ≥2.1.5；Windows 10 22H2（内部版本 19045）或 Windows 11 23H2（22631）及以上，并满足官方列出的系统版本/维护支持范围；至少 8 GB 内存，处理器支持 SLAT，BIOS/UEFI 开启硬件虚拟化。按用户安装通常不需管理员权限；启用系统组件或选择全用户安装时需要管理员协助。
   - Docker Desktop 需要 Windows 的“虚拟机平台”和 WSL。若安装程序提示缺少它们：在管理员 PowerShell 里运行 `wsl --install --no-distribution` 后重启。国内网络下该命令可能因连接被重置而失败，此时可向交付人员索取 WSL 离线安装包（`wsl.*.x64.msi`）：先在管理员 PowerShell 里运行 `dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` 和 `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`，重启；再运行 `msiexec /i "wsl 安装包的完整路径"`（不要把它当压缩包解压，也不要用记事本打开），再次重启，用 `wsl --version` 确认。
   - `wsl --install` 命令本身可用于 Windows 10 2004（19041）及以上或 Windows 11，这不等于满足 Docker Desktop 的系统要求；安装后仍须用 `wsl --version` 检查 WSL 版本。
   - 打开 Docker Desktop，等它显示运行中（可跳过登录）。使用 Linux 容器模式；需要带 Docker Compose，支持 `--wait` 和 `--pull never`。
2. **启动**：把整个文件夹放在本机，不要放进共享盘或云同步目录。Windows 双击 **启动.bat**，不要单独移动其中的文件。首次导入镜像可能较慢，请等窗口显示启动成功，浏览器会自动打开 <http://localhost:8000>。仅启动不需联网下载或构建。macOS/Linux 同样提供启动脚本：`bash 启动.sh`。
3. **登录**：账号为 `admin@example.com`。首次窗口会显示随机管理员密码，请立即保存；也可在本目录启动后生成的隐藏配置文件 `.env` 中（需要在资源管理器里勾选“隐藏的项目”）的 `FIRST_SUPERUSER_PASSWORD=` 一行找到。密码是每台电脑随机生成的，不是 `changethis` 之类的默认值，区分大小写。再次启动不会重置密码或数据；在网页里改过密码后，`.env` 里的初始密码不会同步，忘记新密码请找管理员重置。内部 `run.ps1` 是 Windows 入口所需文件，无需手工运行。
4. **首次使用**：全新安装里没有任何品牌。管理员登录后先在“品牌”页新建品牌（创建者自动成为该品牌的管理员），并在页面顶部切换到这个品牌；没有品牌或不是品牌成员时，品牌下的功能无法使用，可能提示找不到。
5. **设置模型**：管理员登录后在网页“设置”中填写模型密钥。包内不含任何密钥。数据留在客户自己的机器上，只有调用模型时相关文本才发往模型服务；模型功能需要联网及有效密钥。
6. **升级**：系统运行时先按下方命令备份，再双击停止；将新包的脚本、镜像、版本文件替换到原文件夹，保留原 `.env`，再双击启动。启动和停止入口都会按 VERSION.txt 自动同步 `.env` 的 APP_TAG，只改版本行，不重新生成密码或密钥；窗口会显示版本变化。升级后先运行一次启动入口，再重新打开终端执行手工命令，避免旧终端残留的 APP_TAG 环境变量覆盖配置。不要修改项目名或删除 Docker 数据卷。
7. **停止与卸载**：数据卷就是 Docker 保存在本机的数据库目录，删了就没有了。双击 **停止.bat**（Unix 为 `bash 停止.sh`）保留数据。删掉安装文件夹不会删除 Docker 数据卷。确实要彻底清空时，先停止，在本目录自行确认后执行 `docker compose -f compose.offline.yml down -v`，该操作会删除全部本系统数据；最后再删文件夹。

**备份与恢复**：以下命令要在本目录下的终端里运行：在资源管理器打开安装目录，点击地址栏输入 `powershell` 后按回车，即可打开该目录的终端。首次启动后的 `.env` 里已有 `APP_TAG`，无需另行设置。系统运行时备份，文件直接从容器复制出来，不经过终端重定向：

```text
docker compose -f compose.offline.yml exec -T db pg_dump -U postgres -Fc -f /tmp/backup.dump app
docker compose -f compose.offline.yml cp db:/tmp/backup.dump backup.dump
```

**恢复会覆盖现有数据，操作前先确认**。把要恢复的 `backup.dump` 放到本目录，先启动系统，再依次执行下列命令（只停应用，数据库保持运行）：

```text
docker compose -f compose.offline.yml stop app
docker compose -f compose.offline.yml cp backup.dump db:/tmp/backup.dump
docker compose -f compose.offline.yml exec -T db pg_restore -U postgres -d app --clean --if-exists --no-owner --exit-on-error /tmp/backup.dump
docker compose -f compose.offline.yml up -d --wait --pull never app
```

## 修改端口

若提示端口被占用或本机登录页无法打开：用记事本打开安装目录的 `.env`，把 `APP_PORT` 改为空闲端口（例如 `8080`），同时把 `PUBLIC_URL` 改为 `http://localhost:8080`，保存后重新双击启动。不要停止不属于本系统的程序。脚本会先检查端口，再检查本机登录页，失败时保留容器供查看日志，不会自动清除数据。

## 常见问题

爆款分析、生成、重新检查、语气推荐等都要调用模型：没有填密钥或这台电脑连不上模型服务时会报错，请先在“设置”里填好密钥并确认能联网。页面报错时，按 F12 打开浏览器开发者工具的“网络”页，复制红色请求的地址、状态码和响应内容；容器日志在 Docker Desktop 的“容器”里打开 `rednote-app-1` 查看（也可以在本目录运行 `docker compose -f compose.offline.yml logs --tail 100 app`），发给交付人员时先去掉密码和密钥。Docker 未启动时请打开 Docker Desktop 并等待；端口问题按上方“修改端口”处理。首次镜像导入需要磁盘空间，慢时请保留窗口等候。失败请把错误提示发给交付人员，勿发送配置文件或密码。升级或再次启动不会导入已存在的镜像。

**验证范围**：仅完成本机 Windows 环境的启动、登录与数据保留检查；macOS/Linux、真实模型功能及第二台电脑尚未验证。
