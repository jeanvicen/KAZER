#!/usr/bin/env python3
"""
kazer-code — run a test suite and record the before/after state.

Usage:
    python run_tests.py [--cmd "pytest -q"] [--label "billing"]

Prints a JSON summary that the KAZER assistant can cite in the report:

    {"label": "...", "command": "...", "total": 48, "passed": 46,
     "failed": 2, "duration_s": 6.1, "failures": ["..."]}

Recording the *initial* state before any change is what lets the assistant
distinguish pre-existing failures from regressions it introduced.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import time


def run_suite(command: str, timeout: int = 900) -> dict:
    started = time.time()
    try:
        completed = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {
            "command": command,
            "total": 0,
            "passed": 0,
            "failed": 0,
            "duration_s": round(time.time() - started, 1),
            "failures": ["timeout"],
            "timed_out": True,
        }

    output = f"{completed.stdout}\n{completed.stderr}"

    passed = len(re.findall(r"(?i)\b(\d+)\s+passed\b", output) and
                 [int(re.findall(r"(?i)\b(\d+)\s+passed\b", output)[0])] or [])
    failed_match = re.findall(r"(?i)\b(\d+)\s+failed\b", output)
    failed = int(failed_match[0]) if failed_match else 0

    failures = [
        line.strip()
        for line in output.splitlines()
        if re.match(r"^\s*(FAIL|✕|×)\s+\S+", line)
    ]

    return {
        "command": command,
        "total": passed + failed,
        "passed": passed,
        "failed": failed,
        "duration_s": round(time.time() - started, 1),
        "failures": failures[:20],
        "exit_code": completed.returncode,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a suite and report its state.")
    parser.add_argument("--cmd", default="pytest -q")
    parser.add_argument("--label", default="suite")
    args = parser.parse_args()

    result = run_suite(args.cmd)
    result["label"] = args.label
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
