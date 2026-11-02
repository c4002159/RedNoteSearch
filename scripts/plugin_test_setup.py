"""Prepare a local system for trying the browser extension on real note pages.

Run it against a backend on this computer (see docs/EXTENSION.md, "在自己电脑上试用"):

    python scripts/plugin_test_setup.py --note-url https://www.xiaohongshu.com/explore/<24 hex>

For every note address it makes one confirmed copy that carries that address (the extension finds
the copy by the note id in it), then makes an extension key and prints the connection string to
paste into the extension. It only uses the HTTP API and the standard library. The key is printed once,
on this screen; do not paste it into chat, a PR or an issue.

The copies are made with whatever model the backend is set to. With LLM_MODE=demo_fake in .env no
model key is needed. They are test data: use a database you do not mind filling with them.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

NOTE_PATH = re.compile(
    r"^/(?:explore|discovery/item|search_result|user/profile/[^/]+)/[0-9a-f]{24}/?$"
)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                name, value = line.split("=", 1)
                values[name.strip()] = value.strip().strip('"').strip("'")
    return values


class Api:
    def __init__(self, server: str) -> None:
        self.base = server.rstrip("/") + "/api/v1"
        self.token: str | None = None

    def call(self, method: str, path: str, body: object = None, form: bool = False):
        data = None
        headers = {}
        if body is not None:
            if form:
                data = urllib.parse.urlencode(body).encode()
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                data = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            self.base + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, {"raw": raw.decode("utf-8", "replace")[:300]}
        except urllib.error.URLError as error:
            sys.exit(f"连不上 {self.base}：{error.reason}。请先启动后端。")


def fail(what: str, status: int, payload: object) -> None:
    message = payload
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        message = payload["error"].get("message", payload)
    sys.exit(f"{what}失败（{status}）：{message}")


def settle_and_confirm(api: Api, version_id: str) -> None:
    """Answer the human-in-the-loop questions with a test note, then confirm the version."""
    status, evidence = api.call("GET", f"/generation-versions/{version_id}/evidence")
    if status != 200:
        fail("读取证据", status, evidence)
    open_claims = [
        e["id"] for e in evidence["items"] if e["status"] != "system_supported"
    ]
    if open_claims:
        status, payload = api.call(
            "POST",
            f"/generation-versions/{version_id}/evidence/confirm-batch",
            {
                "items": [
                    {"evidence_id": i, "human_confirmed": True, "note": "插件实测数据"}
                    for i in open_claims[:100]
                ]
            },
        )
        if status != 200:
            fail("记录人工确认", status, payload)
    status, risks = api.call("GET", f"/generation-versions/{version_id}/compliance")
    if status != 200:
        fail("读取风险提示", status, risks)
    for item in risks.get("items", []):
        if item.get("severity") == "block" and not item.get("resolved"):
            status, payload = api.call(
                "POST",
                f"/compliance-checks/{item['id']}/resolve",
                {"note": "插件实测数据"},
            )
            if status != 200:
                fail("处理风险提示", status, payload)
    status, payload = api.call(
        "POST",
        f"/generation-versions/{version_id}/confirm",
        {"selected_title_index": 0},
    )
    if status != 200:
        fail("确认文案", status, payload)


def make_copy(
    api: Api, brand_id: str, product_id: str, scenario_id: str, note_url: str
) -> str:
    status, task = api.call(
        "POST",
        "/tasks",
        {
            "brand_id": brand_id,
            "product_id": product_id,
            "scenario_id": scenario_id,
            "brief": "插件实测用的测试文案",
        },
    )
    if status != 201:
        fail("创建任务", status, task)
    status, payload = api.call("POST", f"/tasks/{task['id']}/generate")
    if status not in (200, 202):
        fail("开始生成", status, payload)
    deadline = time.time() + 300
    while time.time() < deadline:
        status, current = api.call("GET", f"/tasks/{task['id']}")
        if current["flow_status"] not in ("queued", "generating", "checking"):
            break
        time.sleep(2)
    if current.get("latest_version_id") is None or current["flow_status"] == "failed":
        sys.exit(
            f"生成没有成功（状态 {current['flow_status']}，{current.get('last_error')}）。"
        )
    version_id = current["latest_version_id"]
    settle_and_confirm(api, version_id)
    status, copies = api.call(
        "GET", f"/brands/{brand_id}/confirmed-copies?page_size=100"
    )
    copy = next((c for c in copies["items"] if c["version_id"] == version_id), None)
    if copy is None:
        sys.exit("确认之后没有找到对应的已确认文案。")
    status, payload = api.call(
        "PATCH", f"/confirmed-copies/{copy['id']}", {"post_url": note_url}
    )
    if status != 200:
        fail("保存帖子网址", status, payload)
    return copy["id"]


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    env = read_env(root / ".env")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--server", default="http://localhost:8000", help="本机后端地址"
    )
    parser.add_argument(
        "--note-url",
        action="append",
        required=True,
        help="要测的小红书笔记网址，可重复",
    )
    parser.add_argument(
        "--email", default=env.get("FIRST_SUPERUSER", "admin@example.com")
    )
    parser.add_argument("--password", default=env.get("FIRST_SUPERUSER_PASSWORD"))
    args = parser.parse_args()

    if not args.password:
        sys.exit(
            "找不到管理员密码：在仓库根目录的 .env 里设置 FIRST_SUPERUSER_PASSWORD，或加 --password。"
        )
    urls = []
    for raw in args.note_url:
        parsed = urllib.parse.urlparse(raw.strip())
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not (
            host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")
        ):
            sys.exit(f"不是小红书笔记网址：{raw}")
        if not NOTE_PATH.match(parsed.path):
            sys.exit(f"网址里没有 24 位笔记 id（/explore/<id> 这种）：{raw}")
        urls.append(
            f"https://{host}{parsed.path}"
        )  # the query can carry a token; drop it

    api = Api(args.server)
    status, login = api.call(
        "POST",
        "/login/access-token",
        {"username": args.email, "password": args.password},
        form=True,
    )
    if status != 200:
        fail("登录", status, login)
    api.token = login["access_token"]

    status, brands = api.call("GET", "/brands")
    if status != 200 or not brands["items"]:
        sys.exit(
            "没有品牌。先运行：cd backend && uv run python -m app.seed --fake-embeddings"
        )
    brand = next(
        (b for b in brands["items"] if b.get("slug") == "boitown-demo"),
        brands["items"][0],
    )
    status, products = api.call(
        "GET", f"/brands/{brand['id']}/products?status=active&page_size=5"
    )
    if status != 200 or not products["items"]:
        sys.exit("这个品牌下没有可用商品。")
    status, scenarios = api.call("GET", "/scenarios")
    if not scenarios["items"]:
        sys.exit(
            "没有场景模板。先运行：cd backend && uv run python -m app.initial_data（prestart.sh 会做这一步）"
        )
    scenario = next(
        (s for s in scenarios["items"] if s["name"] == "种草笔记"),
        scenarios["items"][0],
    )

    status, existing = api.call(
        "GET", f"/brands/{brand['id']}/confirmed-copies?page_size=100"
    )
    have = {c.get("post_url") for c in existing["items"]}
    for url in urls:
        if url in have:
            print(f"已有：{url}")
            continue
        print(f"生成并确认一篇测试文案，绑定 {url} ……")
        make_copy(api, brand["id"], products["items"][0]["id"], scenario["id"], url)

    status, key = api.call(
        "POST", f"/brands/{brand['id']}/extension-keys", {"label": "插件实测"}
    )
    if status != 201:
        fail("生成插件密钥", status, key)
    payload = json.dumps(
        {"s": args.server.rstrip("/"), "k": key["key"]}, separators=(",", ":")
    )
    config = "rnk1." + base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    print(
        "\n准备好了。把下面这一整串粘贴到插件的“连接设置”第一栏，点“使用配置并授权”。"
    )
    print("它含密钥，只显示这一次，不要发到聊天、PR 或 Issue。\n")
    print(config)
    print(
        f"\n已为 {len(urls)} 篇笔记准备了已确认文案。之后在 Chrome 里打开这些笔记，点“读取当前页面”。"
    )


if __name__ == "__main__":
    main()
