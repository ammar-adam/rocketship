"""
Shared test fixtures.

Two hazards this file exists to neutralise:

1. `src/` is a plain package with no install config, so the repo root must be on
   sys.path.
2. `src/rocket_score.py` loads MACRO_TRENDS at import time from the *cwd-relative*
   path "data/macro_trends.json", with `except FileNotFoundError: MACRO_TRENDS = {}`.
   Run pytest from anywhere but the repo root and every macro score silently
   changes. Tests are pinned to the repo root; `test_macro_cwd.py` covers the
   hazard itself deliberately.
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


@pytest.fixture(autouse=True, scope="session")
def _pin_cwd_to_repo_root():
    """Every test runs from the repo root so MACRO_TRENDS resolves."""
    prev = os.getcwd()
    os.chdir(REPO_ROOT)
    yield
    os.chdir(prev)


@pytest.fixture
def macro_trends() -> dict:
    import json
    with open(os.path.join(REPO_ROOT, "data", "macro_trends.json"), encoding="utf-8") as f:
        return json.load(f)
