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
        expected = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk'
        self.assertIn(expected, DOWNLOAD)
        self.assertIn('download_source: RELEASE_URL', SYNC_API)
        self.assertIn('canonical_download_url: RELEASE_URL', SYNC_API)
        self.assertIn(expected, INSTALLER)

    def test_legacy_vps_panel_is_redirect_only(self):
        self.assertIn("Location: https://adlisho.online/admin", INSTALLER)
        self.assertNotIn("مدیریت دانلود، تلگرام و بله", INSTALLER)

    def test_remote_sync_is_proven_before_legacy_writer_is_retired(self):
        preflight = INSTALLER.index('  "$SYNC_PROGRAM"')
        retirement = INSTALLER.index('rm -f /etc/sudoers.d/hamkare-admin')
        self.assertLess(preflight, retirement)


if __name__ == '__main__':
    unittest.main()
