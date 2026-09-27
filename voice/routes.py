from flask import Blueprint, jsonify, request
import httpx

from discovery.user_data import AuthenticationError, UserData
from .service import VoiceError, conversation_token, settings

bp = Blueprint("voice", __name__, url_prefix="/api/voice")


def first_name(account, user_id):
    # A greeting is optional; account lookups must never block a voice session.
    try:
        rows = account.rows("users", {"select": "full_name", "id": f"eq.{user_id}", "limit": "1"})
        name = str((rows[0] if rows else {}).get("full_name") or "").strip()
    except (httpx.HTTPError, ValueError, AttributeError, TypeError):
        return ""
    return name.split()[0][:40] if name else ""


@bp.get("/session")
def session():
    token = request.headers.get("Authorization", "")
    if not token.startswith("Bearer "):
        return jsonify(error="Sign in to use voice mode.", code="authentication_required"), 401
    account = None
    try:
        account = UserData(token[7:])
        user_id = account.authenticate()
        config = settings()
        conversation = conversation_token(config)
        name = first_name(account, user_id)
    except AuthenticationError:
        return jsonify(error="Your session expired. Sign in again.", code="authentication_required"), 401
    except VoiceError as exc:
        return jsonify(error=str(exc), code=exc.code, missing=exc.missing), exc.status
    except (httpx.HTTPError, RuntimeError):
        return jsonify(error="Account service is unavailable. Please try again.", code="account_unavailable"), 503
    finally:
        if account:
            account.close()
    return jsonify(conversationToken=conversation, agentId=config["agent_id"], userId=user_id,
                   dynamicVariables={"user_name": name or "there"})


@bp.after_request
def private_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
