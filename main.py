"""Entrypoint shim — just defers to cli.main()."""

from stt.cli import main

if __name__ == "__main__":
    main()
