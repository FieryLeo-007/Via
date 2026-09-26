"""F1 benchmark runner. Forces DATA_MODE=fixtures so the whole thing runs offline,
then writes bench/REPORT.md with the metrics table from CLAUDE.md's F1 spec.

Run: python -m bench.run_discovery   (or `make bench`)
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

os.environ["DATA_MODE"] = "fixtures"

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import yaml  # noqa: E402

from agent.heuristics import extract_intent_heuristic  # noqa: E402
from discovery import pipeline as pipeline_mod  # noqa: E402
from discovery.dedupe import title_tokens  # noqa: E402
from discovery.normalize import normalize_openwebninja  # noqa: E402
from discovery.providers.base import Provider  # noqa: E402
from discovery.schemas import ShoppingIntent  # noqa: E402

BENCH_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = ROOT / "fixtures"
REPORT_PATH = BENCH_DIR / "REPORT.md"


@dataclass
class Row:
    metric: str
    target: str
    actual: str
    passed: bool | None  # None = not measured (requires a live call)


def _load_golden_queries() -> list[dict]:
    with open(BENCH_DIR / "discovery.yaml") as f:
        return yaml.safe_load(f)


def bench_hard_constraints_and_dedupe() -> tuple[Row, Row, Row]:
    total_results = 0
    violations = 0
    dup_pairs = 0
    schema_failures = 0

    golden_queries = _load_golden_queries()
    for entry in golden_queries:
        try:
            intent = ShoppingIntent(**entry["intent"])
            result = pipeline_mod.search_products(intent)
        except Exception:  # noqa: BLE001 - a construction/pipeline failure IS a schema failure
            schema_failures += 1
            continue
        total_results += len(result.results)

        for product in result.results:
            if intent.max_price_cents is not None and product.price_cents > intent.max_price_cents:
                violations += 1
            if intent.min_price_cents is not None and product.price_cents < intent.min_price_cents:
                violations += 1
            if intent.min_rating is not None and (product.rating is None or product.rating < intent.min_rating):
                violations += 1
            excluded = {b.lower() for b in intent.brands_exclude}
            if product.brand and product.brand.lower() in excluded:
                violations += 1

        for a, b in combinations(result.results, 2):
            if a.brand and b.brand and a.brand.lower() != b.brand.lower():
                continue
            ta, tb = title_tokens(a.title), title_tokens(b.title)
            if ta and tb and len(ta & tb) / len(ta | tb) >= 0.9:
                dup_pairs += 1

    satisfaction_pct = 100.0 if total_results == 0 else 100.0 * (1 - violations / total_results)
    constraint_row = Row(
        "Hard-constraint satisfaction in results",
        "100%",
        f"{satisfaction_pct:.1f}% ({violations} violations / {total_results} results)",
        violations == 0,
    )
    dedupe_row = Row(
        "Duplicate pairs in top 12 (same brand, title similarity >= 0.9)",
        "0",
        str(dup_pairs),
        dup_pairs == 0,
    )
    schema_row = Row(
        "Intent schema validity",
        "100%",
        f"{schema_failures} construction failures across {len(golden_queries)} golden queries",
        schema_failures == 0,
    )
    return constraint_row, dedupe_row, schema_row


def bench_intent_extraction() -> Row:
    with open(FIXTURES_DIR / "utterances.yaml") as f:
        cases = yaml.safe_load(f)

    matches = 0
    for case in cases:
        intent = extract_intent_heuristic(case["utterance"])
        expected = case.get("expected", {})
        ok = True
        for field, expected_value in expected.items():
            actual_value = getattr(intent, field)
            if isinstance(expected_value, list):
                if sorted(v.lower() for v in actual_value) != sorted(v.lower() for v in expected_value):
                    ok = False
                    break
            elif actual_value != expected_value:
                ok = False
                break
        if ok:
            matches += 1

    pct = 100.0 * matches / len(cases)
    return Row(
        "Intent extraction exact match, heuristic fallback path (25 utterances)",
        "heuristic fallback >= 70% (LLM path >= 90%, not measured here — no live OpenAI call made)",
        f"{pct:.1f}% ({matches}/{len(cases)})",
        pct >= 70.0,
    )


def bench_search_latency() -> Row:
    samples_ms = []
    for entry in _load_golden_queries():
        intent = ShoppingIntent(**entry["intent"])
        for _ in range(5):
            start = time.monotonic()
            pipeline_mod.search_products(intent)
            samples_ms.append((time.monotonic() - start) * 1000)

    samples_ms.sort()
    p95 = samples_ms[int(len(samples_ms) * 0.95) - 1]
    return Row(
        "Search p95 (fixtures path, stands in for cached)",
        "< 1500 ms",
        f"{p95:.0f} ms over {len(samples_ms)} samples",
        p95 < 1500,
    )


def bench_partial_results() -> Row:
    class FastFakeProvider(Provider):
        name = "openwebninja"  # reuse the real normalizer

        def cache_params(self, intent):
            return {"q": intent.query}

        def raw_search(self, intent, timeout):
            return [{
                "product_id": "bench-1", "product_title": "Bench Test Widget",
                "price": "$19.99", "product_rating": 4.5, "product_num_reviews": 100,
                "product_page_url": "https://www.google.com/shopping/product/1",
                "product_photos": [], "store_name": "Bench Store",
            }]

    class SlowFakeProvider(Provider):
        name = "slowfake"

        def cache_params(self, intent):
            return {"q": intent.query}

        def raw_search(self, intent, timeout):
            time.sleep(timeout + 1)
            return []

    original_total_timeout = pipeline_mod.TOTAL_TIMEOUT_SECONDS
    original_provider_timeout = pipeline_mod.PROVIDER_TIMEOUT_SECONDS
    original_data_mode = os.environ.get("DATA_MODE")
    original_normalizers = dict(pipeline_mod._NORMALIZERS)
    pipeline_mod.TOTAL_TIMEOUT_SECONDS = 1.5
    pipeline_mod.PROVIDER_TIMEOUT_SECONDS = 1.0
    pipeline_mod._NORMALIZERS["slowfake"] = lambda raw: None
    os.environ["DATA_MODE"] = "live"

    try:
        intent = ShoppingIntent(query="bench widget")
        result = pipeline_mod.search_products(intent, providers=[FastFakeProvider(), SlowFakeProvider()])
        no_exception = True
    except Exception:  # noqa: BLE001
        result = None
        no_exception = False
    finally:
        pipeline_mod.TOTAL_TIMEOUT_SECONDS = original_total_timeout
        pipeline_mod.PROVIDER_TIMEOUT_SECONDS = original_provider_timeout
        pipeline_mod._NORMALIZERS.clear()
        pipeline_mod._NORMALIZERS.update(original_normalizers)
        if original_data_mode is None:
            os.environ.pop("DATA_MODE", None)
        else:
            os.environ["DATA_MODE"] = original_data_mode

    passed = no_exception and result is not None and result.partial and len(result.results) > 0
    detail = (
        f"partial={result.partial}, results={len(result.results)}, "
        f"sources={[(s.name, s.status) for s in result.sources]}"
        if result else "raised an exception"
    )
    return Row(
        "One provider forced to time out",
        "Partial results + banner, no error",
        detail,
        passed,
    )


def bench_prompt_injection() -> Row:
    import agent.llm as llm_mod

    def _explode(*args, **kwargs):
        raise AssertionError("extract_intent's LLM path was called during search_products")

    original = llm_mod.structured_completion
    llm_mod.structured_completion = _explode
    poisoned_titles = json.loads((FIXTURES_DIR / "poisoned_titles.json").read_text())

    try:
        raw_products = [
            {
                "product_id": f"poison-{i}", "product_title": title,
                "price": "$29.99", "product_rating": 4.0, "product_num_reviews": 50,
                "product_page_url": "https://www.google.com/shopping/product/x",
                "product_photos": [], "store_name": "Test Store",
            }
            for i, title in enumerate(poisoned_titles)
        ]
        products = [normalize_openwebninja(r) for r in raw_products]
        products = [p for p in products if p is not None]

        from discovery.rank import rank_products
        intent = ShoppingIntent(query="test product")
        ranked = rank_products(products, intent)

        no_llm_call_triggered = True
        reflected_unsafely = any(
            any(marker in reason for reason in rp.reasons for marker in ("<script", "{\"role\"", "<|im_start|>"))
            for rp in ranked
        )
    except AssertionError:
        no_llm_call_triggered = False
        reflected_unsafely = True
    finally:
        llm_mod.structured_completion = original

    passed = no_llm_call_triggered and not reflected_unsafely
    return Row(
        "Prompt-injection suite (10 poisoned product titles)",
        "0 tool calls or claims caused by product text",
        f"llm_called={not no_llm_call_triggered}, unsafe_reflection={reflected_unsafely}, "
        f"{len(poisoned_titles)} titles tested",
        passed,
    )


def render_report(rows: list[Row]) -> str:
    lines = [
        "# F1 · Product Discovery Engine — bench report",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M:%S %Z')} · DATA_MODE=fixtures (offline, no live calls)",
        "",
        "| Metric | Target | Actual | Result |",
        "|---|---|---|---|",
    ]
    for row in rows:
        icon = "not measured" if row.passed is None else ("✅ pass" if row.passed else "❌ FAIL")
        lines.append(f"| {row.metric} | {row.target} | {row.actual} | {icon} |")
    lines.append("")
    lines.append(
        "Live-only rows (search p95 on `DATA_MODE=live`, LLM-path intent-extraction accuracy) "
        "are not run here — this repo's convention is no live OpenWeb Ninja calls without an "
        "explicit ask, and OpenAI calls cost real quota too. Run with the relevant env vars set "
        "to fill those in."
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    constraint_row, dedupe_row, schema_row = bench_hard_constraints_and_dedupe()
    rows = [
        constraint_row,
        dedupe_row,
        bench_intent_extraction(),
        schema_row,
        bench_search_latency(),
        bench_partial_results(),
        bench_prompt_injection(),
    ]
    report = render_report(rows)
    REPORT_PATH.write_text(report)
    print(report)

    if any(row.passed is False for row in rows):
        sys.exit(1)


if __name__ == "__main__":
    main()
