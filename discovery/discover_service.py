"""Single-flight personalized feeds. Cache keys never include access tokens."""
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import logging
import threading
import time

from discovery.personalization import build_profile
from discovery.recommendation_planner import plan_discover
from discovery.recommendation_ranking import rank_sections
from discovery.pipeline import search_products

log = logging.getLogger(__name__)
TTL = 30 * 60
# Process-local bounded caches; use a shared cache if deploying multiple workers.
_feeds, _plans = OrderedDict(), OrderedDict()
_cache_lock = threading.Lock()
_user_locks = [threading.Lock() for _ in range(64)]
_search_slots = threading.BoundedSemaphore(6)


def _put(cache, key, value):
    with _cache_lock:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > 128:
            cache.popitem(last=False)


def _get(cache, key):
    with _cache_lock:
        return cache.get(key)


def clear_cache():
    with _cache_lock:
        _feeds.clear()
        _plans.clear()


def discover_feed(repository, refresh=False, debug=False):
    uid = repository.user_id
    lock = _user_locks[int(hashlib.sha256(uid.encode()).hexdigest(), 16) % len(_user_locks)]
    with lock:
        data, unavailable = repository.load()
        profile = build_profile(data)
        key, now = (uid, profile["fingerprint"]), time.time()
        cached = _get(_feeds, key)
        if cached and cached["expires"] > now and (not refresh or now - cached["created"] < 60):
            response = deepcopy(cached["payload"])
            response["cache"]["hit"] = True
        else:
            planned = _get(_plans, key)
            if planned and planned["expires"] > now:
                plan, fallback = planned["plan"], planned["fallback"]
            else:
                plan, fallback = plan_discover(profile)
                _put(_plans, key, {"expires": now + TTL, "plan": plan, "fallback": fallback})

            def search(item):
                index, section = item
                result = {"id": f"discover-{index}", "title": section.title, "category": section.category,
                          "reason": section.reason, "search_query": section.search_query,
                          "exploration": section.exploration, "products": [], "status": "ok", "partial": False}
                try:
                    with _search_slots:
                        found = search_products(section.intent())
                    result["products"] = [p.model_dump(mode="json") for p in found.results]
                    for product in result["products"]:
                        product["category"] = product.get("category") or section.category
                    result["partial"] = found.partial
                    if not found.results:
                        result["status"] = "error" if found.partial else "empty"
                except Exception as exc:
                    log.warning("Discover section failed (%s)", type(exc).__name__)
                    result["status"] = "error"
                return result

            with ThreadPoolExecutor(max_workers=2) as pool:
                sections = list(pool.map(search, enumerate(plan.sections)))
            sections, ranking = rank_sections(sections, profile)
            partial = bool(unavailable) or any(s["status"] != "ok" or s["partial"] for s in sections)
            lifetime = 60 if not any(s["products"] for s in sections) else (300 if partial else TTL)
            expires = time.time() + lifetime
            response = {"sections": sections, "partial": partial, "fallback": fallback,
                        "cold_start": profile["cold_start"],
                        "cache": {"hit": False, "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat()}}
            _put(_feeds, key, {"payload": deepcopy(response), "expires": expires, "created": time.time(), "ranking": ranking})
            repository.remember(sections)
        if debug:
            response["debug"] = {"profile": profile["summary"], "unavailable": unavailable,
                "fingerprint": profile["fingerprint"], "ranking": (_get(_feeds, key) or {}).get("ranking", {})}
        return response
