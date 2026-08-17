import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOT = (ROOT / "bot" / "hamkare_bot.py").read_text(encoding="utf-8")
ENABLE = (ROOT / "enable-hamkare-bale-direct-apk.sh").read_text(encoding="utf-8")


class BaleSimpleFlowStaticTests(unittest.TestCase):
    def test_bale_flow_asks_only_name_family_and_phone(self):
        self.assertIn('self.session(user_id, "phone", first, family_name)', BOT)
        self.assertIn("normalize_iranian_mobile(text)", BOT)
        self.assertIn('"📥 دانلود دفترچه"', BOT)
        self.assertIn('command == "/admin"', BOT)

    def test_admin_forwarded_apk_is_detected_without_panel_state(self):
        self.assertIn("direct_bale_upload = (", BOT)
        self.assertIn('self.config.platform == "bale"', BOT)
        self.assertIn('file_name.lower().endswith(".apk")', BOT)
        self.assertIn('"https://tapi.bale.ai/file/bot"', BOT)

    def test_activator_uses_stable_local_endpoint_and_preserves_secrets(self):
        self.assertIn("https://seskia.online/download.php?src=hamkare", ENABLE)
        self.assertIn('"APK_UPLOAD_ENABLED": "true"', ENABLE)
        self.assertIn('"GITHUB_DISPATCH_TOKEN": ""', ENABLE)
        self.assertIn('cp -a "$ENV_FILE" "$BACKUP_DIR/bale.env"', ENABLE)
        self.assertNotIn("BOT_TOKEN=", ENABLE)
        self.assertNotIn("ADMIN_IDS=", ENABLE)


if __name__ == "__main__":
    unittest.main()
