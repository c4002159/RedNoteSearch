# RedNoteSearch 离线安装说明

1. **先准备 Docker**：从 [Docker Desktop 官网](https://www.docker.com/products/docker-desktop/)安装适合本机的版本（Docker Desktop 不随包附带，约 600 MB，安装它需要联网）。
   - Windows：需要 Windows 10（2004 及以上）或 Windows 11，需要管理员权限，安装时选“所有用户安装”（All-users installation），装完按提示重启。电脑的 BIOS 里要开启 CPU 虚拟化（Intel VT-x 或 AMD-V），多数电脑默认已开。
   - Docker Desktop 需要 Windows 的“虚拟机平台”和 WSL。若安装程序提示缺少它们：在管理员 PowerShell 里运行 `wsl --install --no-distribution` 后重启。国内网络下该命令可能因连接被重置而失败，此时可向交付人员索取 WSL 离线安装包（`wsl.*.x64.msi`）：先在管理员 PowerShell 里运行 `dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` 和 `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`，重启；再运行 `msiexec /i "wsl 安装包的完整路径"`（不要把它当压缩包解压，也不要用记事本打开），再次重启，用 `wsl --version` 确认。
   - 打开 Docker Desktop，等它显示运行中（可跳过登录）。使用 Linux 容器模式；需要带 Docker Compose，支持 `--wait` 和 `--pull never`。
2. **启动**：把整个文件夹放在本机，Windows 双击 **启动.bat**，不要单独移动其中的文件。首次导入镜像可能较慢，请等窗口显示启动成功，浏览器会自动打开 <http://localhost:8000>。仅启动不需联网下载或构建。macOS/Linux 同样提供启动脚本：`bash 启动.sh`。
3. **登录**：账号为 `admin@example.com`。首次窗口会显示随机管理员密码，请立即保存；也可在本目录启动后生成的隐藏配置文件 `.env` 中（需要在资源管理器里勾选“隐藏的项目”）的 `FIRST_SUPERUSER_PASSWORD=` 一行找到。密码是每台电脑随机生成的，不是 `changethis` 之类的默认值，区分大小写。再次启动不会重置密码或数据。内部 `run.ps1` 是 Windows 入口所需文件，无需手工运行。
4. **首次使用**：全新安装里没有任何品牌。管理员登录后先在“品牌”页新建品牌（创建者自动成为该品牌的管理员），并在页面顶部切换到这个品牌；没有品牌或不是品牌成员时，品牌下的功能无法使用，可能提示找不到。
5. **设置模型**：管理员登录后在网页“设置”中填写模型密钥。包内不含任何密钥。数据留在客户自己的机器上，只有调用模型时相关文本才发往模型服务；模型功能需要联网及有效密钥。
6. **升级**：系统运行时先按下方命令备份，再双击停止；将新包的脚本、镜像、版本文件替换到原文件夹，保留原 `.env`，再双击启动。不要修改项目名或删除 Docker 数据卷。
7. **停止与卸载**：双击 **停止.bat**（Unix 为 `bash 停止.sh`）保留数据。删掉安装文件夹不会删除 Docker 数据卷。确实要彻底清空时，先停止，在本目录自行确认后执行 `docker compose -f compose.offline.yml down -v`，该操作会删除全部本系统数据；最后再删文件夹。

**备份与恢复**：以下命令要在本目录下的终端里运行。首次启动后的 `.env` 里已有 `APP_TAG`，无需另行设置。系统运行时备份，文件直接从容器复制出来，不经过终端重定向：

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

**常见问题**：爆款分析、生成、重新检查、语气推荐等都要调用模型：没有填密钥或这台电脑连不上模型服务时会报错，请先在“设置”里填好密钥并确认能联网。页面报错时，按 F12 打开浏览器开发者工具的“网络”页，复制红色请求的地址、状态码和响应内容；容器日志在 Docker Desktop 的“容器”里打开 `rednote-app-1` 查看（也可以在本目录运行 `docker compose -f compose.offline.yml logs --tail 100 app`），发给交付人员时先去掉密码和密钥。Docker 未启动时请打开 Docker Desktop 并等待；8000 被占用时，用记事本打开 `.env`，把 `APP_PORT` 改为空闲值（如 8080），同时将 `PUBLIC_URL` 改为 `http://localhost:8080`，保存后重新启动。首次镜像导入需要磁盘空间，慢时请保留窗口等候。失败请把错误提示发给交付人员，勿发送配置文件或密码。升级或再次启动不会导入已存在的镜像。

**验证范围**：没有验证 macOS/Linux、没有输入真实模型密钥做生成、没有在第二台干净电脑上试。交付前本机实测结果、文件大小与耗时见交付记录；`SHA256SUMS.txt` 可供技术人员核对文件完整性，不含自身校验值。镜像适用的架构见 `VERSION.txt`，不同架构需重新制作对应镜像包。

**本包实测**：Windows 本机独立空目录、8087 端口，删除目标镜像标签后从包导入；两个服务健康、登录与页面刷新正常，重复启动及停止再启动保留密码和数据。本轮复用原镜像，未重新构建；首次启动 45.50 秒、再次 2.24 秒、停止 3.17 秒、再启动 13.51 秒。使用 Docker Desktop 4.90.0、Engine 29.7.2、Compose 5.5.1；未确定更低版本的兼容下限。未验证跨版本升级。包约 679 MiB，展开镜像另占空间，建议预留至少 8 GB（不含 Docker Desktop 自身与后续业务数据）。

**备份恢复演练**：仅在本机临时项目的新空卷初始化系统表、随机管理员和自建测试品牌；二进制备份 95,685 字节，目录可读。恢复后备份前品牌保留、备份后新增品牌消失，登录正常。没有使用真实客户数据；测试卷、配置、副本和备份文件均已清理。macOS/Linux 本轮仅语法检查，另在 Windows Git Bash 做了管道模拟，不代表平台实测。
