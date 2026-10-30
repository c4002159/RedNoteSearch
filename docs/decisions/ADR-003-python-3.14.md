# ADR-003 Python 3.14 兼容性

状态：已确认保持 3.14（2026-10-30）；Windows 本地与 Linux CI（PR #3）均已验证模板依赖、迁移与测试。

## 背景
模板的 `backend/pyproject.toml` 要求 `requires-python = ">=3.14,<4.0"`，`.python-version` 为 3.14，后端 Dockerfile 基础镜像为 `python:3.14`，ruff 的 `target-version` 为 `py314`。因此降到更低版本需要改模板，不是默认路径。

## 验证（2026-10-30，Windows，Python 3.14.0，临时环境，未改动项目锁文件）
- 用模板的 `uv.lock` 同步依赖并导入成功：fastapi 0.141.1、sqlmodel 0.0.47、pydantic 2.13.5、psycopg 3.3.6、alembic、pyjwt、pwdlib。
- 本项目计划新增的库在 3.14 下安装并导入成功：pgvector（含 psycopg 适配器 `pgvector.psycopg.register_vector`）、regex 2026.9.29、pypdf、pdfplumber（pypdfium2 5.14.0）、python-docx 1.2.0、pyahocorasick 2.3.1、tenacity 9.2.1、jieba（仅源码发行，纯 Python，可用；分词示例正常）。
- 仅要求二进制包的“只解析”检查通过：模板依赖、上述库、pytest/coverage/ruff/mypy，以及 ragas 的依赖集合（未安装 ragas）。
- 字素簇计数：`regex` 的 `\X` 对“带组合重音的字母、ZWJ 家庭 emoji、笑脸 emoji、空格”计为 4，与预期一致。字数口径后来改为与发布页一致（ADR-004 修订），字素簇不再用于字数约束。

## Linux CI 验证（2026-10-30，PR #3 的 CI 运行）
- 运行环境：GitHub `ubuntu-latest`，日志显示 `Using CPython 3.14.9`（`test-backend` 与 `migrations` 两个 job）。
- `test-backend`：模板依赖安装、迁移到 head、模板测试套件通过。
- `migrations`（`pgvector/pgvector:pg18` 服务容器）：Alembic 只有 1 个 head；空库升级到 head；`vector` 扩展存在；downgrade 一步再升级，均通过。
- `test-docker-compose`：镜像构建、迁移、后端与前端健康检查通过。

## 仍未验证
- 本项目计划新增的库（pgvector 的 Python 包、regex、pypdf、pdfplumber、python-docx、pyahocorasick、tenacity、jieba）只在 Windows 本地验证过；CI 目前只安装了模板自带依赖，它们进入 `pyproject.toml` 后由 CI 在 Linux 上再验证。
- 向量列、HNSW 索引与全文索引的迁移尚未编写，因此索引未验证（嵌入维度见 ADR-006）。
- jieba 最近一次发布较早，仅用于可选的分词；若出现问题可去掉，不影响 P0。

## 决定
1. 保持 Python 3.14，用 uv 管理，所有人用 `uv` 拉取同一版本，避免本机 Python 差异。
2. 依赖由 `uv.lock` 固定；新增依赖须经 PR 并由持有依赖锁的成员（A）合并，PR 说明写明用途与许可证。
3. Python 小版本升级或锁文件整体升级，单独 PR，并重跑迁移与测试检查。
4. Phase 0 退出条件“Linux CI 跑通后端测试与迁移检查”已满足（见上）；新增依赖进入 `pyproject.toml` 后，若 3.14 出现无法解决的依赖问题，另立 ADR 讨论降级并同步修改模板配置。
