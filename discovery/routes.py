"""F1 API surface. No auth enforcement yet (explicitly deferred for this pass) —
CLAUDE.md §7 requires JWT verification on every route except /api/health; that's
tracked as follow-up work, not forgotten."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from agent.tools import ToolError, dispatch

bp = Blueprint("discovery", __name__, url_prefix="/api")


def _error(code: str, message: str, retryable: bool, status: int):
    return jsonify({"error": {"code": code, "message": message, "retryable": retryable}}), status


@bp.get("/health")
def health():
    return jsonify({"status": "ok"})


@bp.post("/intent")
def post_intent():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error("bad_request", "Request body must be a JSON object", False, 400)
    try:
        intent = dispatch("extract_intent", body)
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    return jsonify(intent.model_dump())


@bp.post("/search")
def post_search():
    body = request.get_json(silent=True)
    intent_payload = body.get("intent") if isinstance(body, dict) else None
    if not isinstance(intent_payload, dict):
        return _error("bad_request", "Request body must be {\"intent\": ShoppingIntent}", False, 400)
    try:
        result = dispatch("search_products", intent_payload)
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    return jsonify(result.model_dump())


@bp.errorhandler(ValidationError)
def handle_validation_error(exc: ValidationError):
    return _error("invalid_input", str(exc), False, 400)
