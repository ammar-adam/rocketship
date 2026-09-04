"""
.vercelignore must not exclude anything the Next.js build needs.

This existed as a real, week-shaped outage. `.vercelignore` patterns are
gitignore-style: unanchored, they match at ANY DEPTH. An entry of `src/`, added
to keep the Python source out of the upload, also matched `frontend/src/` - so
Vercel removed src/lib, src/fixtures and src/styles, and every git-triggered
build died with module-not-found on `@/src/...`.

It stayed hidden because `vercel --prod` from the CLI kept succeeding and the
production alias kept pointing at the last good deployment. The site looked
fine; the dashboard was solid red.

These tests encode the rule: root-only exclusions must be anchored, and the
paths the app actually imports must survive.
"""
from __future__ import annotations

import fnmatch
import io
import os

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERCELIGNORE = os.path.join(REPO_ROOT, ".vercelignore")

# Paths the Next.js build genuinely needs. If any becomes excluded, the build
# fails with a module-not-found that points at the importer, not at the cause.
REQUIRED = [
    "frontend/package.json",
    "frontend/next.config.ts",
    "frontend/tsconfig.json",
    "frontend/app/page.tsx",
    "frontend/app/layout.tsx",
    "frontend/app/evals/page.tsx",
    "frontend/src/lib/evals.ts",
    "frontend/src/lib/storage.ts",
    "frontend/src/lib/backend.ts",
    "frontend/src/lib/ids.ts",
    "frontend/src/lib/model.ts",
    "frontend/src/styles/tokens.css",
    "frontend/src/fixtures/evals/summary.json",
    "frontend/src/fixtures/evals/stage_a.json",
    "frontend/src/fixtures/evals/stage_a2.json",
    "frontend/src/fixtures/evals/stage_c.json",
    "frontend/src/fixtures/evals/head_to_head.json",
    "frontend/components/ui/Button.tsx",
    "frontend/components/evals/Uncertainty.tsx",
    "frontend/components/evals/StageChain.tsx",
]


def _patterns() -> list[str]:
    if not os.path.exists(VERCELIGNORE):
        return []
    out = []
    with io.open(VERCELIGNORE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                out.append(line)
    return out


def _ignored(path: str, pattern: str) -> bool:
    """
    Approximate gitignore matching, which is what Vercel applies.

    The rule that matters: a pattern WITHOUT a leading slash matches at every
    directory level, not only the root.
    """
    neg = pattern.startswith("!")
    pat = pattern[1:] if neg else pattern
    anchored = pat.startswith("/")
    pat = pat.lstrip("/").rstrip("/")

    segments = path.split("/")
    if anchored:
        candidates = ["/".join(segments[: i + 1]) for i in range(len(segments))]
    else:
        candidates = []
        for i in range(len(segments)):
            for j in range(i, len(segments)):
                candidates.append("/".join(segments[i : j + 1]))

    return any(c == pat or fnmatch.fnmatch(c, pat) for c in candidates)


def is_ignored(path: str) -> list[str]:
    return [p for p in _patterns() if not p.startswith("!") and _ignored(path, p)]


@pytest.mark.parametrize("path", REQUIRED)
def test_build_inputs_are_not_excluded(path):
    hits = is_ignored(path)
    assert not hits, (
        f"{path} is excluded by .vercelignore pattern(s) {hits}.\n"
        "Vercel will remove it from the upload and the build will fail with "
        "module-not-found pointing at whatever imports it. If the pattern was "
        "meant to match only the repo root, anchor it with a leading slash."
    )


def test_root_only_exclusions_are_anchored():
    """
    Any pattern that names a directory ALSO present under frontend/ must be
    anchored, or it silently takes the frontend copy too.
    """
    risky = {"src", "tests", "scripts", "components", "app", "lib",
             "public", "styles", "fixtures", "data", "cache", "results"}
    unanchored = []
    for p in _patterns():
        if p.startswith(("!", "*", "/")):
            continue
        name = p.rstrip("/").split("/")[0]
        if name in risky:
            unanchored.append(p)
    assert not unanchored, (
        "unanchored .vercelignore patterns that also exist under frontend/: "
        f"{unanchored}. Prefix each with '/' so it only matches the repo root."
    )


def test_the_python_side_is_still_excluded():
    """The exclusions must still do their job: the upload was 86MB without them."""
    for path in ["backend/main.py", "src/rocket_score.py", "evals/cache/ab/x.json",
                 "results/raw/full_debate__seed1.json", "tests/test_stats.py"]:
        assert is_ignored(path), f"{path} should be excluded from the Vercel upload"
