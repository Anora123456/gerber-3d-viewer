#!/usr/bin/env python3
"""Local FABVIEW server with Kingdee configuration and material APIs."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import tempfile
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from .kingdee_api import KingdeeAPIError, KingdeeClient, KingdeeCredentials
except ImportError:
    from kingdee_api import KingdeeAPIError, KingdeeClient, KingdeeCredentials


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config.json"
MAX_BODY_BYTES = 64 * 1024
PUBLIC_FIELDS = (
    "base_url",
    "dbid",
    "username",
    "appid",
    "protocol",
    "lcid",
    "org_number",
)
DEFAULT_CONFIG: dict[str, Any] = {
    "base_url": "",
    "dbid": "",
    "username": "",
    "appid": "",
    "protocol": "v4",
    "lcid": "2052",
    "org_number": "100",
}


def read_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    if not path.exists():
        return dict(DEFAULT_CONFIG)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取配置文件：{exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("配置文件必须是 JSON 对象")
    return {**DEFAULT_CONFIG, **value}


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    result = {name: config.get(name, DEFAULT_CONFIG.get(name, "")) for name in PUBLIC_FIELDS}
    result["has_app_secret"] = bool(config.get("app_secret"))
    return result


def merge_config(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    result = dict(existing)
    for field in PUBLIC_FIELDS:
        if field in incoming:
            result[field] = str(incoming[field]).strip()
    secret = str(incoming.get("app_secret", ""))
    if secret:
        result["app_secret"] = secret

    required = ("base_url", "dbid", "username", "appid", "org_number")
    missing = [field for field in required if not result.get(field)]
    if missing:
        raise ValueError("请填写：" + "、".join(missing))
    if not result.get("app_secret"):
        raise ValueError("首次连接时需要填写 AppSecret")
    if result.get("protocol") not in {"v2", "v4"}:
        raise ValueError("登录协议只能是 v2 或 v4")
    if result.get("lcid") not in {"2052", "1033", "3076"}:
        raise ValueError("不支持该语言代码")
    if not result["base_url"].lower().startswith(("http://", "https://")):
        raise ValueError("服务地址必须以 http:// 或 https:// 开头")
    result["base_url"] = result["base_url"].rstrip("/") + "/"
    return result


def write_config(config: dict[str, Any], path: Path = DEFAULT_CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(config, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        temporary_path.replace(path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def credentials_from_config(config: dict[str, Any]) -> KingdeeCredentials:
    return KingdeeCredentials(
        base_url=str(config["base_url"]),
        dbid=str(config["dbid"]),
        username=str(config["username"]),
        appid=str(config["appid"]),
        app_secret=str(config["app_secret"]),
        lcid=int(config.get("lcid", 2052)),
        org_number=str(config.get("org_number", "100")),
    )


class FabViewHandler(BaseHTTPRequestHandler):
    server_version = "FABVIEW/1.0"

    @property
    def config_path(self) -> Path:
        return self.server.config_path  # type: ignore[attr-defined]

    @property
    def static_dir(self) -> Path:
        return self.server.static_dir  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def _send_json(self, value: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("请求长度无效") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("请求内容为空或过大")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求内容不是有效 JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("请求 JSON 必须是对象")
        return value

    def _saved_config(self) -> dict[str, Any]:
        config = read_config(self.config_path)
        missing = [
            field
            for field in ("base_url", "dbid", "username", "appid", "app_secret")
            if not config.get(field)
        ]
        if missing:
            raise ValueError("请先完成并保存金蝶连接配置")
        return config

    def _serve_static(self, request_path: str) -> None:
        relative = urllib.parse.unquote(request_path).lstrip("/") or "index.html"
        requested = (self.static_dir / relative).resolve()
        try:
            requested.relative_to(self.static_dir.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not requested.is_file():
            requested = self.static_dir / "index.html"
        try:
            body = requested.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "请先运行 npm run build")
            return
        content_type = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Cache-Control",
            "no-cache" if requested.name == "index.html" else "public, max-age=31536000, immutable",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/kingdee/config":
                self._send_json(public_config(read_config(self.config_path)))
                return
            if parsed.path == "/api/kingdee/materials":
                query = urllib.parse.parse_qs(parsed.query)
                page = int(query.get("page", ["1"])[0])
                page_size = int(query.get("page_size", ["100"])[0])
                search = query.get("search", [""])[0]
                if page < 1 or page_size not in {50, 100, 200} or len(search) > 100:
                    raise ValueError("查询分页参数无效")
                client = KingdeeClient(credentials_from_config(self._saved_config()))
                self._send_json(client.query_materials(page, page_size, search))
                return
            if parsed.path == "/api/kingdee/sync":
                started = time.perf_counter()
                client = KingdeeClient(credentials_from_config(self._saved_config()), timeout=45.0)
                items = client.query_all_materials()
                self._send_json({
                    "items": items,
                    "total": len(items),
                    "elapsed_ms": round((time.perf_counter() - started) * 1000),
                })
                return
            self._serve_static(parsed.path)
        except (ValueError, KingdeeAPIError) as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            if self.path == "/api/kingdee/config":
                config = merge_config(read_config(self.config_path), payload)
                write_config(config, self.config_path)
                self._send_json(public_config(config))
                return
            if self.path == "/api/kingdee/probe":
                config = merge_config(read_config(self.config_path), payload)
                started = time.perf_counter()
                client = KingdeeClient(credentials_from_config(config), timeout=15.0)
                sample = client.query_materials(1, 1)
                self._send_json({
                    "ok": True,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000),
                    "material_access": len(sample["items"]) > 0,
                })
                return
            self._send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
        except (ValueError, KingdeeAPIError) as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except OSError as exc:
            self._send_json({"error": f"本地配置写入失败：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("model/gltf-binary", ".glb")
    mimetypes.add_type("application/step", ".step")
    mimetypes.add_type("application/step", ".stp")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--static-dir", type=Path, default=PROJECT_ROOT / "dist")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), FabViewHandler)
    server.static_dir = args.static_dir.resolve()  # type: ignore[attr-defined]
    server.config_path = args.config.resolve()  # type: ignore[attr-defined]
    print(f"FABVIEW：http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
