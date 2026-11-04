# RedNoteSearch 离线安装说明

整个过程分两部分。**第一部分只在这台电脑第一次使用时做**，约 30 到 60 分钟，大部分时间在等待和重启；**第二部分是本系统的启动**，以后每次只需要双击一个文件。

顺序很重要：**先装 WSL，再装 Docker Desktop，最后启动本系统。** 反过来装，Docker 会提示缺少 WSL 或“虚拟机平台”。

## 第一部分：准备电脑（只做一次）

### 步骤 1：检查电脑是否满足要求

- 系统：64 位 Windows，Windows 10 22H2（内部版本 19045）或 Windows 11 23H2（22631）及以上。按 `Win + R`，输入 `winver` 回车，可以看到版本和内部版本号。Windows 家庭版可以使用。
- 内存至少 8 GB；磁盘预留至少 8 GB（本系统的镜像文件约 700 MB，展开后更大）。
- 处理器是 Intel 或 AMD 的 64 位处理器。苹果 M 系列等其他架构需要另做安装包。
- 电脑的虚拟化功能要开启：打开“任务管理器”→“性能”→“CPU”，右下角应显示“虚拟化：已启用”。如果显示“已禁用”，需要在开机进入 BIOS（UEFI）里打开 Intel VT-x 或 AMD-V（也可能叫 SVM），具体按键因品牌而异。
- 以上要求以 [Docker 官方 Windows 安装页](https://docs.docker.com/desktop/setup/install/windows-install/)为准，本说明写于 2026-11-05。配套的 Docker Desktop 安装器版本是 **4.98.0.245422**。

### 步骤 2：打开“管理员终端”

后面的命令都要在管理员权限的终端里运行。在开始按钮上点右键，选“终端（管理员）”或“Windows PowerShell（管理员）”，弹出“是否允许”时点“是”。窗口标题里应带有“管理员”字样。

### 步骤 3：先安装 WSL

WSL 是 Docker Desktop 在 Windows 上运行所依赖的组件。先试方式一，**方式一失败再用方式二**。

**方式一（电脑能正常联网）**：在管理员终端里运行

```text
wsl --install --no-distribution
```

运行完成后**重启电脑**。重启后再打开一个终端，运行 `wsl --version`，能显示 WSL 版本号（要求 2.1.5 及以上）就完成了。

**方式二（方式一报错，例如“与服务器的连接被重置”、下载一直失败或卡住）**：改用随包提供的 WSL 离线安装包，文件名类似 `wsl.3.0.3.0.x64.msi`（向交付人员索取）。

1. 确认文件名**以 `.msi` 结尾**。如果以 `.zip`、`.part` 结尾，说明下载不完整或被改过名，请重新获取。文件大小应有三百多 MB。
2. 把它放在一个简单的英文目录里，例如 `C:\wsl\`。
3. 在管理员终端里依次运行下面两条命令，打开所需的 Windows 功能：

   ```text
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   ```

   进度可能长时间停在 70% 左右，这是常见现象，**请耐心等待，不要关闭窗口**。如果窗口里的进度条没变，但任务管理器里“Windows 模块安装程序”等进程仍在占用 CPU 或磁盘，就说明还在工作。等待很久也没有任何变化时，重启电脑后再重新运行这条命令。两条都显示“操作成功完成”后，**重启电脑**。
4. 重启后，在管理员终端里运行（路径换成自己的实际路径，保留引号）：

   ```text
   msiexec /i "C:\wsl\wsl.3.0.3.0.x64.msi"
   ```

   按安装向导一路下一步。**注意**：
   - 必须“运行”这个安装文件，**不能把它当压缩包解压**。把 `.msi` 解压到另一台电脑或另一个目录，并不等于安装了 WSL，Docker 仍会提示“没有安装 WSL”。
   - **不要用记事本打开它**。`.msi` 是安装程序，用记事本打开会长时间卡住没有反应。
5. 安装完成后**再重启一次**，然后运行 `wsl --version`，能显示版本号就完成了。

### 步骤 4：安装 Docker Desktop

Docker Desktop 不在本系统的文件里，需要单独安装（安装包约 600 MB）。可以向交付人员索取安装包，也可以从 [Docker 官网](https://www.docker.com/products/docker-desktop/)下载；官网下载在国内可能很慢。

1. 在 Docker Desktop 安装包上点右键，选“以管理员身份运行”。
2. 安装向导里的选项：
   - 如果有“Use WSL 2 instead of Hyper-V（使用 WSL 2）”，**保持勾选**。
   - 如果有“Allow Windows Containers（允许 Windows 容器）”，**不要勾选**。本系统只使用 Linux 容器。
   - 如果让你选择“为所有用户安装”还是“仅为当前用户安装”，选 **所有用户（All users）**。这需要管理员权限，所以第 1 步要用管理员身份运行。
3. 安装完成后按提示重启电脑或注销再登录。
4. 打开 Docker Desktop。首次打开会出现服务条款，点“Accept”；要求登录时可以点“Skip”跳过，本系统不需要 Docker 账号。
5. **等 Docker Desktop 显示“运行中”（Engine running）后**再继续，这可能需要一两分钟。
6. 打开一个新终端，运行下面两条命令确认。都有版本信息输出，没有红色报错，才算装好：

   ```text
   docker version
   docker compose version
   ```

   本系统要求 Docker Compose 支持 `--wait` 和 `--pull never`，使用较新的 Docker Desktop 即可满足。

**安装时遇到的问题**

| 现象 | 原因与做法 |
| --- | --- |
| Docker 提示“Virtual Machine Platform（虚拟机平台）未启用” | 回到步骤 3，运行其中的 `VirtualMachinePlatform` 那条 dism 命令，重启电脑。仍然不行，检查 BIOS 里的虚拟化是否开启。 |
| Docker 提示“WSL 未安装”或“需要更新 WSL” | 回到步骤 3，确认 `wsl --version` 能显示版本号。如果只是解压过 `.msi` 而没有运行安装，要按方式二的第 4 步运行 `msiexec`。 |
| `wsl --install` 报“与服务器的连接被重置”或一直卡住 | 国内网络常见，改用步骤 3 的方式二。 |
| Docker Desktop 一直停在“Starting”不动 | 先完全退出 Docker Desktop 再重新打开；仍不行就重启电脑。确认步骤 3 的 `wsl --version` 正常。 |

## 第二部分：启动本系统

### 步骤 5：解压安装包

1. 把安装包 zip 放到本机的磁盘上，**不要放进共享盘或云同步目录**（如 OneDrive）。
2. 在 zip 上点右键，选“全部解压缩…”，解压到一个**路径短、本机磁盘上**的目录，例如 `D:\RedNote\`。**不要在压缩包预览窗口里直接双击 `启动.bat`**，那样脚本找不到旁边的文件。
3. 解压后检查：目录里应该有 `启动.bat`、`停止.bat`、`run.ps1`、`compose.offline.yml`、`VERSION.txt` 等文件，以及一个 `images` 文件夹，里面有两个 `.tar` 文件（一个约 550 MB，一个约 160 MB）。如果 `images` 里没有这两个大文件，说明解压不完整，请重新解压。
4. 如果资源管理器解压报错，可以改用 7-Zip 等解压工具。**所有文件要放在同一个文件夹里，不要单独移动其中某个文件。**

### 步骤 6：启动

1. 先确认 Docker Desktop **已经打开并显示运行中**。
2. 双击 **`启动.bat`**。首次启动要导入镜像，可能需要几分钟，请保持窗口打开，等窗口显示“已启动”，浏览器会自动打开 <http://localhost:8000>。启动本系统不需要联网，也不需要下载或构建。
3. **首次启动时，窗口会显示管理员账号和随机生成的管理员密码。请立刻复制并保存。**
4. 如果窗口提示“端口已被占用”，按本文末尾的“修改端口”处理；如果提示 Docker 未启动，打开 Docker Desktop 并等它显示运行中后重新双击。
5. macOS/Linux 同样提供启动脚本，用 `bash 启动.sh` 运行（这部分没有实机测试，见文末“验证范围”）。

### 步骤 7：登录

- 账号：`admin@example.com`
- 密码：首次启动时窗口里显示的那一串。如果错过了，在安装目录的隐藏文件 `.env` 里找 `FIRST_SUPERUSER_PASSWORD=` 那一行（在资源管理器里勾选“查看→显示→隐藏的项目”才能看到 `.env`）。

常见的登录失败原因：

- **输入了 `changethis`**。这不是本系统的密码，系统会拒绝这个默认口令。密码是每台电脑首次启动时随机生成的。
- 复制时多带了空格，或区分大小写的字母输错了。
- 在网页里改过密码后，`.env` 里的初始密码不会同步；忘记新密码，请联系管理员重置。

再次启动不会重置密码，也不会清除数据。

### 步骤 8：第一次使用

1. 刚装好的系统里**没有任何品牌**。管理员登录后，先在“品牌”页新建品牌（创建者自动成为该品牌的管理员），并在页面顶部切换到这个品牌。没有品牌、或不是该品牌的成员时，品牌下的功能无法使用，页面可能提示“找不到”。
2. **模型密钥**：管理员在网页的“设置 → 模型”里填写模型密钥。安装包里不含任何密钥。在填写之前，生成、爆款结构分析、语气推荐、上传资料后的索引等需要模型的功能都无法使用。没有填密钥时，管理员会看到“请到设置 → 模型填写”的提示，普通成员会看到“请联系管理员”。
3. 数据留在客户自己的电脑上，只有调用模型时，相关文本才会发往模型服务。模型功能需要联网和有效密钥。

### 出了错怎么看原因

1. 先看页面上的提示和“请求编号”。
2. 需要更多信息时，按 `F12` 打开浏览器的开发者工具，切到“网络（Network）”页，重现一次问题，找到**红色的请求**，点开后记下：请求地址、状态码（如 404、503）和“响应”里的内容。再切到“控制台（Console）”页，复制红色的错误文字。
3. 容器日志可以在 Docker Desktop 的“Containers”里打开 `rednote-app-1` 查看，也可以在安装目录的终端里运行 `docker compose -f compose.offline.yml logs --tail 100 app`。
4. 把以上信息发给交付人员时，**先去掉密码和密钥**，不要发送 `.env` 文件。

在安装目录打开终端的方法：在资源管理器里打开安装目录，点击上方的地址栏，输入 `powershell` 后按回车。

## 日常使用

### 停止与卸载

- **停止**：双击 **`停止.bat`**，数据保留在这台电脑上，下次双击 `启动.bat` 即可继续使用。（macOS/Linux：`bash 停止.sh`）
- **彻底清空数据**：Docker 把数据库保存在一个“数据卷”里，数据卷里的内容删了就没有了。仅仅删掉安装文件夹**不会**删除数据卷。确实要清空时，确认已经备份，再按“这台电脑以前装过本系统怎么办”里的直接 Docker 命令操作。这会删除全部本系统数据，无法恢复。最后再删除安装文件夹。

### 升级

1. 系统运行时，先按下面的命令备份。
2. 双击 `停止.bat`。
3. 把新安装包里的脚本、`images` 文件夹和版本文件，替换到原来的安装文件夹里；**保留原来的 `.env`**。
4. 再双击 `启动.bat`。启动和停止脚本会按 `VERSION.txt` 自动同步 `.env` 里的 `APP_TAG`（只改版本行，不会重新生成密码或密钥），窗口会显示版本变化。
5. 升级后，先运行一次启动，再**重新打开终端**执行手工命令，避免旧终端里残留的环境变量覆盖配置。不要修改项目名，也不要删除 Docker 数据卷。

### 备份与恢复

以下命令要在安装目录的终端里运行。首次启动后，`.env` 里已经有 `APP_TAG`，无需另行设置。备份文件直接从容器里复制出来，不经过终端重定向（Windows 终端的重定向会把文件弄坏）：

```text
docker compose -f compose.offline.yml exec -T db pg_dump -U postgres -Fc -f /tmp/backup.dump app
docker compose -f compose.offline.yml cp db:/tmp/backup.dump backup.dump
```

**恢复会覆盖现有数据，操作前先确认。** 把要恢复的 `backup.dump` 放到安装目录，先启动系统，再依次运行（只停应用，数据库保持运行）：

```text
docker compose -f compose.offline.yml stop app
docker compose -f compose.offline.yml cp backup.dump db:/tmp/backup.dump
docker compose -f compose.offline.yml exec -T db pg_restore -U postgres -d app --clean --if-exists --no-owner --exit-on-error /tmp/backup.dump
docker compose -f compose.offline.yml up -d --wait --pull never app
```

### 修改端口

如果提示端口被占用，或本机登录页打不开：用记事本打开安装目录里的 `.env`，修改其中这两行（示例端口 `8080` 须空闲）：

```text
APP_PORT=8080
PUBLIC_URL=http://localhost:8080
```

**这是要写进 `.env` 文件的内容，不是在终端里输入的命令。** 保存后重新双击启动。不要去停止不属于本系统的程序。启动脚本会先检查端口，再检查本机登录页；失败时保留容器供查看日志，不会自动清除数据。

### 这台电脑以前装过本系统怎么办

删除安装文件夹不会删除 Docker 中的数据卷。换目录解压新包时，如果没有原来的 `.env`，新生成的密码打不开旧数据库，因此启动会提前停止；如果 `.env` 被替换过，也可能出现数据库密码认证失败。脚本不会自动删除旧数据。

1. **想保留旧数据**：把以前安装目录里的 `.env` 复制到当前安装目录，再重新双击 `启动.bat`。找不到旧配置时，先联系管理员，不要清空数据。
2. **不需要旧数据，想从头开始**：先确认不再需要旧数据或已经备份。**必须在当前安装目录里打开终端**：资源管理器打开该目录，在地址栏输入 `powershell` 后回车；不要停在 `C:\WINDOWS\system32`。原样复制启动窗口中已填好项目名的三行 `docker` 命令，或在 PowerShell 里原样粘贴以下整段（不需要手填项目名或卷名）：

   ```powershell
   $project = (docker compose -f compose.offline.yml config --no-interpolate --format json | ConvertFrom-Json).name
   if ($LASTEXITCODE -ne 0 -or $project -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw '无法确定本系统项目名，请联系管理员，不要清空数据。' }
   docker ps -aq --filter "label=com.docker.compose.project=$project" | ForEach-Object { docker rm -f $_ }
   docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.volume=rednote-db-data' | ForEach-Object { docker volume rm $_ }
   docker network ls -q --filter "label=com.docker.compose.project=$project" | ForEach-Object { docker network rm $_ }
   ```

   **这会删除全部本系统旧数据，无法恢复。** 首行只读取不插值的项目名，不要求 `.env`；清理直接按项目标签选择本系统的容器、数据库卷和网络，不经过 Compose 的停止配置解析，不影响其他项目。确认每行命令均无报错后，再双击 `启动.bat`。如果当前目录已有 `.env`，继续使用它，不必重新生成密码。macOS/Linux 请使用 `启动.sh` 窗口打印的 Bash 版三行命令，不要粘贴 PowerShell 语法。

## 常见问题

| 现象 | 原因与做法 |
| --- | --- |
| 双击 `启动.bat` 一闪就没了，或提示找不到文件 | 可能是在压缩包预览里直接双击了。请先“全部解压缩”，并确认 `images` 文件夹里有两个 `.tar` 文件。 |
| 提示请先安装并打开 Docker Desktop | 打开 Docker Desktop，等它显示运行中后重新双击。 |
| 提示端口被占用 | 见上面的“修改端口”。 |
| 提示数据库密码认证失败，或应用一直 unhealthy | 可能是旧数据卷与当前 `.env` 的密码不一致，见“这台电脑以前装过本系统怎么办”；不是修改端口就能解决。 |
| 照旧写法清理时出现 `required variable ... is missing` | 某些 Compose 版本没有 `.env` 就无法解析旧的清理命令。请改用上面按项目标签筛选的直接 Docker 命令，不要填写临时密码，也不要反复运行旧命令。 |
| 首次启动很久 | 首次要导入约 700 MB 的镜像，请保持窗口打开等待。 |
| 输入 `changethis` 登录失败 | 这不是密码，见步骤 7。 |
| 爆款分析、生成、重新检查、语气推荐报错 | 这些功能都要调用模型。没有填模型密钥，或这台电脑连不上模型服务，就会报错。管理员先到“设置 → 模型”填写密钥，并确认电脑能联网。 |
| 页面提示找不到（404） | 可能还没有新建品牌，或没有切换到品牌。见步骤 8。其他情况按“出了错怎么看原因”收集信息。 |
| 想知道哪里出错了 | 见“出了错怎么看原因”。 |

## 验证范围

本说明和安装包的启动、登录、数据保留、备份恢复，仅在一台 Windows 电脑上做过检查。macOS/Linux 的启动脚本、真实模型下的生成效果、第二台电脑、物理断网环境，以及用配套的 Docker Desktop 4.98 安装器从零安装，都还没有验证。安装器选项的文字可能随 Docker Desktop 版本略有不同，以屏幕显示为准。
