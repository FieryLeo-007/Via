from typing import Optional

import pytest

import json

from agent.compare import ComparisonOutput, ProductTake, _normalize_preferences, compare_products, short_name
from agent.llm import to_strict_schema
from agent.tools import ToolError, dispatch
from app import app
from discovery.schemas import RankedProduct, ScoreBreakdown, ShoppingIntent

INTENT = ShoppingIntent(query="wireless headphones", max_price_cents=20000)


def _product(i: int, price: int = 5000, rating: Optional[float] = 4.5, reviews: int = 100, title: Optional[str] = None, **extra) -> RankedProduct:
    score = 1.0 - i * 0.1
    return RankedProduct(
        id=f"src:{i}", source="src", source_id=str(i), title=title or f"Headphones {i}", **extra,
        price_cents=price, rating=rating, rating_count=reviews, score=score,
        breakdown=ScoreBreakdown(relevance=1, constraint_fit=1, quality=1, priority_fit=0.5, base=score, score=score),
        reasons=[f"reason {i}"],
    )


def _llm(monkeypatch, output, calls=None):
    def fake(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        return output
    monkeypatch.setattr("agent.compare.structured_completion", fake)


def _take(key: str, best_for: str = "Long flights", name: Optional[str] = None) -> ProductTake:
    return ProductTake(id=key, short_name=name or f"Name {key}", best_for=best_for, pros=["Strong ANC"], cons=["Pricey"])


def _payload(calls) -> dict:
    return json.loads(calls[0]["user_content"])


def test_ai_comparison_maps_keys_to_product_ids(monkeypatch):
    calls = []
    output = ComparisonOutput(winner_id="c2", verdict="Headphones 1 wins on value.", takes=[_take("c1"), _take("c2", "Budget travel")])
    _llm(monkeypatch, output, calls)
    out = compare_products([_product(0), _product(1)], INTENT, "headphones for flights")

    assert out.source == "ai"
    assert out.winner_id == "src:1"
    assert [take.id for take in out.takes] == ["src:0", "src:1"]
    assert out.takes[1].best_for == "Budget travel"
    assert "flights" in calls[0]["user_content"]
    assert calls[0]["reasoning_effort"] == "medium"
    assert out.takes[0].short_name == "Name c1"


def test_unknown_duplicate_and_missing_takes_fall_back_to_rules(monkeypatch):
    takes = [_take("c1", "First"), _take("c1", "Duplicate"), _take("c99"), _take("c2", "   ")]
    _llm(monkeypatch, ComparisonOutput(winner_id="c1", verdict="Pick the first.", takes=takes))
    products = [_product(0, price=9000), _product(1, price=3000), _product(2, price=6000)]
    out = compare_products(products, INTENT, "headphones")

    assert out.source == "ai"
    assert [take.id for take in out.takes] == ["src:0", "src:1", "src:2"]
    assert out.takes[0].best_for == "First"
    assert out.takes[1].best_for == "Lowest price"
    assert out.takes[2].pros == ["reason 2"]


def test_points_are_trimmed_and_capped(monkeypatch):
    take = ProductTake(id="c1", short_name="Sony", best_for="Travel", pros=["  a  ", "", "b", "B!", "c", "d"], cons=["x" * 300, "a"])
    _llm(monkeypatch, ComparisonOutput(winner_id="c1", verdict="Pick it.", takes=[take]))
    out = compare_products([_product(0), _product(1)], INTENT)

    # Duplicates are dropped within a take, including a con that repeats a pro.
    assert out.takes[0].pros == ["a", "b", "c"]
    assert len(out.takes[0].cons) == 1
    assert len(out.takes[0].cons[0]) <= 140 and out.takes[0].cons[0].endswith("…")


def test_ids_in_prose_are_replaced_with_short_names(monkeypatch):
    takes = [_take("c1", name="Sony XM5"), ProductTake(id="c2", short_name="c2", best_for="Cheaper than c1", pros=["Beats C1 on price"], cons=[])]
    _llm(monkeypatch, ComparisonOutput(winner_id="c1", verdict="c1 beats c2 on rating.", takes=takes))
    out = compare_products([_product(0), _product(1, title="Anker Q30 Headphones")], INTENT)

    assert out.verdict == "Sony XM5 beats Anker Q30 Headphones on rating."
    assert out.takes[1].short_name == "Anker Q30 Headphones"
    assert out.takes[1].best_for == "Cheaper than Sony XM5"
    assert out.takes[1].pros == ["Beats Sony XM5 on price"]


def test_winner_breaking_a_constraint_is_rejected(monkeypatch):
    # c1 is over the $200 budget while c2 fits, so the model's pick can't be trusted.
    _llm(monkeypatch, ComparisonOutput(winner_id="c1", verdict="Pick c1.", takes=[_take("c1"), _take("c2")]))
    out = compare_products([_product(0, price=25000), _product(1, price=15000)], INTENT)

    assert out.source == "rules"
    assert out.winner_id == "src:1"


def test_over_budget_winner_allowed_when_nothing_fits(monkeypatch):
    _llm(monkeypatch, ComparisonOutput(winner_id="c2", verdict="Pick c2.", takes=[_take("c1"), _take("c2")]))
    out = compare_products([_product(0, price=25000), _product(1, price=30000)], INTENT)

    assert out.source == "ai" and out.winner_id == "src:1"


def test_payload_carries_computed_facts(monkeypatch):
    calls = []
    _llm(monkeypatch, None, calls)
    products = [
        _product(0, price=19000, rating=4.7, reviews=2000, title="Sony WH-1000XM5 Wireless Headphones - Black", free_shipping=True),
        _product(1, price=19800, rating=4.7, reviews=2000, title="Sony WH-1000XM5 Wireless Headphones", free_shipping=True),
        _product(2, price=25000, rating=4.4, reviews=100, title="Bose QC 45", free_shipping=True),
    ]
    compare_products(products, INTENT, "headphones")
    payload = _payload(calls)
    facts = [c["facts"] for c in payload["candidates"]]

    assert payload["shared_by_all"] == ["free shipping"]
    assert facts[0]["price_vs_cheapest"] == "cheapest" and facts[1]["price_vs_cheapest"] == "+$8.00"
    assert [f["price_rank"] for f in facts] == [1, 2, 3]
    assert facts[0]["same_product_as"] == ["c2"] and "same_product_as" not in facts[2]
    assert facts[1]["dominated_by"] == ["c1"] and facts[2]["dominated_by"] == ["c1", "c2"]
    assert facts[2]["over_budget_by"] == "$50.00"
    assert facts[2]["constraint_checks"] == {"within_max_budget": False}
    assert facts[0]["passes_all_constraints"] is True


def test_payload_carries_normalized_onboarding_preferences(monkeypatch):
    calls = []
    _llm(monkeypatch, None, calls)
    compare_products([_product(0), _product(1)], INTENT, onboarding_preferences=[
        {"category": "travel", "preference_key": "portability", "preference_value": "high", "importance": 0.9},
        {"category": "budget", "preference_key": "sensitivity", "preference_value": {"level": "high"}, "importance": 0.8},
    ])
    preferences = _payload(calls)["user_preferences"]
    assert preferences["available"] is True
    assert preferences["items"] == [
        {"category": "travel", "key": "portability", "value": "high", "importance": 0.9},
        {"category": "budget", "key": "sensitivity", "value": {"level": "high"}, "importance": 0.8},
    ]


def test_short_name_fallback():
    assert short_name(_product(0, title="Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black")) == "Sony WH-1000XM5 Wireless"
    assert short_name(_product(0, title="Iron Flask, 32 oz bottle")) == "Iron Flask"


@pytest.mark.parametrize("output", [None, ComparisonOutput(winner_id="c9", verdict="Nope", takes=[])])
def test_llm_failure_or_invalid_winner_uses_rules(monkeypatch, output):
    _llm(monkeypatch, output)
    products = [_product(1, price=3000), _product(0, rating=4.9), _product(2, reviews=900)]
    out = compare_products(products, INTENT)

    assert out.source == "rules"
    assert out.winner_id == "src:0"
    assert [take.best_for for take in out.takes] == ["Lowest price", "Highest rated", "Most reviewed"]


@pytest.mark.parametrize("count", [1, 5])
def test_dispatch_requires_two_to_four_products(count):
    products = [_product(i).model_dump() for i in range(count)]
    with pytest.raises(ToolError):
        dispatch("compare_products", {"products": products})


def test_compare_route(monkeypatch):
    _llm(monkeypatch, None)
    client = app.test_client()
    products = [_product(0).model_dump(), _product(1).model_dump()]
    response = client.post("/api/compare", json={"products": products, "intent": INTENT.model_dump(), "utterance": " headphones "})

    assert response.status_code == 200
    assert response.json["winner_id"] == "src:0"
    assert client.post("/api/compare", json={"products": products[:1]}).status_code == 400
    assert client.post("/api/compare", json=[]).status_code == 400


def test_comparison_schema_is_strict():
    schema = to_strict_schema(ComparisonOutput)
    assert list(schema["properties"]) == ["takes", "winner_id", "verdict"]
    assert set(schema["required"]) == {"winner_id", "verdict", "takes"}
    assert schema["additionalProperties"] is False
