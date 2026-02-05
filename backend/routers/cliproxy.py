"""
CLIProxyAPI sidecar management endpoints and management API proxy.
"""
from __future__ import annotations

import asyncio
from typing import Iterable

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from core import cliproxy_service

router = APIRouter()

ALLOWED_MANAGEMENT_PATHS: Iterable[str] = {
    "api-keys",
    "openai-compatibility",
    "claude-api-key",
    "codex-api-key",
    "gemini-api-key",
    "vertex-api-key",
    "auth-files",
    "anthropic-auth-url",
    "codex-auth-url",
    "gemini-cli-auth-url",
    "antigravity-auth-url",
    "qwen-auth-url",
    "iflow-auth-url",
    "get-auth-status",
    "oauth-excluded-models",
    "oauth-model-alias",
    "latest-version",
}


def _path_allowed(path: str) -> bool:
    if not path:
        return False
    for allowed in ALLOWED_MANAGEMENT_PATHS:
        if path == allowed or path.startswith(f"{allowed}/"):
            return True
    return False


@router.get("/cliproxy/status")
async def cliproxy_status():
    return await asyncio.to_thread(cliproxy_service.status)


@router.post("/cliproxy/start")
async def cliproxy_start():
    await asyncio.to_thread(cliproxy_service.ensure_started)
    return {"status": "ok"}


@router.post("/cliproxy/stop")
async def cliproxy_stop():
    await asyncio.to_thread(cliproxy_service.stop)
    return {"status": "ok"}


@router.post("/cliproxy/restart")
async def cliproxy_restart():
    await asyncio.to_thread(cliproxy_service.restart)
    return {"status": "ok"}


@router.post("/cliproxy/upgrade")
async def cliproxy_upgrade():
    await asyncio.to_thread(cliproxy_service.upgrade)
    return {"status": "ok"}


@router.api_route(
    "/cliproxy/management/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def cliproxy_management_proxy(path: str, request: Request):
    if not _path_allowed(path):
        raise HTTPException(status_code=404, detail="Not found")

    if not cliproxy_service.is_running():
        await asyncio.to_thread(cliproxy_service.ensure_started)

    key = cliproxy_service.get_management_key()
    if not key:
        raise HTTPException(status_code=503, detail="CLIProxyAPI management key unavailable")

    base_url = cliproxy_service.management_base_url().rstrip("/")
    url = f"{base_url}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    body = await request.body()
    forward_headers = {
        "Authorization": f"Bearer {key}",
    }
    content_type = request.headers.get("content-type")
    if content_type:
        forward_headers["Content-Type"] = content_type
    accept = request.headers.get("accept")
    if accept:
        forward_headers["Accept"] = accept

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            request.method,
            url,
            content=body if body else None,
            headers=forward_headers,
        )

    response_headers = {}
    for header_name in ("content-type", "content-disposition", "x-cpa-version", "x-cpa-commit", "x-cpa-build-date"):
        if header_name in resp.headers:
            response_headers[header_name] = resp.headers[header_name]

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
    )
