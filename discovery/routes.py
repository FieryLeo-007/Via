"""F1 API surface. No auth enforcement yet (explicitly deferred for this pass) —
CLAUDE.md §7 requires JWT verification on every route except /api/health; that's
tracked as follow-up work, not forgotten."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from agent.tools import ToolError, dispatch
from discovery.user_data import UserData

bp = Blueprint("discovery", __name__, url_prefix="/api")


def _error(code: str, message: str, retryable: bool, status: int):
    return jsonify({"error": {"code": code, "message": message, "retryable": retryable}}), status


def _load_compare_preferences():
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return []
    try:
        account = UserData(token.strip())
        user_id = account.authenticate()
        return account.rows("onboarding_preferences", {
            "select": "category,preference_key,preference_value,importance",
            "user_id": f"eq.{user_id}",
            "order": "importance.desc",
            "limit": "100",
        })
    except Exception:
        # Compare remains available with its objective rules fallback if the account
        # service is unavailable; no client-supplied user id is ever trusted.
        return []


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
    profile = body.get("profile_context") if isinstance(body.get("profile_context"), dict) else {}
    if intent_payload.get("max_price_cents") is None and profile.get("maxSpendingBudget") is not None:
        try:
            budget_cents = int(float(profile["maxSpendingBudget"]) * 100)
            if budget_cents > 0:
                intent_payload = {**intent_payload, "max_price_cents": budget_cents}
        except (TypeError, ValueError, OverflowError):
            pass
    try:
        result = dispatch("search_products", intent_payload)
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    if result.sources and all(source.status != "ok" for source in result.sources):
        return _error("search_unavailable", "Product search is temporarily unavailable. Please try again.", True, 503)
    # Clients that render ranked results first pass picks=false and fetch /api/picks after.
    if body.get("picks") is False:
        return jsonify(result.model_dump())
    # The shopper's own words steer the Top 4; older clients without it fall back to intent.query.
    utterance = body.get("utterance")
    utterance = utterance.strip()[:2000] if isinstance(utterance, str) else None
    try:
        result = dispatch("select_top_picks", {"result": result.model_dump(), "intent": intent_payload, "utterance": utterance, "history": body.get("history", [])})
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    return jsonify(result.model_dump())


@bp.post("/picks")
def post_picks():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error("bad_request", "Request body must be {\"result\", \"intent\", \"utterance\"}", False, 400)
    utterance = body.get("utterance")
    utterance = utterance.strip()[:2000] if isinstance(utterance, str) else None
    try:
        result = dispatch("select_top_picks", {"result": body.get("result"), "intent": body.get("intent"), "utterance": utterance, "history": body.get("history", [])})
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    return jsonify(result.model_dump())


@bp.post("/compare")
def post_compare():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error("bad_request", "Request body must be {\"products\", \"intent\", \"utterance\"}", False, 400)
    utterance = body.get("utterance")
    utterance = utterance.strip()[:2000] if isinstance(utterance, str) else None
    compare_args = dict(body)
    compare_args["utterance"] = utterance
    compare_args["profile_context"] = body.get("profile_context") or {}
    compare_args["onboarding_preferences"] = _load_compare_preferences()
    try:
        comparison = dispatch("compare_products", compare_args)
    except ToolError as exc:
        return _error(exc.code, exc.message, False, 400)
    return jsonify(comparison.model_dump())


@bp.errorhandler(ValidationError)
def handle_validation_error(exc: ValidationError):
    return _error("invalid_input", str(exc), False, 400)
