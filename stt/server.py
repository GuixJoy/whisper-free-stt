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

from stt.config import AppConfig
from stt.history import get_store
from stt.routes.history import router as history_router
from stt.routes.insights import router as insights_router
from stt.routes.export import router as export_router


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
    print(f"[sio] client connected: {sid}", flush=True)


@sio.event
async def disconnect(sid: str):
    """Browser disconnected."""
    _browser_clients.discard(sid)
    print(f"[sio] client disconnected: {sid}", flush=True)


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
        await sio.emit("favorited", {"id": entry_id, "favorite": new_state}, to=sid)


@sio.event
async def delete_entry(sid: str, data: dict):
    """Handle delete request from browser."""
    entry_id = data.get("id") if isinstance(data, dict) else None
    if entry_id:
        get_store().delete_entry(entry_id)
        await sio.emit("deleted", {"id": entry_id}, to=sid)


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


@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Combined ASGI app (FastAPI + Socket.IO)
# ---------------------------------------------------------------------------

asgi_app = asyncplus(app, sio)
