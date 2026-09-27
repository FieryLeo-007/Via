"""OpenAI Responses adapter, live-confirmed 2026-09-26.
Returns None on failure so intent extraction can use its heuristic fallback.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional, Type, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

DEFAULT_MODEL = "gpt-5.6-terra"
DEFAULT_REASONING_EFFORT = "none"


_SHARED_CLIENT = None


def _client(timeout: float = 20.0):
    # One long-lived client keeps the TLS connection to OpenAI warm; building a new
    # client per call added a fresh handshake (~1s) to every intent and picks request.
    global _SHARED_CLIENT
    if _SHARED_CLIENT is None:
        from openai import OpenAI

        _SHARED_CLIENT = OpenAI(max_retries=0)
    return _SHARED_CLIENT.with_options(timeout=timeout)


def to_strict_schema(model: Type[BaseModel]) -> dict:
    """OpenAI strict-mode structured outputs require every property in `required`
    (nullable fields are modeled as a type+null union, not omitted) and
    additionalProperties: false at every object level. Pydantic v2 already emits the
    type+null unions and additionalProperties:false for extra="forbid" models; this
    only needs to widen `required` to the full property set."""
    schema = model.model_json_schema()
    def visit(node):
        if isinstance(node, dict):
            if node.get("type") == "object" or "properties" in node:
                node["required"] = list(node.get("properties", {}))
                node["additionalProperties"] = False
            node.pop("default", None)
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(schema)
    return schema


def structured_completion(
    *,
    system_prompt: str,
    user_content: str,
    schema_name: str,
    output_model: Type[T],
    timeout: float = 20.0,
    purpose: str = "Intent extraction",
) -> Optional[T]:
    model_name = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    # These are small extraction/selection tasks; reasoning adds latency without
    # changing the structured output. Override with OPENAI_REASONING_EFFORT if needed.
    effort = os.environ.get("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT).strip()
    extra = {"reasoning": {"effort": effort}} if effort else {}
    try:
        client = _client(timeout)
        response = client.responses.create(
            model=model_name,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"<untrusted>{user_content}</untrusted>"},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "strict": True,
                    "schema": to_strict_schema(output_model),
                }
            },
            **extra,
        )
        data = json.loads(response.output_text)
        return output_model.model_validate(data)
    except Exception as exc:  # Keep credentials and provider response bodies out of logs.
        logging.getLogger(__name__).warning("%s fell back to heuristics (%s)", purpose, type(exc).__name__)
        return None
