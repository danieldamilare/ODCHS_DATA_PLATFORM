import asyncio
import hashlib
import mimetypes
import os
from collections import defaultdict

import httpx

ASSET_CACHE_DIR = os.path.join(os.path.dirname(__file__), "asset_cache")
os.makedirs(ASSET_CACHE_DIR, exist_ok=True)

CACHEABLE_DOMAINS = (
    "https://odchc-his.org/",
    "https://fonts.googleapis.com/",
    "https://fonts.gstatic.com/",
)

CACHEABLE_RESOURCE_TYPES = {"stylesheet", "font", "image", "script"}
ABORT_SCRIPTS = True

_locks: "defaultdict[str, asyncio.Lock]" = defaultdict(asyncio.Lock)

_memory_cache: "dict[str, tuple[bytes, str]]" = {}


def _cache_path_for(url: str) -> str:
    ext = os.path.splitext(url.split("?")[0])[1] or ".bin"
    h = hashlib.sha256(url.encode()).hexdigest()
    return os.path.join(ASSET_CACHE_DIR, f"{h}{ext}")


async def _read_file(path: str) -> bytes:
    return await asyncio.to_thread(_read_file_sync, path)


def _read_file_sync(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _ctype_path_for(cache_path: str) -> str:
    return cache_path + ".ctype"


async def _write_content_type(cache_path: str, content_type: str) -> None:
    await asyncio.to_thread(
        _write_file_atomic_sync, _ctype_path_for(cache_path), content_type.encode()
    )


async def _read_content_type(cache_path: str) -> str | None:
    ctype_path = _ctype_path_for(cache_path)
    if not os.path.exists(ctype_path):
        return None
    data = await _read_file(ctype_path)
    return data.decode().strip() or None


async def _write_file_atomic(path: str, data: bytes) -> None:
    await asyncio.to_thread(_write_file_atomic_sync, path, data)


def _write_file_atomic_sync(path: str, data: bytes) -> None:
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)  #


def _content_type_for(path: str, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or fallback


async def _resolve_content_type(cache_path: str) -> str:
    stored = await _read_content_type(cache_path)
    if stored:
        return stored
    return _content_type_for(cache_path)


def _cache_headers(content_type: str) -> dict:
    return {
        "content-type": content_type,
        "cache-control": "public, max-age=31536000, immutable",
    }


async def setup_asset_caching(context, client: httpx.AsyncClient) -> None:
    """
    Installs one route handler on the given BrowserContext, shared by every
    page created from it. Caches vendor CSS/JS/fonts/images to disk so
    subsequent cards -- and subsequent runs -- don't refetch them.
    """

    async def handle_route(route):
        request = route.request
        url = request.url

        if not any(url.startswith(d) for d in CACHEABLE_DOMAINS):
            await route.continue_()
            return

        if ABORT_SCRIPTS and request.resource_type == "script":
            await route.abort()
            return

        if request.resource_type not in CACHEABLE_RESOURCE_TYPES:
            await route.continue_()
            return

        cached = _memory_cache.get(url)
        if cached is not None:
            body, content_type = cached
            await route.fulfill(
                status=200, body=body, headers=_cache_headers(content_type)
            )
            return

        cache_path = _cache_path_for(url)

        if os.path.exists(cache_path):
            body = await _read_file(cache_path)
            content_type = await _resolve_content_type(cache_path)
            _memory_cache[url] = (body, content_type)
            await route.fulfill(
                status=200,
                body=body,
                headers=_cache_headers(content_type),
            )
            return

        async with _locks[url]:
            cached = _memory_cache.get(url)
            if cached is not None:
                body, content_type = cached
                await route.fulfill(
                    status=200, body=body, headers=_cache_headers(content_type)
                )
                return

            if os.path.exists(cache_path):
                body = await _read_file(cache_path)
                content_type = await _resolve_content_type(cache_path)
                _memory_cache[url] = (body, content_type)
                await route.fulfill(
                    status=200,
                    body=body,
                    headers=_cache_headers(content_type),
                )
                return

            try:
                resp = await client.get(url, timeout=15.0)
                if resp.status_code == 200:
                    content_type = resp.headers.get(
                        "content-type", _content_type_for(cache_path)
                    )
                    await _write_file_atomic(cache_path, resp.content)
                    await _write_content_type(cache_path, content_type)
                    _memory_cache[url] = (resp.content, content_type)
                    await route.fulfill(
                        status=200,
                        body=resp.content,
                        headers=_cache_headers(content_type),
                    )
                else:
                    await route.continue_()
            except Exception:
                await route.continue_()

    await context.route("**/*", handle_route)
