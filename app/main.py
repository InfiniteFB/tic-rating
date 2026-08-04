"""FastAPI application for the KMV rating dashboard.

Exposes the rating pipeline (``app.pipeline``) and LLM narration
(``app.llm``) over HTTP, plus serves the static single-page frontend.
"""

from __future__ import annotations

import os
from pathlib import Path

# Re-exported: callers (and tests) have long imported load_dotenv from here.
from app.env import load_dotenv  # noqa: F401

load_dotenv()

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
    except Exception as exc:  # noqa: BLE001
        # In-route catch: guarantees an immediate, identical {error, detail} 500
        # under any ASGI/TestClient config (TestClient defaults to
        # raise_server_exceptions=True, which would re-raise past the global
        # handler). Kept intentionally alongside the global handler below.
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
    # Production safety net for every other route: any unexpected exception
    # becomes the same {error, detail} 500 shape as the in-route catch above.
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": type(exc).__name__},
    )
