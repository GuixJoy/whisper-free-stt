"""History REST endpoints."""

from fastapi import APIRouter, Query
from stt.history import get_store

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
def list_history(limit: int = Query(100, ge=1, le=1000)):
    """List recent transcripts."""
    return get_store().get_recent(limit)


@router.get("/search")
def search_history(q: str = Query(..., min_length=1), limit: int = Query(50, ge=1, le=500)):
    """Full-text search transcripts."""
    return get_store().search_history(q, limit)


@router.delete("/{entry_id}")
def delete_entry(entry_id: int):
    """Delete a transcript entry."""
    ok = get_store().delete_entry(entry_id)
    return {"deleted": ok, "id": entry_id}


@router.post("/{entry_id}/favorite")
def toggle_favorite(entry_id: int):
    """Toggle favorite status."""
    new_state = get_store().toggle_favorite(entry_id)
    return {"id": entry_id, "favorite": new_state}
