import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest


@pytest.fixture(autouse=True)
def _clear_intent_cache():
    from agent import intent

    intent._cache.clear()
    yield
    intent._cache.clear()
