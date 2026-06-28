"""Insights REST endpoint."""

from fastapi import APIRouter
from stt.history import get_store

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("")
def get_insights():
    """Get analytics data for the Insights dashboard."""
    return get_store().get_insights()


@router.get("/voice-intelligence")
def get_voice_intelligence():
    """Get voice intelligence insights (most active day, productive hour, etc.)."""
    return get_store().get_voice_intelligence()
