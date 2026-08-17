import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_TEXT = (
    "config.json",
    "index.html",
    "contact.html",
    "privacy.html",
    "manifest.json",
    "deploy-hamkare-bots.sh",
    "deploy-vps.sh",
    "functions/api/register.js",
    "functions/api/result.js",
    "functions/download.js",
    "functions/api/admin/config.js",
    "functions/api/admin/sync.js",
    "admin.html",
    "install-hamkare-admin-vps.sh",
    "bot/hamkare_bot.py",
    "seskia-netlify/index.html",
    "seskia-netlify/assets/app.js",
)


class ReleaseStaticTests(unittest.TestCase):
    def test_canonical_download_url_is_consistent(self):
        expected = "https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk"
        config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["apk_url"], expected)
        for relative_path in (
            "index.html",
            "deploy-hamkare-bots.sh",
            "install-hamkare-admin-vps.sh",
            "admin.html",
            "functions/download.js",
            "functions/api/admin/config.js",
            "functions/api/admin/sync.js",
            "seskia-netlify/index.html",
            "seskia-netlify/assets/app.js",
        ):
            self.assertIn(expected, (ROOT / relative_path).read_text(encoding="utf-8"))

    def test_no_legacy_brand_or_download_target_remains_in_production_text(self):
        forbidden = (
            "سازمان" + " ادلیشو",
            "https://seskia.online/est/" + "download",
            "https://adlisho.online/" + "download.php",
            "143.14." + "59.50",
            "http:" + "//",
        )
        for relative_path in PRODUCTION_TEXT:
            content = (ROOT / relative_path).read_text(encoding="utf-8")
            for value in forbidden:
                self.assertNotIn(value, content, f"{value!r} remains in {relative_path}")

    def test_external_production_links_are_https(self):
        for relative_path in PRODUCTION_TEXT:
            content = (ROOT / relative_path).read_text(encoding="utf-8")
            for url in re.findall(r"https?://[^\s\"'<>]+", content):
                self.assertTrue(url.startswith("https://"), f"insecure URL in {relative_path}: {url}")

    def test_qr_assets_match_and_are_png(self):
        primary = (ROOT / "qr-download.png").read_bytes()
        legacy = (ROOT / "seskia-netlify/assets/qr-download.png").read_bytes()
        self.assertEqual(primary, legacy)
        self.assertTrue(primary.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_both_bot_envs_receive_the_same_release_url(self):
        installer = (ROOT / "deploy-hamkare-bots.sh").read_text(encoding="utf-8")
        self.assertEqual(installer.count("DOWNLOAD_URL=$DOWNLOAD_URL"), 2)
        self.assertIn('for platform in telegram bale', installer)

    def test_stable_webview_routes_and_age_gate_exist(self):
        redirects = (ROOT / "_redirects").read_text(encoding="utf-8")
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("/app/* /result.html 200", redirects)
        self.assertIn("/register/* /index.html 200", redirects)
        self.assertIn("/exam/* /index.html 200", redirects)
        self.assertIn("تأیید می‌کنم؛ بالای ۱۸ سال هستم", index)
        self.assertIn("https://t.me/Pasokh313e_bot", index)
        self.assertIn("https://ble.ir/Hamkarebot", index)


if __name__ == "__main__":
    unittest.main()
