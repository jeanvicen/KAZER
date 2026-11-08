"""Harness de carga do voice gateway (protocolo kazer-voice/1).

Abre N sessões simultâneas, cada uma fala M vezes (tom sintético + silêncio),
pede uma fala de volta e mede: tempo até a transcrição final, tempo até o
primeiro áudio, interrupções e erros. Também testa rajada e reconexão.

ATENÇÃO: com motores falsos (padrão do gateway de teste) isto mede só o
transporte/orquestração. Números de STT/TTS reais exigem o gateway com
faster-whisper/Kokoro no hardware de produção.

Uso:
    KAZER_VOICE_TOKEN_SECRET=... python scripts/voice_load.py \\
        --url ws://127.0.0.1:8771/v1/voice --origin http://127.0.0.1:8770 \\
        --sessions 50 --turns 3
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import statistics
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import websockets  # noqa: E402

from kazer.voice import tokens  # noqa: E402

RATE = 16_000
FRAME_MS = 20


def frame(loud: bool) -> bytes:
    count = RATE * FRAME_MS // 1000
    if not loud:
        return bytes(count * 2)
    return struct.pack(
        f"<{count}h",
        *(int(0.3 * 32767 * math.sin(2 * math.pi * 220 * i / RATE)) for i in range(count)),
    )


async def session(index: int, args: argparse.Namespace, secret: str, stats: dict) -> None:
    token, _ = tokens.issue(secret, f"load-{index}")
    try:
        async with websockets.connect(args.url, origin=args.origin, max_size=2**20) as ws:
            await ws.send(
                json.dumps(
                    {
                        "type": "hello",
                        "protocol": "kazer-voice/1",
                        "token": token,
                        "audio": {"encoding": "pcm_s16le", "sample_rate": RATE, "channels": 1},
                    }
                )
            )
            ready = json.loads(await ws.recv())
            if ready.get("type") != "ready":
                stats["errors"].append(ready.get("code", "no_ready"))
                return
            for turn in range(args.turns):
                spoken_at = None
                # 700 ms de silêncio: o fim da fala cai no último quadro enviado.
                for chunk in [frame(True)] * 25 + [frame(False)] * 35:
                    await ws.send(chunk)
                    await asyncio.sleep(FRAME_MS / 1000 / args.speed)
                spoken_at = time.perf_counter()
                while True:
                    message = json.loads(await asyncio.wait_for(ws.recv(), 30))
                    if message.get("type") == "transcript":
                        stats["ttft"].append((time.perf_counter() - spoken_at) * 1000)
                        break
                asked = time.perf_counter()
                await ws.send(
                    json.dumps(
                        {
                            "type": "speak",
                            "id": f"{index}-{turn}",
                            "text": "Resposta curta para medir o primeiro áudio. Mais uma frase.",
                        }
                    )
                )
                first = True
                while True:
                    message = await asyncio.wait_for(ws.recv(), 30)
                    if isinstance(message, bytes):
                        if first:
                            stats["ttfa"].append((time.perf_counter() - asked) * 1000)
                            first = False
                        continue
                    if json.loads(message).get("type") == "audio_end":
                        break
                if args.interrupt:
                    await ws.send(
                        json.dumps(
                            {
                                "type": "speak",
                                "id": "x",
                                "text": "Frase longa para ser cortada. " * 5,
                            }
                        )
                    )
                    cut = time.perf_counter()
                    await ws.send(json.dumps({"type": "cancel"}))
                    while True:
                        message = await asyncio.wait_for(ws.recv(), 30)
                        if isinstance(message, str) and json.loads(message).get("type") in (
                            "audio_cancelled",
                            "audio_end",
                        ):
                            stats["cancel"].append((time.perf_counter() - cut) * 1000)
                            break
            stats["ok"] += 1
    except Exception as exc:  # noqa: BLE001
        stats["errors"].append(type(exc).__name__ + ":" + str(exc)[:60])


def pct(values: list[float], q: float) -> str:
    if not values:
        return "-"
    values = sorted(values)
    return f"{values[min(len(values) - 1, int(q * len(values)))]:.0f} ms"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8771/v1/voice")
    parser.add_argument("--origin", default="http://127.0.0.1:8770")
    parser.add_argument("--sessions", type=int, default=20)
    parser.add_argument("--turns", type=int, default=2)
    parser.add_argument(
        "--speed", type=float, default=1.0, help="acelera o envio de áudio (1 = tempo real)"
    )
    parser.add_argument("--interrupt", action="store_true")
    args = parser.parse_args()
    secret = os.environ.get("KAZER_VOICE_TOKEN_SECRET", "")
    if len(secret) < 32:
        sys.exit("defina KAZER_VOICE_TOKEN_SECRET (32+ caracteres), o mesmo do gateway")
    stats: dict = {"ok": 0, "errors": [], "ttft": [], "ttfa": [], "cancel": []}
    started = time.perf_counter()
    await asyncio.gather(*(session(i, args, secret, stats) for i in range(args.sessions)))
    elapsed = time.perf_counter() - started
    print(f"sessões ok: {stats['ok']}/{args.sessions} em {elapsed:.1f}s")
    print(
        f"fim da fala → transcrição: p50 {pct(stats['ttft'], 0.5)} p95 {pct(stats['ttft'], 0.95)}"
    )
    print(
        f"pedido de fala → 1º áudio: p50 {pct(stats['ttfa'], 0.5)} p95 {pct(stats['ttfa'], 0.95)}"
    )
    if stats["cancel"]:
        print(f"cancelamento: p50 {pct(stats['cancel'], 0.5)} p95 {pct(stats['cancel'], 0.95)}")
    errors: dict[str, int] = {}
    for item in stats["errors"]:
        errors[item] = errors.get(item, 0) + 1
    print("erros:", errors or "nenhum")
    if stats["ttft"]:
        print(f"média transcrição {statistics.mean(stats['ttft']):.0f} ms")


if __name__ == "__main__":
    asyncio.run(main())
