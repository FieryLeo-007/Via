from pathlib import Path

import yaml

from agent.heuristics import extract_intent_heuristic

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def test_price_under():
    intent = extract_intent_heuristic("Noise-cancelling headphones under $200 for flights")
    assert intent.max_price_cents == 20000


def test_price_between():
    intent = extract_intent_heuristic("Insulated water bottle between $20 and $30")
    assert intent.min_price_cents == 2000
    assert intent.max_price_cents == 3000


def test_brand_exclusion():
    intent = extract_intent_heuristic("Noise-cancelling headphones under $200, not Beats")
    assert "Beats" in intent.brands_exclude


def test_min_rating():
    intent = extract_intent_heuristic("Blender for smoothies under $100, at least 4 stars")
    assert intent.min_rating == 4.0


def test_condition_keyword():
    intent = extract_intent_heuristic("Refurbished laptop under $500")
    assert intent.condition == "refurbished"


def test_sort_hint_cheapest():
    intent = extract_intent_heuristic("Cheapest wireless mouse")
    assert intent.sort_hint == "price_low"


def test_heuristic_meets_accuracy_target_on_golden_utterances():
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
        matches += ok

    accuracy = matches / len(cases)
    assert accuracy >= 0.70, f"heuristic accuracy {accuracy:.2%} below the 70% target"
