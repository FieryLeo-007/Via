"""Allowlisted tool registry shared by every feature (CLAUDE.md 'Agent layer'):
every input/output is a pydantic model with extra='forbid', dispatch only reaches
registered tools, and invalid args come back as a typed error instead of a crash."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Type

from pydantic import BaseModel, ValidationError, Field, field_validator

from agent.compare import CompareProductsInput, ComparisonResult, compare_products
from agent.conversation import ConversationInput
from agent.intent import extract_intent
from agent.picks import SelectTopPicksInput, select_top_picks
from discovery.pipeline import search_products
from discovery.schemas import SearchResult, ShoppingIntent, StrictModel


class ToolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ExtractIntentInput(ConversationInput):
    utterance: str = Field(min_length=1, max_length=2000)

    @field_validator("utterance")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a product search")
        return value.strip()


@dataclass(frozen=True)
class ToolSpec:
    input_model: Type[BaseModel]
    output_model: Type[BaseModel]
    handler: Callable[[BaseModel], BaseModel]


def _extract_intent_handler(args: ExtractIntentInput) -> ShoppingIntent:
    return extract_intent(args.utterance, args.history)


def _search_products_handler(args: ShoppingIntent) -> SearchResult:
    return search_products(args)


def _select_top_picks_handler(args: SelectTopPicksInput) -> SearchResult:
    return select_top_picks(args.result, args.intent, args.utterance, args.history)


def _compare_products_handler(args: CompareProductsInput) -> ComparisonResult:
    return compare_products(args.products, args.intent, args.utterance, args.history, args.onboarding_preferences)


REGISTRY: dict[str, ToolSpec] = {
    "extract_intent": ToolSpec(ExtractIntentInput, ShoppingIntent, _extract_intent_handler),
    "search_products": ToolSpec(ShoppingIntent, SearchResult, _search_products_handler),
    "select_top_picks": ToolSpec(SelectTopPicksInput, SearchResult, _select_top_picks_handler),
    "compare_products": ToolSpec(CompareProductsInput, ComparisonResult, _compare_products_handler),
}


def dispatch(name: str, raw_args: dict) -> BaseModel:
    spec = REGISTRY.get(name)
    if spec is None:
        raise ToolError("unknown_tool", f"{name!r} is not an allowlisted tool")
    try:
        validated = spec.input_model.model_validate(raw_args)
    except ValidationError as exc:
        raise ToolError("invalid_input", str(exc)) from exc
    return spec.handler(validated)
