"""Allowlisted tool registry shared by every feature (CLAUDE.md 'Agent layer'):
every input/output is a pydantic model with extra='forbid', dispatch only reaches
registered tools, and invalid args come back as a typed error instead of a crash."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Type

from pydantic import BaseModel, ValidationError

from agent.intent import extract_intent
from discovery.pipeline import search_products
from discovery.schemas import SearchResult, ShoppingIntent, StrictModel


class ToolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ExtractIntentInput(StrictModel):
    utterance: str


@dataclass(frozen=True)
class ToolSpec:
    input_model: Type[BaseModel]
    output_model: Type[BaseModel]
    handler: Callable[[BaseModel], BaseModel]


def _extract_intent_handler(args: ExtractIntentInput) -> ShoppingIntent:
    return extract_intent(args.utterance)


def _search_products_handler(args: ShoppingIntent) -> SearchResult:
    return search_products(args)


REGISTRY: dict[str, ToolSpec] = {
    "extract_intent": ToolSpec(ExtractIntentInput, ShoppingIntent, _extract_intent_handler),
    "search_products": ToolSpec(ShoppingIntent, SearchResult, _search_products_handler),
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
