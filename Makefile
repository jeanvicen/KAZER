.PHONY: setup lint typecheck test run web security-check

setup:
	python -m pip install -e ".[dev]"

lint:
	ruff check .

typecheck:
	mypy kazer tests

test:
	pytest

run:
	python -m kazer.main

web:
	@set -a; if [ -f .env ]; then . ./.env; fi; set +a; python -m kazer.interfaces.web

security-check:
	python -c "from pathlib import Path; assert not Path('.env').exists(), '.env não deve estar no repositório'; print('Verificação estrutural básica concluída; não substitui auditoria.')"
