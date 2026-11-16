"""Todo arquivo JavaScript do app precisa ao menos compilar.

Um parêntese a menos em `plans.js` deixou a tela de planos e o aviso de limite
mudos por semanas: o arquivo só é baixado no clique, então nada quebrava ao
abrir o app. Este teste roda `node --check` em cada módulo (pula sem Node).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ASSETS = Path(__file__).resolve().parents[1] / "kazer" / "interfaces" / "web" / "static" / "assets"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="Node.js não instalado")
@pytest.mark.parametrize("script", sorted(ASSETS.glob("*.js")), ids=lambda path: path.name)
def test_every_script_compiles(script: Path, tmp_path: Path) -> None:
    # `.mjs`: os arquivos usam import/export (módulos ES).
    copy = tmp_path / f"{script.stem}.mjs"
    copy.write_text(script.read_text(encoding="utf-8"), encoding="utf-8")
    result = subprocess.run(  # noqa: S603 - caminho fixo, sem entrada externa
        [str(NODE), "--check", str(copy)], capture_output=True, text=True, timeout=60
    )
    assert result.returncode == 0, result.stderr.splitlines()[:6]
