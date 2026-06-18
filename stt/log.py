"""Logging wrapper — uses kakashi if available, falls back to stdlib logging."""

import logging


class _FallbackLogger:
    """Stdlib logger wrapper that accepts kakashi-style keyword arguments."""

    def __init__(self, name: str):
        self._logger = logging.getLogger(name)

    def _format_msg(self, msg: str, kwargs: dict) -> str:
        if kwargs:
            fields = " ".join(f"{k}={v}" for k, v in kwargs.items())
            return f"{msg} {fields}"
        return msg

    def debug(self, msg: str, **kwargs):
        self._logger.debug(self._format_msg(msg, kwargs))

    def info(self, msg: str, **kwargs):
        self._logger.info(self._format_msg(msg, kwargs))

    def warning(self, msg: str, **kwargs):
        self._logger.warning(self._format_msg(msg, kwargs))

    def error(self, msg: str, **kwargs):
        self._logger.error(self._format_msg(msg, kwargs))

    def critical(self, msg: str, **kwargs):
        self._logger.critical(self._format_msg(msg, kwargs))


try:
    from kakashi import get_logger as _kakashi_logger, setup_logging
    _HAS_KAKASHI = True
except ImportError:
    _HAS_KAKASHI = False
    setup_logging = None


def get_logger(name: str):
    """Get a logger — kakashi if available, stdlib fallback otherwise."""
    if _HAS_KAKASHI:
        return _kakashi_logger(name)
    return _FallbackLogger(name)


def setup_logger(service_name: str = "stt"):
    """Setup logging — kakashi if available, basicConfig otherwise."""
    if _HAS_KAKASHI and setup_logging:
        setup_logging("production", service_name=service_name)
    else:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        )
