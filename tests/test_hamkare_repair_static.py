import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = (ROOT / "deploy-hamkare-bots.sh").read_text(encoding="utf-8")


class HamkareRepairStaticTests(unittest.TestCase):
    def test_repair_is_explicit_and_does_not_write_env_files(self):
        repair = DEPLOY[DEPLOY.index("repair_mode()"):DEPLOY.index('SOURCE_BOT=')]
        self.assertIn('if [[ "${1:-}" == --repair ]]', DEPLOY)
        self.assertNotIn('> "$APP/telegram.env"', repair)
        self.assertNotIn('> "$APP/bale.env"', repair)
        self.assertIn("secret ساخته نشد", repair)

    def test_permissions_and_sqlite_access_are_repaired(self):
        for guard in (
            'root:root:700',
            'root:root:750',
            'root:root:600',
            '"$database_path-wal"',
            '"$database_path-shm"',
            'ReadWritePaths=$APP',
        ):
            self.assertIn(guard, DEPLOY)

    def test_service_paths_compile_and_health_checks_are_pinned(self):
        for guard in (
            'WorkingDirectory=$APP',
            'EnvironmentFile=$APP/$platform.env',
            'ExecStart=/usr/bin/python3 -I $APP/bot.py',
            'python3 -m py_compile "$APP/bot.py"',
            'systemctl is-active --quiet "$unit"',
        ):
            self.assertIn(guard, DEPLOY)
        self.assertIn('User=root', DEPLOY)
        self.assertIn('Group=root', DEPLOY)


if __name__ == "__main__":
    unittest.main()
