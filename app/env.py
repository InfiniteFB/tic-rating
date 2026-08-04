"""Minimal .env loading, shared by the API server and the CLI scripts.

Lives apart from ``app.main`` so a script can pick up the same configuration
without importing FastAPI and constructing the whole application as a side
effect.
"""

from __future__ import annotations

import os
from pathlib import Path


def _unquote(value: str) -> str:
    """Strip a single matching pair of surrounding single/double quotes."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def load_dotenv(path: Path | None = None) -> None:
    """Minimal .env loader: sets os.environ[KEY]=VALUE for keys not already set.

    Reads with ``utf-8-sig`` so a UTF-8 BOM never corrupts the first key
    (otherwise the leading key becomes ``\\ufeffKEY`` and lookups miss).
    Strips a matching pair of surrounding quotes from values. Missing file
    is a no-op. Never prints any values.
    """
    candidate = path or (Path(__file__).resolve().parent.parent / ".env")
    if not candidate.is_file():
        return
    for line in candidate.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), _unquote(value.strip()))
