"""
No undefined names anywhere in the Python.

This shipped to production. Extracting the position-limit logic into
src/selection.py removed the block that defined MIN_BUY and MAX_BUY, but a
`final_buys[:MAX_BUY]` two lines further down survived the refactor. Python does
not notice until that line executes, so:

  - every import succeeded
  - the module compiled
  - 117 tests passed
  - the debate ran all four agents and the judge
  - and then the pipeline died with `name 'MAX_BUY' is not defined`,
    AFTER the API calls had been paid for

Only an end-to-end run caught it. A static check would have caught it in a
second, so here it is.

Deliberately narrow: this fails on F821 (undefined name) and F811 (redefinition)
only. Unused imports, unused locals and f-strings without placeholders are style,
and a test suite that fails on style gets disabled.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Codes worth failing a build over: a name that does not exist, or a definition
# silently shadowing another.
FATAL = ("undefined name", "redefinition of unused")

TARGET_DIRS = ["backend", "src", "evals", "tests"]
SKIP = {"__pycache__", ".venv", "venv", "node_modules"}

pyflakes = pytest.importorskip("pyflakes", reason="pyflakes not installed")


def _python_files() -> list[str]:
    out = []
    for d in TARGET_DIRS:
        root = os.path.join(REPO_ROOT, d)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if x not in SKIP]
            for fn in filenames:
                if fn.endswith(".py"):
                    out.append(os.path.join(dirpath, fn))
    return sorted(out)


def test_no_undefined_names():
    files = _python_files()
    assert files, "found no Python files to check"

    proc = subprocess.run(
        [sys.executable, "-m", "pyflakes", *files],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    lines = (proc.stdout + proc.stderr).splitlines()
    fatal = [ln for ln in lines if any(f in ln for f in FATAL)]

    assert not fatal, (
        "undefined or shadowed names - these raise only when the line runs, "
        "which for a pipeline can mean after the API calls are already paid for:\n  "
        + "\n  ".join(fatal)
    )


def test_the_check_actually_detects_an_undefined_name(tmp_path):
    """
    Guard against the guard being vacuous.

    If pyflakes ever stops reporting F821 in the format this test greps for,
    test_no_undefined_names would pass on a broken file and nobody would know.
    """
    bad = tmp_path / "bad_example.py"
    bad.write_text("def f(xs):\n    return xs[:NOT_DEFINED_ANYWHERE]\n", encoding="utf-8")

    proc = subprocess.run(
        [sys.executable, "-m", "pyflakes", str(bad)],
        capture_output=True, text=True,
    )
    out = proc.stdout + proc.stderr
    assert any(f in out for f in FATAL), (
        f"pyflakes no longer reports undefined names in the expected format: {out!r}"
    )
