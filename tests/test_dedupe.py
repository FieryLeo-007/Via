from discovery.dedupe import dedupe
from discovery.schemas import Product


def _product(**kwargs):
    defaults = dict(
        id="openwebninja:1", source="openwebninja", source_id="1",
        title="Widget", price_cents=1000,
    )
    defaults.update(kwargs)
    return Product(**defaults)


def test_dedupe_merges_near_identical_titles_same_brand():
    # Jaccard similarity must clear the 0.9 threshold (CLAUDE.md's own dedupe bar) —
    # one added qualifier word against a ten-token title just clears it (9/10 = 0.9).
    a = _product(
        id="openwebninja:1", source_id="1",
        title="Sony WH-1000XM5 Wireless Noise Cancelling Over Ear Bluetooth Headphones",
        brand="Sony", price_cents=19800,
    )
    b = _product(
        id="openwebninja:2", source_id="2",
        title="Sony WH-1000XM5 Wireless Noise Cancelling Over Ear Bluetooth Headphones Black",
        brand="Sony", price_cents=18999,
    )

    result = dedupe([a, b])

    assert len(result) == 1
    assert result[0].price_cents == 18999  # lowest price kept
    assert len(result[0].alt_offers) == 1


def test_dedupe_keeps_different_brands_separate():
    a = _product(id="openwebninja:1", source_id="1", title="Wireless Noise Cancelling Headphones", brand="Sony", price_cents=19800)
    b = _product(id="openwebninja:2", source_id="2", title="Wireless Noise Cancelling Headphones", brand="Bose", price_cents=17900)

    result = dedupe([a, b])

    assert len(result) == 2


def test_dedupe_keeps_dissimilar_titles_separate():
    a = _product(id="openwebninja:1", source_id="1", title="Sony WH-1000XM5 Headphones")
    b = _product(id="openwebninja:2", source_id="2", title="Anker Soundcore Life Q30 Earbuds")

    result = dedupe([a, b])

    assert len(result) == 2


def test_dedupe_matches_when_brand_unknown_on_one_side():
    a = _product(id="openwebninja:1", source_id="1", title="Sony WH-1000XM5 Wireless Headphones", brand="Sony", price_cents=19800)
    b = _product(id="openwebninja:2", source_id="2", title="Sony WH-1000XM5 Wireless Headphones", brand=None, price_cents=18999)

    result = dedupe([a, b])

    assert len(result) == 1
