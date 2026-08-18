import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hamkare_iran_bot", ROOT / "bot" / "hamkare_bot.py")
BOT = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = BOT
SPEC.loader.exec_module(BOT)


class TelegramIranCheckStaticTests(unittest.TestCase):
    def test_install_mode_preserves_env_and_restarts_only_telegram(self):
        script = (ROOT / "deploy-hamkare-bots.sh").read_text(encoding="utf-8")
        block = script.split("install_telegram_iran_check() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("python3 -m py_compile", block)
        self.assertIn("systemctl restart hamkare-telegram.service", block)
        self.assertNotIn("hamkare-bale.service", block)
        self.assertNotIn("telegram.env\" <<", block)
        self.assertNotIn("sed -i", block)

    def test_probe_is_hard_limited_to_adlisho_and_verified_ir_nodes(self):
        source = (ROOT / "bot" / "hamkare_bot.py").read_text(encoding="utf-8")
        self.assertIn('parsed.hostname != "adlisho.online"', source)
        self.assertIn('str(location[0]).lower() == "ir"', source)
        self.assertIn('self.config.platform == "telegram"', source)

    def test_discovery_accepts_only_verified_ir_nodes(self):
        payload = {"nodes": {
            "ir5.node.check-host.net": {"location": ["ir", "Iran", "Tehran"]},
            "de1.node.check-host.net": {"location": ["de", "Germany", "Berlin"]},
            "irfake.node.check-host.net": {"location": ["ir", "Iran", "Tehran"]},
            "ir6.node.check-host.net": {"location": ["de", "Germany", "Berlin"]},
        }}
        with mock.patch.object(BOT, "check_host_json", return_value=payload):
            self.assertEqual(BOT.discover_iran_nodes(), {
                "ir5.node.check-host.net": ("Iran", "Tehran")
            })

    def test_report_covers_every_declared_route_without_credentials(self):
        nodes = {"ir5.node.check-host.net": ("Iran", "Tehran")}
        with (
            mock.patch.object(BOT, "discover_iran_nodes", return_value=nodes),
            mock.patch.object(BOT, "check_route_from_iran", return_value={
                "ir5.node.check-host.net": "200"
            }) as probe,
        ):
            report = BOT.format_iran_route_report("https://adlisho.online")
        self.assertEqual(probe.call_count, len(BOT.IRAN_ROUTE_PATHS))
        self.assertIn("رمز، OTP یا داده‌ای ارسال نشد", report)

    def test_bale_menu_never_contains_iran_check(self):
        with tempfile.TemporaryDirectory() as directory:
            config = BOT.Config(
                platform="bale",
                token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
                log_chat_id="-1001234567890",
                admin_ids=frozenset({"10001"}),
                download_url="https://adlisho.online/download",
                site_url="https://adlisho.online",
                support_url="https://adlisho.online/contact.html",
                privacy_url="https://adlisho.online/privacy.html",
                tracking_url="https://adlisho.online/result.html",
                brand_name="همکاره",
                database_path=Path(directory) / "bale.sqlite3",
                apk_upload_enabled=False,
                apk_deploy_path=None,
                max_apk_bytes=20 * 1024 * 1024,
            )
            callbacks = {
                button.get("callback_data")
                for row in BOT.Bot(config).admin_menu()
                for button in row
            }
        self.assertNotIn("admin_iran_check", callbacks)


if __name__ == "__main__":
    unittest.main()
