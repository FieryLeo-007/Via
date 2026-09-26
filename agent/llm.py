"""OpenAI Responses API adapter. Request/response shapes verified against
developers.openai.com/api/docs on 2026-09-26 (spec-confirmed, no live call made
yet — see docs/integration-notes.md). Returns None on any failure so callers can
fall back to the heuristic parser instead of erroring out."""

from __future__ import annotations

import json
import os
from typing import Optional, Type, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

DEFAULT_MODEL = "gpt-5.6-terra"


def _client():
    from openai import OpenAI

    return OpenAI()


def to_strict_schema(model: Type[BaseModel]) -> dict:
    """OpenAI strict-mode structured outputs require every property in `required`
    (nullable fields are modeled as a type+null union, not omitted) and
    additionalProperties: false at every object level. Pydantic v2 already emits the
    type+null unions and additionalProperties:false for extra="forbid" models; this
    only needs to widen `required` to the full property set."""
    schema = model.model_json_schema()
    schema["required"] = list(schema.get("properties", {}).keys())
    schema["additionalProperties"] = False
    return schema


def structured_completion(
    *, system_prompt: str, user_content: str, schema_name: str, output_model: Type[T]
) -> Optional[T]:
    model_name = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    try:
        client = _client()
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
        )
        data = json.loads(response.output_text)
        return output_model.model_validate(data)
    except Exception:  # noqa: BLE001 - any failure here means "use the fallback"
        return None
