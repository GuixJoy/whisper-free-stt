"""Dictionary REST endpoints."""

from typing import Optional

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, Field

from stt.history import get_store

router = APIRouter(prefix="/api/dictionary", tags=["dictionary"])


class CreateEntryRequest(BaseModel):
    phrase: str = Field(..., min_length=1, max_length=60)
    replacement: str = Field(..., min_length=1, max_length=60)
    category: str = Field(default="custom")
    notes: str = Field(default="")


class UpdateEntryRequest(BaseModel):
    phrase: Optional[str] = Field(default=None, max_length=60)
    replacement: Optional[str] = Field(default=None, max_length=60)
    category: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


class ImportCSVRequest(BaseModel):
    csv_text: str = Field(..., min_length=1)


@router.get("")
def list_entries(
    search: str = Query(default=""),
    category: str = Query(default=""),
    favorite: bool = Query(default=False),
):
    return get_store().list_dictionary(
        search=search, category=category, favorite_only=favorite
    )


@router.get("/replacements")
def get_replacements():
    return get_store().get_dict_replacements()


@router.get("/hotwords")
def get_hotwords():
    words = get_store().get_dict_hotwords()
    return {"hotwords": words}


@router.get("/{entry_id}")
def get_entry(entry_id: int):
    entry = get_store().get_dictionary_entry(entry_id)
    if entry is None:
        return {"error": "not found", "id": entry_id}
    return entry


@router.post("")
def create_entry(body: CreateEntryRequest):
    entry = get_store().add_dictionary_entry(
        phrase=body.phrase,
        replacement=body.replacement,
        category=body.category,
        notes=body.notes,
    )
    if entry is None:
        return {"error": "duplicate or invalid", "phrase": body.phrase}
    return entry


@router.put("/{entry_id}")
def update_entry(entry_id: int, body: UpdateEntryRequest):
    entry = get_store().update_dictionary_entry(
        entry_id=entry_id,
        phrase=body.phrase or "",
        replacement=body.replacement or "",
        category=body.category or "",
        notes=body.notes or "",
    )
    if entry is None:
        return {"error": "update failed", "id": entry_id}
    return entry


@router.delete("/{entry_id}")
def delete_entry(entry_id: int):
    ok = get_store().delete_dictionary_entry(entry_id)
    return {"deleted": ok, "id": entry_id}


@router.post("/{entry_id}/favorite")
def toggle_favorite(entry_id: int):
    new_state = get_store().toggle_dictionary_favorite(entry_id)
    if new_state is None:
        return {"error": "not found", "id": entry_id}
    return {"id": entry_id, "is_favorite": new_state}


@router.post("/import")
def import_csv(body: ImportCSVRequest):
    result = get_store().import_dictionary_csv(body.csv_text)
    return result


@router.get("/export/csv")
def export_csv():
    csv_text = get_store().export_dictionary_csv()
    return {"csv": csv_text}
