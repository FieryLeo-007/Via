"""DATA_MODE routing lives in one place so switching cache -> fixtures -> live is a
config change, not a code change.

- fixtures: always read fixtures/queries/*.json; never touch the cache or the network.
- hybrid:   cache -> fixtures -> live (CLAUDE.md §5).
- live:     cache -> live only (no fixture fallback).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from discovery.dedupe import title_tokens
from discovery.schemas import ShoppingIntent

DataMode = Literal["fixtures", "hybrid", "live"]
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "queries"

_FIXTURE_MATCH_THRESHOLD = 0.5


def get_data_mode() -> DataMode:
    mode = os.environ.get("DATA_MODE", "fixtures").strip().lower()
    if mode not in ("fixtures", "hybrid", "live"):
        raise ValueError(f"Invalid DATA_MODE={mode!r}; must be fixtures|hybrid|live")
    return mode  # type: ignore[return-value]


def _load_all_fixtures() -> list[dict]:
    if not FIXTURES_DIR.exists():
        return []
    fixtures = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        with path.open() as f:
            fixtures.append(json.load(f))
    return fixtures


def load_fixture(provider_name: str, intent: ShoppingIntent) -> list[dict] | None:
    """Best-effort match of an intent to a recorded fixture for this provider.
    Returns raw provider-shaped product dicts, or None if nothing matches well enough."""
    query_tokens = title_tokens(intent.query)
    best_score = 0.0
    best_products: list[dict] | None = None

    for fixture in _load_all_fixtures():
        if fixture.get("provider") != provider_name:
            continue
        fixture_tokens = title_tokens(fixture.get("query", ""))
        if not fixture_tokens or not query_tokens:
            continue
        overlap = len(query_tokens & fixture_tokens) / len(query_tokens | fixture_tokens)
        if overlap > best_score:
            best_score = overlap
            best_products = fixture.get("products", [])

    if best_score >= _FIXTURE_MATCH_THRESHOLD:
        return best_products
    return None
