import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class IranCompatibilityRouteTests(unittest.TestCase):
    def test_cloudflare_compatibility_routes_exist(self):
        redirects = (ROOT / "_redirects").read_text(encoding="utf-8")
        for route in ("/est / 302", "/est/auth/login /admin 302", "/auth/login /admin 302"):
            self.assertIn(route, redirects)

    def test_vps_deploy_installs_every_compatibility_file(self):
        deploy = (ROOT / "deploy-vps.sh").read_text(encoding="utf-8")
        for relative in (
            "auth/login/index.html",
            "est/index.html",
            "est/auth/login/index.html",
            "est/api/health/index.html",
            "est/api/version/index.html",
        ):
            self.assertTrue((ROOT / "compat" / relative).is_file())
            self.assertIn(relative, deploy)

    def test_probe_is_sequential_to_avoid_cloudflare_bursts(self):
        source = (ROOT / "bot" / "hamkare_bot.py").read_text(encoding="utf-8")
        self.assertNotIn("ThreadPoolExecutor", source)
        self.assertIn("time.sleep(0.4)", source)

    def test_probe_checks_the_canonical_apk_route(self):
        source = (ROOT / "bot" / "hamkare_bot.py").read_text(encoding="utf-8")
        routes = source.split("IRAN_ROUTE_PATHS = (", 1)[1].split("\n)", 1)[0]
        self.assertIn('(\"دانلود\", \"/download\")', routes)
        self.assertNotIn("/download.php", routes)


if __name__ == "__main__":
    unittest.main()
