"""Logging wrapper — uses kakashi if available, falls back to stdlib logging."""

import logging


class _FallbackLogger:
    """Stdlib logger wrapper that accepts both kakashi and stdlib-style logging."""

    def __init__(self, name: str):
        self._logger = logging.getLogger(name)

    def _log(self, level: int, msg: str, args: tuple, kwargs: dict):
        if args:
            try:
                formatted = msg % args
            except (TypeError, KeyError):
                formatted = f"{msg} {args}"
        else:
            formatted = msg
        if kwargs:
            fields = " ".join(f"{k}={v}" for k, v in kwargs.items())
            formatted = f"{formatted} {fields}"
        self._logger._log(level, formatted, ())

    def debug(self, msg: str, *args, **kwargs):
        self._log(logging.DEBUG, msg, args, kwargs)

    def info(self, msg: str, *args, **kwargs):
        self._log(logging.INFO, msg, args, kwargs)

    def warning(self, msg: str, *args, **kwargs):
        self._log(logging.WARNING, msg, args, kwargs)

    def error(self, msg: str, *args, **kwargs):
        self._log(logging.ERROR, msg, args, kwargs)

    def critical(self, msg: str, *args, **kwargs):
        self._log(logging.CRITICAL, msg, args, kwargs)


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
