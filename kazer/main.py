"""Ponto de composição da aplicação; sem lógica de negócio.

O comando `kazer` abre o KAZER no terminal. O servidor web sobe por
`python -m kazer.interfaces.web`.
"""

import sys

from kazer.interfaces.terminal.shell import main as terminal


def main() -> None:
    """Entrega o comando ao KAZER no terminal."""
    sys.exit(terminal())


if __name__ == "__main__":
    main()
