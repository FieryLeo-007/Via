from flask import Blueprint, jsonify, request
import httpx
import json

from discovery.user_data import AuthenticationError, UserData
from .service import VoiceError, conversation_token, settings
from .context import shopping_context

bp = Blueprint("voice", __name__, url_prefix="/api/voice")


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
        context = shopping_context(account, user_id)
        name = str(context["profile"].get("full_name") or "").split()
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
                   dynamicVariables={"user_name": name[0][:40] if name else "there",
                                     "user_context": json.dumps(context, ensure_ascii=False)})


@bp.after_request
def private_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
