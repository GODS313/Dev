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
    "bot/hamkare_bot.py",
    "seskia-netlify/index.html",
    "seskia-netlify/assets/app.js",
)


class ReleaseStaticTests(unittest.TestCase):
    def test_canonical_download_url_is_consistent(self):
        expected = "https://seskia.online/est/download"
        config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["apk_url"], expected)
        for relative_path in (
            "index.html",
            "deploy-hamkare-bots.sh",
            "seskia-netlify/index.html",
            "seskia-netlify/assets/app.js",
        ):
            self.assertIn(expected, (ROOT / relative_path).read_text(encoding="utf-8"))

    def test_no_legacy_brand_or_download_target_remains_in_production_text(self):
        forbidden = (
            "سازمان" + " ادلیشو",
            "https://seskia.online/download.php" + "?src=hamkare",
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


if __name__ == "__main__":
    unittest.main()
