"""Confere o painel de controle (manutenção e aviso global) antes de salvar.

Uso, na raiz do repositório:

    python scripts/controle.py                 # confere controle-de-notificacao/controle.yaml
    python scripts/controle.py outro.yaml      # confere outro arquivo

Mostra o que vai acontecer no KAZER ou o erro exato (campo e motivo).
Sai com código 1 quando o arquivo tem erro (o CI usa isso).
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kazer.config.control import BRASILIA, DEFAULT_FILE, ControlError, read  # noqa: E402


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_FILE
    if not path.exists():
        print(f"Arquivo não encontrado: {path} (o KAZER trata como tudo desligado)")
        return 1
    try:
        state = read(path)
    except ControlError as exc:
        print(f"ERRO em {path.name}: {exc}")
        print("Enquanto o erro existir, o KAZER ignora o arquivo (tudo desligado).")
        return 1

    now = datetime.now(BRASILIA)
    m, n = state.maintenance, state.notice
    print(f"Arquivo OK: {path}")
    print()
    if m.active:
        print("MANUTENÇÃO: LIGADA  -> o KAZER está bloqueado")
        print(f"  título:   {m.title}")
        print(f"  mensagem: {m.message or '(vazia)'}")
        print(f"  previsão: {m.eta or '(não mostra)'}")
        print(f"  liberados: {len(m.allowed)} e-mail(s)")
    else:
        print("MANUTENÇÃO: desligada -> KAZER normal")
    print()
    if not n.active:
        print("AVISO GLOBAL: desligado")
    else:
        visible = n.visible(now)
        print(
            f"AVISO GLOBAL: ligado ({'aparecendo agora' if visible else 'fora da janela de tempo'})"
        )
        print(f"  id: {n.id}   tipo: {n.kind}   pode fechar: {'sim' if n.closable else 'não'}")
        print(f"  título:   {n.title or '(vazio)'}")
        print(f"  mensagem: {n.message or '(vazia)'}")
        if n.button_text:
            print(f"  botão:    {n.button_text} -> {n.button_link}")
        if n.start or n.end:
            fmt = "%Y-%m-%d %H:%M"
            start = n.start.strftime(fmt) if n.start else "já"
            end = n.end.strftime(fmt) if n.end else "sem fim"
            print(f"  janela:   {start} até {end} (Brasília)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
