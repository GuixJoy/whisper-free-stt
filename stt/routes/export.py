"""Export REST endpoints."""

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from stt.history import get_store

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/csv")
def export_csv():
    """Export history as CSV."""
    csv = get_store().export_csv()
    return PlainTextResponse(csv, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=stt-history.csv"})


@router.get("/text")
def export_text():
    """Export history as formatted text."""
    text = get_store().export_text()
    return PlainTextResponse(text, media_type="text/plain",
                             headers={"Content-Disposition": "attachment; filename=stt-history.txt"})
