"""
Every CSS custom property the frontend references must actually be declared.

This is not pedantry. `var(--color-accent)` with no fallback resolves to
*nothing*, so a rule like

    backgroundColor: 'var(--color-accent)', color: 'white'

renders a transparent button with white text - invisible on a white page. That
is exactly what happened to the primary "Run Full Debate" CTA: it referenced
--color-accent, --color-negative and --color-muted, none of which exist. The
real names are --color-accent-base, --color-error and --color-fg-muted.

Nothing catches this. It is not a type error, not a build error, and not a
runtime error - the page just renders wrong.
"""
from __future__ import annotations

import io
import os
import re

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(REPO_ROOT, "frontend")

SCAN_DIRS = ["app", "components", "src"]
SCAN_EXT = (".css", ".tsx", ".ts")

# Declared outside any CSS file the scanner can see.
ALLOWED_EXTERNAL = {
    "--color-success-muted",  # referenced with an explicit fallback
    # next/font injects these three onto <html> via a generated className, so
    # they are real at runtime but never appear in a .css source. Each is also
    # used inside a font stack ("var(--font-serif), Georgia, serif"), so an
    # undefined value degrades to the next family rather than to nothing -
    # which is why this is an allowlist entry and not a bug.
    "--font-sans",
    "--font-serif",
    "--font-mono",
}

VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)\s*(,|\))")
VAR_DECL = re.compile(r"^\s*(--[A-Za-z0-9_-]+)\s*:", re.MULTILINE)


def _files() -> list[str]:
    out = []
    for d in SCAN_DIRS:
        root = os.path.join(FRONTEND, d)
        for dirpath, _dirnames, filenames in os.walk(root):
            if "node_modules" in dirpath:
                continue
            for fn in filenames:
                if fn.endswith(SCAN_EXT):
                    out.append(os.path.join(dirpath, fn))
    return out


def _declared() -> set[str]:
    declared: set[str] = set()
    for path in _files():
        with io.open(path, encoding="utf-8", errors="replace") as f:
            declared.update(VAR_DECL.findall(f.read()))
    return declared


BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT = re.compile(r"^\s*//.*$", re.MULTILINE)


def _strip_comments(text: str) -> str:
    """
    Comments describe tokens; they do not reference them.

    Without this the test flags its own explanation of the bug - Button.tsx's
    docstring names --color-accent precisely to record that it does not exist.
    """
    return LINE_COMMENT.sub("", BLOCK_COMMENT.sub("", text))


def _used() -> dict[str, list[str]]:
    """token -> the files that reference it WITHOUT a fallback."""
    used: dict[str, list[str]] = {}
    for path in _files():
        with io.open(path, encoding="utf-8", errors="replace") as f:
            text = _strip_comments(f.read())
        for name, terminator in VAR_USE.findall(text):
            # `var(--x, fallback)` is safe even when --x is undefined.
            if terminator == ",":
                continue
            used.setdefault(name, []).append(os.path.relpath(path, FRONTEND))
    return used


@pytest.mark.skipif(not os.path.isdir(FRONTEND), reason="frontend/ not present")
def test_every_css_variable_used_is_declared():
    declared = _declared()
    used = _used()

    missing = {
        name: sorted(set(paths))
        for name, paths in used.items()
        if name not in declared and name not in ALLOWED_EXTERNAL
    }

    assert not missing, (
        "CSS custom properties referenced without a fallback but never declared.\n"
        "These resolve to nothing at runtime and render invisibly:\n"
        + "\n".join(f"  {n}  <- {', '.join(p)}" for n, p in sorted(missing.items()))
    )


@pytest.mark.skipif(not os.path.isdir(FRONTEND), reason="frontend/ not present")
def test_the_specific_tokens_that_broke_the_cta_stay_undeclared_and_unused():
    """
    --color-accent / --color-negative / --color-muted were never real. If one
    reappears in a rule, either someone declared it (fine, but then this test
    should be updated deliberately) or the old bug is back.
    """
    used = _used()
    for ghost in ("--color-accent", "--color-negative", "--color-muted", "--color-positive"):
        assert ghost not in used, (
            f"{ghost} is referenced again in {used.get(ghost)}. "
            "The real tokens are --color-accent-base, --color-error, --color-fg-muted."
        )


@pytest.mark.skipif(not os.path.isdir(FRONTEND), reason="frontend/ not present")
def test_both_dark_theme_blocks_define_the_same_tokens():
    """
    A viewer has three states: explicit light, explicit dark, and no stamp at
    all (the default, resolved only by prefers-color-scheme). A token defined in
    just one of the two dark blocks applies in only one of those states, which
    renders one theme's text on the other theme's ground.
    """
    path = os.path.join(FRONTEND, "src", "styles", "tokens.css")
    with io.open(path, encoding="utf-8") as f:
        css = f.read()

    attr = re.search(r"\[data-theme=['\"]dark['\"]\]\s*\{(.*?)\n\}", css, re.S)
    media = re.search(r"prefers-color-scheme:\s*dark\).*?\{(.*?)\n  \}", css, re.S)
    assert attr, "no [data-theme='dark'] block"
    assert media, "no prefers-color-scheme: dark block"

    a = set(VAR_DECL.findall(attr.group(1)))
    m = set(VAR_DECL.findall(media.group(1)))
    assert a == m, (
        "the two dark blocks disagree.\n"
        f"  only in [data-theme]: {sorted(a - m)}\n"
        f"  only in media query : {sorted(m - a)}"
    )
    # the families that were missing entirely before
    assert any("verdict" in t for t in a), "verdict colours must be themed for dark"
    assert any("chart" in t for t in a), "chart colours must be themed for dark"
