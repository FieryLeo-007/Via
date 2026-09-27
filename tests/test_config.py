import os
import unittest
from unittest.mock import patch

from app import ENV_FILE, app, auth_config


class AuthConfigTests(unittest.TestCase):
    def test_index_uses_voice_orb_without_legacy_guide(self):
        page = app.test_client().get("/index.html").get_data(as_text=True)
        self.assertIn('class="agent-blob voice-orb"', page)
        self.assertIn('class="voice-orb-canvas"', page)
        self.assertNotIn("doom-guide", page.lower())

    def test_primary_navigation_labels_and_routes(self):
        client = app.test_client()
        expected = {
            "/dashboard": "Dashboard",
            "/discover": "Discover",
            "/orders": "Orders",
            "/saved": "Saved",
        }

        for path, label in expected.items():
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            page = response.get_data(as_text=True)
            self.assertIn(f'href="{path}"', page)
            self.assertIn(f'aria-current="page">{label}</a>', page)
            self.assertIn('class="nav-hover-pill"', page)

    def test_discover_route_renders_modular_feed(self):
        response = app.test_client().get("/discover")
        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn('id="discover-sections"', page)
        self.assertIn('id="discover-refresh"', page)
        self.assertIn('id="discover-compare-dialog"', page)
        self.assertNotIn("discover-seasonal-hero.png", page)
        self.assertIn('aria-current="page">Discover</a>', page)
        self.assertNotIn("scripts/theme.js", page)
        self.assertIn("scripts/discover.bundle.js", page)

    def test_discover_does_not_add_page_specific_theme_controls(self):
        client = app.test_client()
        dashboard = client.get("/dashboard").get_data(as_text=True)
        discover = client.get("/discover").get_data(as_text=True)
        self.assertNotIn("scripts/theme.js", dashboard)
        self.assertNotIn('class="icon-btn theme-toggle"', dashboard)
        self.assertNotIn("scripts/theme.js", discover)
        self.assertNotIn('class="icon-btn theme-toggle"', discover)

    def test_onboarding_routes_render_six_step_flow(self):
        client = app.test_client()
        for path in ("/onboarding", "/onboarding.html"):
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            page = response.get_data(as_text=True)
            self.assertEqual(page.count('class="onboarding-step'), 6)
            self.assertIn('data-auth-page="onboarding"', page)
            self.assertIn('scripts/onboarding.js', page)

    def test_empty_environment_uses_project_dotenv(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_PUBLISHABLE_KEY": "", "SUPABASE_ANON_KEY": ""}), patch(
            "app.dotenv_values", return_value={"SUPABASE_URL": "https://example.supabase.co/rest/v1/", "SUPABASE_PUBLISHABLE_KEY": "public-test"}
        ) as read:
            config = auth_config()["auth_config"]
            self.assertEqual(config["url"], "https://example.supabase.co")
            self.assertEqual(config["key"], "public-test")
            read.assert_called_once_with(ENV_FILE)
            self.assertTrue(ENV_FILE.is_absolute())

    def test_dotenv_changes_are_loaded_on_next_render(self):
        with patch.dict(os.environ, {}, clear=True), patch("app.dotenv_values", side_effect=[{}, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_ANON_KEY": "public-test"}]):
            self.assertEqual(auth_config()["auth_config"]["key"], "")
            self.assertEqual(auth_config()["auth_config"]["key"], "public-test")

    def test_deployment_environment_takes_precedence(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://production.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "production-public"}), patch("app.dotenv_values", return_value={"SUPABASE_PUBLISHABLE_KEY": "local-public"}):
            self.assertEqual(auth_config()["auth_config"]["key"], "production-public")


if __name__ == "__main__":
    unittest.main()
