"""HTTP client for a Naro remote Environment."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class HttpEnvironment:
    """Client for `serveEnvironment` (POST /execute, GET /state, GET /health)."""

    def __init__(
        self,
        url: str,
        *,
        token: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health")

    def state(self) -> dict[str, Any]:
        return self._request("GET", "/state")

    def execute(
        self,
        action: dict[str, Any],
        ctx: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"action": action}
        if ctx is not None:
            body["ctx"] = ctx
        return self._request("POST", "/execute", body)

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"}
        if self.token is not None:
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(
            f"{self.url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:200]
            raise RuntimeError(f"HTTP {e.code}: {detail}") from e
