import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = (ROOT / 'install-hamkare-admin-vps.sh').read_text(encoding='utf-8')
CONFIG_API = (ROOT / 'functions' / 'api' / 'admin' / 'config.js').read_text(encoding='utf-8')
SYNC_API = (ROOT / 'functions' / 'api' / 'admin' / 'sync.js').read_text(encoding='utf-8')
DOWNLOAD = (ROOT / 'functions' / 'download.js').read_text(encoding='utf-8')
RELEASE_PUBLISHER = (ROOT / 'scripts' / 'publish-hamkare-apk.sh').read_text(encoding='utf-8')
TELEGRAM_RELEASE_ENABLE = (ROOT / 'enable-hamkare-telegram-apk-release.sh').read_text(encoding='utf-8')
PRODUCTION_DOCS = {
    'README.md': (ROOT / 'README.md').read_text(encoding='utf-8'),
    'DEPLOYMENT.md': (ROOT / 'DEPLOYMENT.md').read_text(encoding='utf-8'),
}
RELEASE_URL_RE = re.compile(
    r'https://github\.com/GODS313/Dev/releases/latest/download/[A-Za-z0-9._-]+\.apk'
)
PUBLIC_URL_RE = re.compile(r'https://adlisho\.online/download\.php')
SYNC_TOP_LEVEL_KEYS = {
    'revision',
    'canonical_download_url',
    'download_source',
    'telegram',
    'bale',
}
SYNC_PLATFORM_KEYS = {'token', 'chat_id'}


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

    def test_release_target_does_not_drift_across_runtime_and_production_docs(self):
        sources = {
            'functions/api/admin/sync.js': SYNC_API,
            'functions/download.js': DOWNLOAD,
            'scripts/publish-hamkare-apk.sh': RELEASE_PUBLISHER,
            **PRODUCTION_DOCS,
        }
        urls_by_source = {
            name: set(RELEASE_URL_RE.findall(content))
            for name, content in sources.items()
        }
        for name, urls in urls_by_source.items():
            self.assertEqual(len(urls), 1, f'exactly one canonical release target is required in {name}')
        canonical = urls_by_source['functions/api/admin/sync.js']
        for name, urls in urls_by_source.items():
            self.assertEqual(urls, canonical, f'download target drifted in {name}')

    def test_public_adlisho_target_does_not_drift(self):
        sources = {
            'functions/api/admin/sync.js': SYNC_API,
            'install-hamkare-admin-vps.sh': INSTALLER,
            'enable-hamkare-telegram-apk-release.sh': TELEGRAM_RELEASE_ENABLE,
            **PRODUCTION_DOCS,
        }
        for name, content in sources.items():
            self.assertEqual(
                set(PUBLIC_URL_RE.findall(content)),
                {'https://adlisho.online/download.php'},
                f'public Adlisho target drifted in {name}',
            )

    def test_sync_contract_keys_do_not_drift_between_producer_consumer_and_docs(self):
        response = re.search(r'return json\(\{\n(?P<body>.*?)\n\s*\}\);', SYNC_API, re.DOTALL)
        self.assertIsNotNone(response, 'sync response object was not found')
        produced_top_level = set(re.findall(r'^\s+([a-z][a-z0-9_]*)\s*:', response.group('body'), re.MULTILINE))

        platform = re.search(r'return \{ (?P<body>token:.*?chat_id:.*?) \};', SYNC_API)
        self.assertIsNotNone(platform, 'platform settings object was not found')
        produced_platform = set(re.findall(r'([a-z][a-z0-9_]*)\s*:', platform.group('body')))

        consumed_top_level = set(re.findall(r'data\.get\("([a-z][a-z0-9_]*)"', INSTALLER))
        consumed_top_level.update(re.findall(r'\("(telegram|bale)",\s*(?:TG|BALE)_ENV\)', INSTALLER))
        consumed_platform = set(re.findall(r'value\.get\("([a-z][a-z0-9_]*)"', INSTALLER))

        self.assertEqual(produced_top_level, SYNC_TOP_LEVEL_KEYS)
        self.assertEqual(consumed_top_level, SYNC_TOP_LEVEL_KEYS)
        self.assertEqual(produced_platform, SYNC_PLATFORM_KEYS)
        self.assertEqual(consumed_platform, SYNC_PLATFORM_KEYS)

        for name, content in PRODUCTION_DOCS.items():
            for key in SYNC_TOP_LEVEL_KEYS | SYNC_PLATFORM_KEYS:
                self.assertIn(f'`{key}`', content, f'{key} is missing from {name}')

    def test_legacy_vps_panel_is_redirect_only(self):
        self.assertIn("Location: https://adlisho.online/admin", INSTALLER)
        self.assertNotIn("مدیریت دانلود، تلگرام و بله", INSTALLER)

    def test_remote_sync_is_proven_before_legacy_writer_is_retired(self):
        preflight = INSTALLER.index('  "$SYNC_PROGRAM"')
        retirement = INSTALLER.index('rm -f /etc/sudoers.d/hamkare-admin')
        self.assertLess(preflight, retirement)


if __name__ == '__main__':
    unittest.main()
