"""Teste de carga do KAZER (HTTP), com contas sintéticas.

    python scripts/load_test.py --base http://127.0.0.1:8000 --users 5 --workers 40 --seconds 15

Mede o que o servidor web aguenta SEM o modelo de IA (o modelo é o gargalo real
em produção e depende da cota do provedor, não deste código). Cenários:

- `health`     GET /api/health                 (sem sessão, sem banco)
- `status`     GET /api/status                 (painel do dono; lê o arquivo em cache)
- `conversas`  GET /api/conversations          (sessão + banco)
- `cota`       GET /api/images                 (sessão + leitura da cota de imagens)
- `salvar`     PUT /api/designs/{id}           (sessão + escrita de ~20 kB)

Regras: use só contra ambiente local ou de teste, com contas de mentira. O
resultado vale para a máquina e o banco em que rodou; não é capacidade de produção.
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import threading
import time
from collections import defaultdict

import httpx

PASSWORD = "carga sintetica 12345"


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(pct / 100 * (len(ordered) - 1)))]


def account(base: str, index: int, stamp: int) -> tuple[httpx.Client, str]:
    client = httpx.Client(base_url=base, headers={"Origin": base}, timeout=20)
    email = f"carga-{stamp}-{index}@kazer.local"
    response = client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
    if response.status_code != 201:
        raise SystemExit(f"não consegui criar a conta de teste ({response.status_code})")
    document = json.dumps(
        {"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": {"objects": [{"t": "x" * 20000}]}}
    )
    created = client.post("/api/designs", json={"title": "carga", "data": document})
    design_id = created.json()["design"]["id"] if created.status_code == 201 else ""
    return client, design_id


def run(base: str, users: int, workers: int, seconds: float, scenarios: list[str]) -> dict:
    stamp = int(time.time())
    accounts = [account(base, index, stamp) for index in range(users)]
    document = json.dumps(
        {"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": {"objects": [{"t": "y" * 20000}]}}
    )
    report = {}
    for scenario in scenarios:
        times: list[float] = []
        codes: dict[int, int] = defaultdict(int)
        lock = threading.Lock()
        deadline = time.perf_counter() + seconds

        def worker(
            slot: int,
            scenario: str = scenario,
            deadline: float = deadline,
            lock: threading.Lock = lock,
            times: list[float] = times,
            codes: dict[int, int] = codes,
        ) -> None:
            _, design_id = accounts[slot % users]
            # Um cliente por thread (httpx.Client não é seguro entre threads), mesma sessão.
            client = httpx.Client(
                base_url=base,
                headers={"Origin": base},
                cookies=accounts[slot % users][0].cookies,
                timeout=20,
            )
            local_times, local_codes = [], defaultdict(int)
            while time.perf_counter() < deadline:
                started = time.perf_counter()
                try:
                    if scenario == "health":
                        code = client.get("/api/health").status_code
                    elif scenario == "status":
                        code = client.get("/api/status").status_code
                    elif scenario == "conversas":
                        code = client.get("/api/conversations").status_code
                    elif scenario == "cota":
                        code = client.get("/api/images").status_code
                    else:
                        code = client.put(
                            f"/api/designs/{design_id}", json={"title": "carga", "data": document}
                        ).status_code
                except httpx.HTTPError:
                    code = 0
                local_times.append((time.perf_counter() - started) * 1000)
                local_codes[code] += 1
            client.close()
            with lock:
                times.extend(local_times)
                for code, count in local_codes.items():
                    codes[code] += count

        began = time.perf_counter()
        threads = [threading.Thread(target=worker, args=(slot,)) for slot in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        elapsed = time.perf_counter() - began
        total = len(times)
        ok = sum(count for code, count in codes.items() if 200 <= code < 300)
        report[scenario] = {
            "requests": total,
            "rps": round(total / elapsed, 1),
            "ok_pct": round(100 * ok / total, 2) if total else 0.0,
            "p50_ms": round(percentile(times, 50), 1),
            "p95_ms": round(percentile(times, 95), 1),
            "p99_ms": round(percentile(times, 99), 1),
            "mean_ms": round(statistics.fmean(times), 1) if times else 0.0,
            "codes": dict(sorted(codes.items())),
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--users", type=int, default=5)
    parser.add_argument("--workers", type=int, default=40)
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument(
        "--scenarios",
        default="health,status,conversas,cota,salvar",
        help="lista separada por vírgula",
    )
    args = parser.parse_args()
    report = run(args.base, args.users, args.workers, args.seconds, args.scenarios.split(","))
    print(f"máquina: {platform.platform()} · Python {platform.python_version()}")
    print(f"alvo: {args.base} · {args.users} contas · {args.workers} conexões · {args.seconds}s")
    head = ("cenário", "req", "req/s", "ok %", "p50", "p95", "p99")
    print(f"{head[0]:<10}" + "".join(f" {column:>7}" for column in head[1:]) + "  códigos")
    for name, row in report.items():
        print(
            f"{name:<10} {row['requests']:>7} {row['rps']:>8} {row['ok_pct']:>7} {row['p50_ms']:>7}"
            f" {row['p95_ms']:>7} {row['p99_ms']:>7}  {row['codes']}"
        )


if __name__ == "__main__":
    main()
