import re
import pytest
from app import app


def navbar(page):
    return re.search(r'<header class="navbar shared-navbar">(.*?)</header>', page, re.S).group(1)


def common_controls(header):
    # Sidebar toggle is only meaningful on pages with an actual history drawer.
    header = re.sub(r'<button class="mobile-menu-btn".*?</button>', '', header, flags=re.S)
    header = header.replace(' is-active', '')
    header = re.sub(r'\s+aria-current="page"', '', header)
    return re.sub(r'\s+', ' ', header).strip()


@pytest.mark.parametrize('path', ['/dashboard', '/discover', '/saved', '/orders', '/profile', '/cart', '/wallet', '/checkout/demo'])
def test_signed_in_pages_share_dashboard_navigation(path):
    client = app.test_client()
    baseline = navbar(client.get('/dashboard').get_data(as_text=True))
    response = client.get(path)
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    header = navbar(page)
    assert common_controls(header) == common_controls(baseline)
    assert 'styles/navbar.css' in page
    assert header.count('id="sign-out"') == 1
    assert header.count('data-cart-count') == 1


@pytest.mark.parametrize('path', ['/dashboard', '/discover', '/saved', '/orders', '/cart', '/wallet'])
def test_active_location_is_correct(path):
    header = navbar(app.test_client().get(path).get_data(as_text=True))
    current = [re.search(r'href="([^"]+)"', tag).group(1)
               for tag in re.findall(r'<a\b[^>]*aria-current="page"[^>]*>', header)]
    assert current == [path]
