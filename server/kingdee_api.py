"""Standard-library client for the Kingdee K/3 Cloud WebAPI."""

from __future__ import annotations

import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


LOGIN_SERVICE = "Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc"
QUERY_SERVICE = "Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc"
MATERIAL_FIELDS = (
    "FMaterialId",
    "FNumber",
    "FName",
    "FSpecification",
    "FMaterialGroup.FNumber",
    "FMaterialGroup.FName",
    "FBaseUnitId.FName",
    "FDocumentStatus",
    "FForbidStatus",
)
MATERIAL_KEYS = (
    "id",
    "number",
    "name",
    "specification",
    "group_number",
    "group_name",
    "unit_name",
    "document_status",
    "forbid_status",
)


class KingdeeAPIError(RuntimeError):
    """A user-facing Kingdee connection or response error."""


def _filter_value(value: str) -> str:
    return value.replace("'", "''")


def material_filter(search: str = "", org_number: str = "100") -> str:
    prefixes = " OR ".join(f"FNumber LIKE '{prefix}%'" for prefix in range(21, 30))
    clauses = [f"({prefixes})"]
    if org_number.strip():
        clauses.append(f"FUseOrgId.FNumber = '{_filter_value(org_number.strip())}'")
    if search.strip():
        escaped = _filter_value(search.strip())
        clauses.append(f"(FNumber LIKE '%{escaped}%' OR FName LIKE '%{escaped}%')")
    return " AND ".join(clauses)


def rows_to_materials(rows: list[Any]) -> list[dict[str, Any]]:
    materials: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        padded = row[: len(MATERIAL_KEYS)] + [None] * max(0, len(MATERIAL_KEYS) - len(row))
        materials.append(dict(zip(MATERIAL_KEYS, padded)))
    return materials


def _api_error_message(value: Any) -> str:
    if isinstance(value, dict):
        response_status = value.get("Result", {}).get("ResponseStatus", {})
        errors = response_status.get("Errors") if isinstance(response_status, dict) else None
        if isinstance(errors, list):
            messages = [str(item.get("Message", "")) for item in errors if isinstance(item, dict)]
            if any(messages):
                return "；".join(message for message in messages if message)
        for key in ("Message", "message", "ErrorMessage", "MessageCode"):
            if value.get(key):
                return str(value[key])
    return "金蝶接口返回了无法识别的错误"


@dataclass(frozen=True)
class KingdeeCredentials:
    base_url: str
    dbid: str
    username: str
    appid: str
    app_secret: str
    lcid: int = 2052
    org_number: str = "100"


class KingdeeClient:
    def __init__(self, credentials: KingdeeCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._logged_in = False
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def _url(self, service: str) -> str:
        return urllib.parse.urljoin(self.credentials.base_url.rstrip("/") + "/", service)

    def _post(self, service: str, payload: Any) -> Any:
        body = json.dumps(
            {"parameters": payload}, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        request = urllib.request.Request(
            self._url(service),
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "fabview-kingdee/1.0",
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").strip()
            raise KingdeeAPIError(f"金蝶接口 HTTP {exc.code}: {detail[:300]}") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            raise KingdeeAPIError(f"无法连接金蝶服务：{reason}") from exc
        except OSError as exc:
            raise KingdeeAPIError(f"无法连接金蝶服务：{exc}") from exc
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            preview = raw.decode("utf-8", errors="replace").strip()[:300]
            raise KingdeeAPIError(f"金蝶接口未返回有效 JSON：{preview}") from exc

    def login(self) -> None:
        if self._logged_in:
            return
        credentials = self.credentials
        result = self._post(
            LOGIN_SERVICE,
            [
                credentials.dbid,
                credentials.username,
                credentials.appid,
                credentials.app_secret,
                credentials.lcid,
            ],
        )
        if not isinstance(result, dict) or str(result.get("LoginResultType", "")) != "1":
            raise KingdeeAPIError("登录失败：" + _api_error_message(result))
        self._logged_in = True

    def _query_rows(self, start_row: int, limit: int, search: str = "") -> list[Any]:
        self.login()
        query = {
            "FormId": "BD_MATERIAL",
            "FieldKeys": ",".join(MATERIAL_FIELDS),
            "FilterString": material_filter(search, self.credentials.org_number),
            "OrderString": "FNumber ASC",
            "StartRow": start_row,
            "Limit": limit,
        }
        result = self._post(QUERY_SERVICE, [query])
        if not isinstance(result, list):
            raise KingdeeAPIError("查询失败：" + _api_error_message(result))
        return result

    def query_materials(
        self,
        page: int = 1,
        page_size: int = 100,
        search: str = "",
    ) -> dict[str, Any]:
        rows = self._query_rows((page - 1) * page_size, page_size + 1, search)
        return {
            "items": rows_to_materials(rows[:page_size]),
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
        }

    def query_all_materials(
        self,
        batch_size: int = 1000,
        max_items: int = 50000,
    ) -> list[dict[str, Any]]:
        rows: list[Any] = []
        while len(rows) < max_items:
            batch = self._query_rows(len(rows), min(batch_size, max_items - len(rows)))
            rows.extend(batch)
            if len(batch) < batch_size:
                break
        if len(rows) >= max_items:
            raise KingdeeAPIError(f"物料数量超过同步上限 {max_items} 条，请缩小查询范围")
        return rows_to_materials(rows)
