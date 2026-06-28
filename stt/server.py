"""FastAPI + Socket.IO server for STT application.

Combines REST API (history, insights, export) with real-time Socket.IO
for audio streaming and transcription events.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from socketio import AsyncServer
from asyncutilsx import asyncplus
from stt.log import setup_logger, get_logger

logger = get_logger(__name__)

# Setup logging at import time
setup_logger(service_name="stt-server")

from stt.config import AppConfig
from stt.history import get_store
from stt.routes.history import router as history_router
from stt.routes.insights import router as insights_router
from stt.routes.export import router as export_router
from stt.routes.dictionary import router as dictionary_router


# ---------------------------------------------------------------------------
# Socket.IO server
# ---------------------------------------------------------------------------

sio = AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# Audio queue for processing
_audio_queue: asyncio.Queue[np.ndarray] = asyncio.Queue()
_browser_clients: set[str] = set()


@sio.event
async def connect(sid: str, environ: dict):
    """Browser connected via Socket.IO."""
    _browser_clients.add(sid)
    logger.info("client connected: %s", sid)


@sio.event
async def disconnect(sid: str):
    """Browser disconnected."""
    _browser_clients.discard(sid)
    logger.info("client disconnected: %s", sid)


@sio.event
async def audio_chunk(sid: str, data: bytes):
    """Receive binary audio chunk from browser (float32 PCM, mono, 16kHz)."""
    audio = np.frombuffer(data, dtype=np.float32)
    if len(audio) > 0:
        await _audio_queue.put(audio)


@sio.event
async def get_history(sid: str, data: dict):
    """Handle history request from browser."""
    limit = data.get("limit", 100) if isinstance(data, dict) else 100
    rows = get_store().get_recent(limit)
    await sio.emit("history", {"rows": rows}, to=sid)


@sio.event
async def search_history(sid: str, data: dict):
    """Handle search request from browser."""
    query = data.get("query", "") if isinstance(data, dict) else ""
    rows = get_store().search_history(query)
    await sio.emit("history", {"rows": rows}, to=sid)


@sio.event
async def get_insights(sid: str):
    """Handle insights request from browser."""
    data = get_store().get_insights()
    await sio.emit("insights", {"data": data}, to=sid)


@sio.event
async def get_voice_intelligence(sid: str):
    """Handle voice intelligence request from browser."""
    data = get_store().get_voice_intelligence()
    await sio.emit("voice_intelligence", {"data": data}, to=sid)


@sio.event
async def export_history(sid: str, data: dict):
    """Handle export request from browser."""
    fmt = data.get("format", "csv") if isinstance(data, dict) else "csv"
    if fmt == "text":
        content = get_store().export_text()
        await sio.emit("export", {"text": content}, to=sid)
    else:
        content = get_store().export_csv()
        await sio.emit("export", {"csv": content}, to=sid)


@sio.event
async def toggle_favorite(sid: str, data: dict):
    """Handle favorite toggle from browser."""
    entry_id = data.get("id") if isinstance(data, dict) else None
    if entry_id:
        new_state = get_store().toggle_favorite(entry_id)
        if new_state is not None:
            await sio.emit("favorited", {"id": entry_id, "favorite": new_state}, to=sid)


@sio.event
async def delete_entry(sid: str, data: dict):
    """Handle delete request from browser."""
    entry_id = data.get("id") if isinstance(data, dict) else None
    if entry_id:
        get_store().delete_entry(entry_id)
        await sio.emit("deleted", {"id": entry_id}, to=sid)


@sio.event
async def get_dictionary(sid: str, data: dict):
    """Handle dictionary list request from browser."""
    search = data.get("search", "") if isinstance(data, dict) else ""
    category = data.get("category", "") if isinstance(data, dict) else ""
    favorite = data.get("favorite", False) if isinstance(data, dict) else False
    rows = get_store().list_dictionary(search=search, category=category, favorite_only=favorite)
    await sio.emit("dictionary", {"rows": rows}, to=sid)


@sio.event
async def add_dictionary_entry(sid: str, data: dict):
    """Handle dictionary add request from browser."""
    if not isinstance(data, dict):
        return
    entry = get_store().add_dictionary_entry(
        phrase=data.get("phrase", ""),
        replacement=data.get("replacement", ""),
        category=data.get("category", "custom"),
        notes=data.get("notes", ""),
    )
    if entry:
        await sio.emit("dictionary_added", {"entry": entry}, to=sid)
    else:
        await sio.emit("dictionary_error", {"error": "duplicate or invalid"}, to=sid)


@sio.event
async def update_dictionary_entry(sid: str, data: dict):
    """Handle dictionary update request from browser."""
    if not isinstance(data, dict):
        return
    entry_id = data.get("id")
    if not entry_id:
        return
    entry = get_store().update_dictionary_entry(
        entry_id=entry_id,
        phrase=data.get("phrase", ""),
        replacement=data.get("replacement", ""),
        category=data.get("category", ""),
        notes=data.get("notes", ""),
    )
    if entry:
        await sio.emit("dictionary_updated", {"entry": entry}, to=sid)
    else:
        await sio.emit("dictionary_error", {"error": "update failed"}, to=sid)


@sio.event
async def delete_dictionary_entry(sid: str, data: dict):
    """Handle dictionary delete request from browser."""
    entry_id = data.get("id") if isinstance(data, dict) else None
    if entry_id:
        ok = get_store().delete_dictionary_entry(entry_id)
        if ok:
            await sio.emit("dictionary_deleted", {"id": entry_id}, to=sid)
        else:
            await sio.emit("dictionary_error", {"error": "delete failed", "id": entry_id}, to=sid)


@sio.event
async def toggle_dictionary_favorite(sid: str, data: dict):
    """Handle dictionary favorite toggle from browser."""
    entry_id = data.get("id") if isinstance(data, dict) else None
    if entry_id:
        new_state = get_store().toggle_dictionary_favorite(entry_id)
        if new_state is not None:
            await sio.emit("dictionary_favorited", {"id": entry_id, "is_favorite": new_state}, to=sid)
        else:
            await sio.emit("dictionary_error", {"error": "not found", "id": entry_id}, to=sid)


@sio.event
async def import_dictionary_csv(sid: str, data: dict):
    """Handle dictionary CSV import from browser."""
    csv_text = data.get("csv_text", "") if isinstance(data, dict) else ""
    if csv_text:
        result = get_store().import_dictionary_csv(csv_text)
        await sio.emit("dictionary_imported", result, to=sid)


@sio.event
async def export_dictionary_csv(sid: str):
    """Handle dictionary CSV export request from browser."""
    csv_text = get_store().export_dictionary_csv()
    await sio.emit("dictionary_export", {"csv": csv_text}, to=sid)


# ---------------------------------------------------------------------------
# Public API for orchestrator to emit events
# ---------------------------------------------------------------------------

def emit_event(event_type: str, data: dict[str, Any]):
    """Emit an event to all connected browsers.

    Called from the orchestrator thread (sync context).
    Uses asyncio.run_coroutine_threadsafe to bridge sync→async.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(sio.emit(event_type, data))
        else:
            loop.run_until_complete(sio.emit(event_type, data))
    except RuntimeError:
        # No event loop running — try to get the running loop
        try:
            loop = asyncio.get_running_loop()
            asyncio.ensure_future(sio.emit(event_type, data))
        except RuntimeError:
            pass  # Server not started yet


def emit_audio_level(level: float):
    """Emit mic level to all browsers (throttled)."""
    emit_event("mic", {"level": round(level, 6)})


# ---------------------------------------------------------------------------
# FastAPI app with REST routes
# ---------------------------------------------------------------------------

app = FastAPI(
    title="STT — Speech to Text",
    description="Local-first speech-to-text API with real-time transcription",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(history_router)
app.include_router(insights_router)
app.include_router(export_router)
app.include_router(dictionary_router)


@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Combined ASGI app (FastAPI + Socket.IO)
# ---------------------------------------------------------------------------

asgi_app = asyncplus(app, sio)
