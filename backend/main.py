import asyncio
import base64
import json
import logging
import os
import re
import time
from pathlib import PurePosixPath
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from backend.science import MAX_PRODUCT_BYTES, ProductError, analyze_pair, read_fits_plane, render_png

app = FastAPI(title="COSMIC LENS archive proxy")
cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET"],
    allow_headers=["Range"],
    expose_headers=["X-Fits-Metadata", "X-Fits-Image-Hdus", "Content-Disposition"],
)
SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
IRSA_HOST = "irsa.ipac.caltech.edu"
IRSA_PRODUCT_PREFIX = "/ibe/data/spherex/dr1/"
CACHE_SECONDS = 900
PRODUCT_CACHE_SECONDS = 900
PRODUCT_CACHE_MAX_BYTES = 256 * 1024 * 1024
_cache: dict[str, tuple[float, bytes]] = {}
_product_cache: dict[str, tuple[float, bytes]] = {}
_product_cache_size = 0
_cache_lock = asyncio.Lock()
_client: httpx.AsyncClient | None = None
logger = logging.getLogger(__name__)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def startup() -> None:
    global _client
    _client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0), follow_redirects=True)


@app.on_event("shutdown")
async def shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _validate_product_url(url: str) -> httpx.URL:
    parsed = httpx.URL(url)
    if (
        parsed.scheme != "https"
        or parsed.host != IRSA_HOST
        or not parsed.path.startswith(IRSA_PRODUCT_PREFIX)
        or parsed.query
        or parsed.fragment
        or PurePosixPath(parsed.path).suffix.lower() not in {".fits", ".fit", ".fz"}
    ):
        raise HTTPException(status_code=400, detail="Invalid SPHEREx DR1 product URL.")
    return parsed


async def _fetch_product(url: httpx.URL) -> bytes:
    global _product_cache_size
    cache_key = str(url)
    now = time.monotonic()
    async with _cache_lock:
        cached = _product_cache.get(cache_key)
        if cached and now - cached[0] < PRODUCT_CACHE_SECONDS:
            return cached[1]
        if cached:
            _product_cache_size -= len(cached[1])
            del _product_cache[cache_key]
    if _client is None:
        raise HTTPException(status_code=503, detail="IRSA archive proxy is not ready.")
    try:
        async with _client.stream("GET", url) as upstream:
            if not upstream.is_success:
                raise HTTPException(status_code=502, detail="Could not retrieve the IRSA product.")
            if upstream.url.host != IRSA_HOST or not upstream.url.path.startswith(IRSA_PRODUCT_PREFIX):
                raise HTTPException(status_code=502, detail="IRSA redirected the product to an unsupported location.")
            content_length = upstream.headers.get("content-length")
            if content_length and int(content_length) > MAX_PRODUCT_BYTES:
                raise HTTPException(status_code=413, detail="This product exceeds the supported download size.")
            content = bytearray()
            async for chunk in upstream.aiter_bytes():
                content.extend(chunk)
                if len(content) > MAX_PRODUCT_BYTES:
                    raise HTTPException(status_code=413, detail="This product exceeds the supported download size.")
            product = bytes(content)
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="IRSA product retrieval timed out.") from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Could not retrieve the IRSA product.") from error
    if len(product) <= PRODUCT_CACHE_MAX_BYTES:
        async with _cache_lock:
            previous = _product_cache.pop(cache_key, None)
            if previous:
                _product_cache_size -= len(previous[1])
            while _product_cache and _product_cache_size + len(product) > PRODUCT_CACHE_MAX_BYTES:
                oldest = min(_product_cache, key=lambda key: _product_cache[key][0])
                _product_cache_size -= len(_product_cache[oldest][1])
                del _product_cache[oldest]
            _product_cache[cache_key] = (time.monotonic(), product)
            _product_cache_size += len(product)
    return product


def _parse_collection_names(raw: str) -> list[str]:
    collections = [value.strip() for value in raw.split(',') if value and value.strip()]
    return collections or ["spherex_dr1"]


@app.get("/api/irsa/sia")
async def search_spherex(
    ra: float = Query(ge=0, le=360),
    dec: float = Query(ge=-90, le=90),
    radius: float = Query(default=0.1, gt=0, le=1),
    collections: str = Query(default="spherex_dr1", min_length=1, max_length=256),
    maxrec: int = Query(default=500, ge=1, le=1000),
) -> Response:
    selected_collections = _parse_collection_names(collections)
    cache_key = f"{ra:.5f}:{dec:.5f}:{radius:.5f}:{','.join(selected_collections)}:{maxrec}"
    now = time.monotonic()
    async with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and now - cached[0] < CACHE_SECONDS:
            return Response(cached[1], media_type="application/x-votable+xml", headers={"X-Archive-Cache": "HIT"})
        if cached:
            del _cache[cache_key]

    if _client is None:
        raise HTTPException(status_code=503, detail="IRSA archive proxy is not ready.")
    try:
        upstream = await _client.get(
            SIA_URL,
            params={
                "COLLECTION": ",".join(selected_collections),
                "POS": f"CIRCLE {ra} {dec} {radius}",
                "MAXREC": str(maxrec),
                "RESPONSEFORMAT": "VOTABLE",
            },
        )
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="IRSA did not respond before the search timed out.") from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Could not connect to the IRSA archive.") from error
    if not upstream.is_success:
        raise HTTPException(status_code=502, detail=f"IRSA search failed with status {upstream.status_code}.")

    content = upstream.content
    async with _cache_lock:
        _cache[cache_key] = (time.monotonic(), content)
        if len(_cache) > 256:
            oldest = min(_cache, key=lambda key: _cache[key][0])
            del _cache[oldest]
    return Response(content, media_type="application/x-votable+xml", headers={"X-Archive-Cache": "MISS"})


@app.get("/api/irsa/product")
async def get_spherex_product(
    request: Request,
    url: str = Query(min_length=1, max_length=2048),
) -> Response:
    parsed = _validate_product_url(url)
    range_header = request.headers.get("range")
    if range_header is None or not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="A byte range is required for product access.")
    try:
        start_text, end_text = range_header.removeprefix("bytes=").split("-", 1)
        start, end = int(start_text), int(end_text)
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=416, detail="Invalid product byte range.") from error
    if start < 0 or end < start or end - start + 1 > 32 * 1024 * 1024:
        raise HTTPException(status_code=416, detail="Requested product range is not supported.")
    if _client is None:
        raise HTTPException(status_code=503, detail="IRSA archive proxy is not ready.")
    try:
        upstream = await _client.get(url, headers={"Range": range_header})
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="IRSA product retrieval timed out.") from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Could not retrieve the IRSA product.") from error
    if upstream.status_code != 206:
        raise HTTPException(status_code=502, detail="IRSA did not return the requested product range.")
    headers = {
        key: upstream.headers[key]
        for key in ("content-range", "accept-ranges", "content-length")
        if key in upstream.headers
    }
    return Response(upstream.content, status_code=206, media_type="application/fits", headers=headers)


@app.get("/api/irsa/product/png")
async def get_spherex_png(
    url: str = Query(min_length=1, max_length=2048),
    hdu: int = Query(default=0, ge=0, le=64),
    plane: int = Query(default=0, ge=0, le=4095),
) -> Response:
    product = await _fetch_product(_validate_product_url(url))
    try:
        image = await asyncio.to_thread(read_fits_plane, product, hdu, plane)
        png = await asyncio.to_thread(render_png, image.data)
    except ProductError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Could not convert SPHEREx FITS product to PNG")
        raise HTTPException(status_code=500, detail="The FITS image could not be converted.") from error
    metadata = json.dumps(image.metadata, separators=(",", ":")).encode("utf-8")
    headers = {
        "X-Fits-Metadata": base64.b64encode(metadata).decode("ascii"),
        "X-Fits-Image-Hdus": ",".join(str(index) for index in image.hdu_indices),
        "Content-Disposition": f'inline; filename="{quote(PurePosixPath(_validate_product_url(url).path).stem)}.png"',
        "Cache-Control": "private, max-age=300",
    }
    return Response(png, media_type="image/png", headers=headers)


@app.get("/api/irsa/product/download")
async def download_spherex_product(url: str = Query(min_length=1, max_length=2048)) -> Response:
    parsed = _validate_product_url(url)
    product = await _fetch_product(parsed)
    filename = PurePosixPath(parsed.path).name
    return Response(
        product,
        media_type="application/fits",
        headers={"Content-Disposition": f'attachment; filename="{quote(filename)}"'},
    )


@app.get("/api/irsa/compare")
async def compare_spherex_products(
    earlier_url: str = Query(min_length=1, max_length=2048),
    later_url: str = Query(min_length=1, max_length=2048),
    earlier_date: str = Query(min_length=1, max_length=32),
    later_date: str = Query(min_length=1, max_length=32),
    earlier_hdu: int = Query(default=0, ge=0, le=64),
    later_hdu: int = Query(default=0, ge=0, le=64),
    earlier_plane: int = Query(default=0, ge=0, le=4095),
    later_plane: int = Query(default=0, ge=0, le=4095),
) -> dict[str, object]:
    earlier_product_url = _validate_product_url(earlier_url)
    later_product_url = _validate_product_url(later_url)
    earlier_band = PurePosixPath(earlier_product_url.path).parent.name
    later_band = PurePosixPath(later_product_url.path).parent.name
    earlier_bytes = await _fetch_product(earlier_product_url)
    later_bytes = await _fetch_product(later_product_url)
    try:
        return await asyncio.to_thread(
            analyze_pair,
            earlier_bytes,
            later_bytes,
            earlier_date=earlier_date,
            later_date=later_date,
            earlier_band=earlier_band,
            later_band=later_band,
            earlier_hdu=earlier_hdu,
            later_hdu=later_hdu,
            earlier_plane=earlier_plane,
            later_plane=later_plane,
        )
    except ProductError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Could not analyze SPHEREx FITS product pair")
        raise HTTPException(status_code=500, detail="The observations could not be analyzed.") from error


distribution = Path(__file__).resolve().parent.parent / "dist"
if distribution.is_dir():
    app.mount("/", StaticFiles(directory=distribution, html=True), name="frontend")
