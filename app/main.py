"""FastAPI application for the KMV rating dashboard.

Exposes the rating pipeline (``app.pipeline``) and LLM narration
(``app.llm``) over HTTP, plus serves the static single-page frontend.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader: sets os.environ[KEY]=VALUE for keys not already set."""
    for candidate in (Path(__file__).resolve().parent.parent / ".env",):
        if not candidate.is_file():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402

from app import llm, pipeline  # noqa: E402
from app.models import RateRequest  # noqa: E402

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="KMV Rating Dashboard")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"), media_type="text/html")


@app.get("/api/health")
def api_health() -> dict:
    return {
        "massive_key": bool(os.environ.get("MASSIVE_API_KEY", "").strip()),
        "llm": llm.health(),
    }


@app.post("/api/rate")
def api_rate(req: RateRequest):
    try:
        return pipeline.rate_ticker(**req.model_dump())
    except pipeline.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - surfaced as JSON, not re-raised
        return JSONResponse(
            status_code=500,
            content={"error": str(exc), "detail": type(exc).__name__},
        )


@app.post("/api/explain")
def api_explain(payload: dict) -> dict:
    return llm.explain(payload)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": type(exc).__name__},
    )
