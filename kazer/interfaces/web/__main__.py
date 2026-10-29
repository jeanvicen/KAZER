"""Executa a interface web localmente: `python -m kazer.interfaces.web`."""

import logging
import os

import uvicorn

from kazer.config.settings import load_settings
from kazer.interfaces.web.app import create_app


def main() -> None:
    """Sobe o servidor sem log de acesso (evita registrar IPs e caminhos por padrão)."""
    settings = load_settings()
    logging.basicConfig(level=settings.log_level)
    uvicorn.run(
        create_app(settings),
        host=os.environ.get("KAZER_HOST", "127.0.0.1"),
        port=int(os.environ.get("KAZER_PORT", "8000")),
        access_log=False,
        server_header=False,
    )


if __name__ == "__main__":
    main()
