"""Corrida real contra o Postgres local: várias sessões pedindo imagem ao mesmo tempo.

Chamado por `scripts/pg_test.sh` (usa a variável PSQL que ele exporta). Prova que:
1. com limite 1, de N pedidos simultâneos com chaves diferentes só UM reserva;
2. N pedidos simultâneos com a MESMA chave viram um pedido só.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

PSQL = shlex.split(os.environ["PSQL"]) + ["-At"]
PARALLEL = 12


def sql(text: str) -> str:
    done = subprocess.run(PSQL, input=text, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip())
    return done.stdout.strip()


def as_user(uid: str, call: str) -> dict:
    out = sql(
        f"select set_config('request.jwt.claim.sub', '{uid}', false);\n"
        "set role authenticated;\n"
        f"select {call};"
    )
    return json.loads(out.splitlines()[-1])


def new_user(tag: str) -> str:
    uid = sql(
        f"insert into auth.users (email) values ('{tag}@kazer.local') returning id;"
    ).splitlines()[0]
    sql(f"insert into public.profiles (id, email) values ('{uid}', '{tag}@kazer.local');")
    return uid


def main() -> int:
    racer = new_user("corrida.chaves")
    with ThreadPoolExecutor(PARALLEL) as pool:
        results = list(
            pool.map(
                lambda i: as_user(
                    racer,
                    f"public.kazer_image_reserve('corrida-{i:04d}', 'teste', 1024, 1024, 1)",
                ),
                range(PARALLEL),
            )
        )
    reserved = [r for r in results if r["job"] is not None]
    busy = [r for r in results if r["reason"] == "busy"]
    print(f"  chaves diferentes: {len(reserved)} reservou, {len(busy)} barrados de {PARALLEL}")
    if len(reserved) != 1 or len(busy) != PARALLEL - 1:
        return 1

    twin = new_user("corrida.mesma")
    with ThreadPoolExecutor(PARALLEL) as pool:
        results = list(
            pool.map(
                lambda _: as_user(
                    twin, "public.kazer_image_reserve('mesma-chave-01', 'teste', 1024, 1024, 1)"
                ),
                range(PARALLEL),
            )
        )
    ids = {r["job"]["id"] for r in results if r["job"]}
    fresh = [r for r in results if not r["replayed"]]
    print(
        f"  mesma chave: {len(ids)} pedido, {len(fresh)} criação,"
        f" {PARALLEL - len(fresh)} repetições"
    )
    if len(ids) != 1 or len(fresh) != 1 or any(r["job"] is None for r in results):
        return 1

    count = sql(
        f"select count(*) from public.kazer_image_jobs where user_id in ('{racer}', '{twin}');"
    )
    print(f"  linhas gravadas: {count} (esperado 2)")
    return 0 if count == "2" else 1


if __name__ == "__main__":
    sys.exit(main())
