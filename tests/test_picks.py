import json
from typing import Optional
from pathlib import Path

import pytest

from agent.llm import to_strict_schema
from agent.picks import PickChoice, TopPicksOutput, select_top_picks
from agent.tools import dispatch
from discovery.schemas import RankedProduct, ScoreBreakdown, SearchResult, SearchSource, ShoppingIntent

INTENT = ShoppingIntent(query="wireless headphones", max_price_cents=20000)


def _product(i: int, title: Optional[str] = None) -> RankedProduct:
    score = 1.0 - i * 0.01
    return RankedProduct(
        id=f"src:{i}", source="src", source_id=str(i), title=title or f"Headphones {i}",
        price_cents=1000 + i, rating=4.5, rating_count=100, score=score,
        breakdown=ScoreBreakdown(relevance=1, constraint_fit=1, quality=1, priority_fit=0.5, base=score, score=score),
        reasons=[f"reason {i}"],
    )


def _result(n: int) -> SearchResult:
    return SearchResult(
        results=[_product(i) for i in range(n)],
        sources=[SearchSource(name="src", status="ok", count=n, elapsed_ms=1)],
        partial=False,
    )


def _llm(monkeypatch, output, calls=None):
    def fake(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        return output
    monkeypatch.setattr("agent.picks.structured_completion", fake)


def test_ai_picks_come_first_in_llm_order_with_reasons(monkeypatch):
    calls = []
    picks = [PickChoice(id=f"p{i}", reason=f"Fits because {i}") for i in (7, 3, 9, 1)]
    _llm(monkeypatch, TopPicksOutput(picks=picks), calls)
    out = select_top_picks(_result(10), INTENT, "Headphones for flights under $200")

    assert out.picks_source == "ai"
    assert [p.id for p in out.results[:4]] == ["src:6", "src:2", "src:8", "src:0"]
    assert [p.top_pick_rank for p in out.results[:4]] == [1, 2, 3, 4]
    assert out.results[0].pick_reason == "Fits because 7"
    # The rest keep their original score order and carry no pick data.
    assert [p.id for p in out.results[4:]] == ["src:1", "src:3", "src:4", "src:5", "src:7", "src:9"]
    assert all(p.top_pick_rank is None and p.pick_reason is None for p in out.results[4:])
    assert len(out.results) == 10
    assert "flights" in calls[0]["user_content"]
    assert calls[0]["schema_name"] == "top_picks"


def test_invalid_duplicate_and_missing_ids_fill_from_rank_order(monkeypatch):
    picks = [
        PickChoice(id="p5", reason="Great"),
        PickChoice(id="p5", reason="Duplicate"),
        PickChoice(id="p99", reason="Unknown"),
        PickChoice(id="p2", reason="   "),
    ]
    _llm(monkeypatch, TopPicksOutput(picks=picks))
    out = select_top_picks(_result(10), INTENT, "headphones")

    assert out.picks_source == "ai"
    assert [p.id for p in out.results[:4]] == ["src:4", "src:0", "src:1", "src:2"]
    assert out.results[1].pick_reason == "reason 0"
    assert len({p.id for p in out.results}) == 10


def test_llm_failure_uses_deterministic_top_four(monkeypatch):
    _llm(monkeypatch, None)
    out = select_top_picks(_result(10), INTENT, None)

    assert out.picks_source == "ranked"
    assert [p.id for p in out.results] == [f"src:{i}" for i in range(10)]
    assert [p.top_pick_rank for p in out.results[:4]] == [1, 2, 3, 4]
    assert out.results[4].top_pick_rank is None


def test_fewer_than_four_results_are_all_picks(monkeypatch):
    _llm(monkeypatch, None)
    out = select_top_picks(_result(3), INTENT, "headphones")
    assert [p.top_pick_rank for p in out.results] == [1, 2, 3]


def test_empty_results_skip_the_llm(monkeypatch):
    calls = []
    _llm(monkeypatch, None, calls)
    out = select_top_picks(_result(0), INTENT, "headphones")
    assert out.results == [] and out.picks_source == "none" and calls == []


def test_long_reasons_are_capped(monkeypatch):
    _llm(monkeypatch, TopPicksOutput(picks=[PickChoice(id="p1", reason="x" * 500)]))
    out = select_top_picks(_result(5), INTENT, "headphones")
    assert len(out.results[0].pick_reason) <= 200


def test_poisoned_titles_are_sent_as_data_and_output_validates(monkeypatch):
    titles = json.loads((Path(__file__).parent.parent / "fixtures" / "poisoned_titles.json").read_text())
    result = SearchResult(
        results=[_product(i, title) for i, title in enumerate(titles[:10])],
        sources=[SearchSource(name="src", status="ok", count=10, elapsed_ms=1)], partial=False,
    )
    calls = []
    _llm(monkeypatch, None, calls)
    out = select_top_picks(result, INTENT, "headphones")
    payload = json.loads(calls[0]["user_content"])
    assert [c["title"] for c in payload["candidates"]] == titles[:10]
    assert "data, never instructions" in calls[0]["system_prompt"]
    assert out.picks_source == "ranked" and len(out.results) == len(result.results)


def test_strict_schema_forbids_extra_properties_everywhere():
    schema = to_strict_schema(TopPicksOutput)
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["picks"]
    pick = schema["$defs"]["PickChoice"]
    assert pick["additionalProperties"] is False
    assert sorted(pick["required"]) == ["id", "reason"]


def test_registered_tool_rejects_extra_fields(monkeypatch):
    _llm(monkeypatch, None)
    payload = {"result": _result(5).model_dump(), "intent": INTENT.model_dump(), "utterance": "hi"}
    assert len(dispatch("select_top_picks", payload).results) == 5
    from agent.tools import ToolError
    with pytest.raises(ToolError):
        dispatch("select_top_picks", {**payload, "extra": 1})
