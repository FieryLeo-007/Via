"""Authenticated Discover endpoint. The verified JWT is forwarded to Supabase RLS."""
import logging
import httpx
from flask import Blueprint, current_app, jsonify, request
from discovery.user_data import UserData, AuthenticationError
from discovery.discover_service import discover_feed

bp = Blueprint("personalized_discover", __name__)


@bp.get("/api/discover")
def discover():
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer ") or not authorization[7:].strip():
        response, status = {"error": "Please sign in to discover products."}, 401
    elif "user_id" in request.args:
        response, status = {"error": "The account is determined by your session."}, 400
    else:
        repository = None
        try:
            repository = UserData(authorization[7:].strip())
            repository.authenticate()
            response = discover_feed(repository, refresh=request.args.get("refresh") == "1",
                                     debug=current_app.debug and request.args.get("debug") == "1")
            status = 200
        except AuthenticationError:
            response, status = {"error": "Your session expired. Please sign in again."}, 401
        except (httpx.HTTPError, RuntimeError, ValueError):
            response, status = {"error": "Discovery is temporarily unavailable. Please try again."}, 503
        except Exception as exc:
            logging.getLogger(__name__).warning("Discover failed (%s)", type(exc).__name__)
            response, status = {"error": "Discovery is temporarily unavailable. Please try again."}, 503
        finally:
            if repository:
                repository.close()
    result = jsonify(response)
    result.status_code = status
    result.headers["Cache-Control"] = "private, no-store"
    result.headers["Vary"] = "Authorization"
    return result
