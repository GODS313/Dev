import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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


if __name__ == "__main__":
    unittest.main()
