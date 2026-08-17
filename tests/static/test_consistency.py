import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FILES = {
    name: (ROOT / name).read_text(encoding="utf-8")
    for name in (
        "functions/api/admin/config.js",
        "functions/api/admin/sync.js",
        "functions/download.js",
        "install-hamkare-admin-vps.sh",
        "README.md",
        "DEPLOYMENT.md",
    )
}
FALLBACK = "https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk"
CONTRACT_KEYS = {"revision", "canonical_download_url", "download_source", "telegram", "bale"}


class ProductionConsistencyGuard(unittest.TestCase):
    def test_release_fallback_does_not_drift(self):
        for name, content in FILES.items():
            self.assertIn(FALLBACK, content, f"release fallback missing or drifted in {name}")

    def test_download_source_is_d1_backed_end_to_end(self):
        self.assertIn("current.download_source || RELEASE_URL", FILES["functions/api/admin/config.js"])
        self.assertIn("current.download_source || RELEASE_URL", FILES["functions/api/admin/sync.js"])
        self.assertIn("bind('download_source')", FILES["functions/download.js"])
        self.assertIn('"DOWNLOAD_URL": data["download_source"]', FILES["install-hamkare-admin-vps.sh"])

    def test_sync_contract_keys_match_consumer_and_docs(self):
        sync = FILES["functions/api/admin/sync.js"]
        match = re.search(r"return json\(\{\n(?P<body>.*?)\n\s*\}\);", sync, re.DOTALL)
        self.assertIsNotNone(match)
        produced = set(re.findall(r"^\s+([a-z][a-z0-9_]*)\s*:", match.group("body"), re.MULTILINE))
        self.assertEqual(produced, CONTRACT_KEYS)
        for name in ("README.md", "DEPLOYMENT.md"):
            for key in CONTRACT_KEYS:
                self.assertIn(f"`{key}`", FILES[name], f"{key} missing from {name}")


if __name__ == "__main__":
    unittest.main()
