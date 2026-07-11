"""Equipment stock endpoint: the fixed catalog joined with live availability.

Read-only — assignments happen through the chatbot's ordering tools; this
endpoint feeds the UI's stock view (catalog, what's free, and which case
holds what).
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from periop.equipment import StockLevel

router = APIRouter()


@router.get("/equipment")
def stock(request: Request) -> list[StockLevel]:
    return request.app.state.equipment_store.stock_levels()
