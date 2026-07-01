"""Pydantic request models for the KMV rating dashboard API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class RateRequest(BaseModel):
    ticker: str
    days: int = 400
    st_debt_fallback: Literal["strict", "zero", "curliab"] = "strict"
    horizon_days: float = 365.0
    fallback_rate: float = 0.045
