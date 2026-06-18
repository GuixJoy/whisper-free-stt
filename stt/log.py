"""Logging wrapper — uses kakashi if available, falls back to stdlib logging."""

import logging

try:
    from kakashi import get_logger as _kakashi_logger, setup_logging
    _HAS_KAKASHI = True
except ImportError:
    _HAS_KAKASHI = False
    setup_logging = None


def get_logger(name: str):
    """Get a logger — kakashi if available, stdlib otherwise."""
    if _HAS_KAKASHI:
        return _kakashi_logger(name)
    return logging.getLogger(name)


def setup_logger(service_name: str = "stt"):
    """Setup logging — kakashi if available, basicConfig otherwise."""
    if _HAS_KAKASHI and setup_logging:
        setup_logging("production", service_name=service_name)
    else:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        )
