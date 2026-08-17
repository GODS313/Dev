import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = (ROOT / 'install-hamkare-admin-vps.sh').read_text(encoding='utf-8')
CONFIG_API = (ROOT / 'functions' / 'api' / 'admin' / 'config.js').read_text(encoding='utf-8')
SYNC_API = (ROOT / 'functions' / 'api' / 'admin' / 'sync.js').read_text(encoding='utf-8')
DOWNLOAD = (ROOT / 'functions' / 'download.js').read_text(encoding='utf-8')


class HamkareAdminSyncStaticTests(unittest.TestCase):
    def test_d1_is_the_only_writable_source_of_truth(self):
        self.assertIn('await env.DB.batch(statements)', CONFIG_API)
        self.assertIn("updates.push(['config_revision'", CONFIG_API)
        self.assertNotIn('password_hash', INSTALLER)
        self.assertNotIn('hamkare-admin-apply', INSTALLER.split("for legacy", 1)[0])

    def test_platform_envs_and_restarts_are_selective(self):
        self.assertIn('prepare_env(path, values)', INSTALLER)
        self.assertIn('prepared["service"] = f"hamkare-{name}.service"', INSTALLER)
        self.assertIn('for item in pending:', INSTALLER)
        self.assertNotIn('restart hamkare-telegram.service hamkare-bale.service', INSTALLER)

    def test_env_and_state_writes_are_atomic(self):
        self.assertGreaterEqual(INSTALLER.count('os.replace('), 3)
        self.assertGreaterEqual(INSTALLER.count('os.fsync('), 3)
        self.assertIn('flock(lock, fcntl.LOCK_EX)', INSTALLER)

    def test_download_uses_the_same_d1_record(self):
        self.assertIn("'download_source','download_url'", DOWNLOAD)
        self.assertIn("download_source: current.download_source", SYNC_API)
        self.assertIn("canonical_download_url: 'https://adlisho.online/download.php'", SYNC_API)

    def test_legacy_vps_panel_is_redirect_only(self):
        self.assertIn("Location: https://adlisho.online/admin", INSTALLER)
        self.assertNotIn("مدیریت دانلود، تلگرام و بله", INSTALLER)


if __name__ == '__main__':
    unittest.main()
