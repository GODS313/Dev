import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIRECT_ENABLE = (ROOT / 'enable-hamkare-telegram-direct-apk.sh').read_text(encoding='utf-8')
BALE_ENABLE = (ROOT / 'enable-hamkare-bale-direct-apk.sh').read_text(encoding='utf-8')
BOT = (ROOT / 'bot' / 'hamkare_bot.py').read_text(encoding='utf-8')
HEADERS = (ROOT / '_headers').read_text(encoding='utf-8')
RELEASE_CHECKS = (ROOT / '.github' / 'workflows' / 'release-checks.yml').read_text(encoding='utf-8')
DOWNLOADERS = (
    ROOT / 'download.php',
    ROOT / 'hamkare-admin' / 'download.php',
)


class DirectApkStaticTests(unittest.TestCase):
    def test_no_legacy_github_release_bridge_is_runnable(self):
        for relative_path in (
            '.github/workflows/publish-hamkare-apk.yml',
            'enable-hamkare-telegram-apk-release.sh',
            'scripts/publish-hamkare-apk.sh',
        ):
            self.assertFalse((ROOT / relative_path).exists(), relative_path)
        self.assertNotIn('apk-release.conf', RELEASE_CHECKS)
        self.assertNotIn('publish-hamkare-apk.sh', RELEASE_CHECKS)

    def test_only_adlisho_serves_the_live_apk_and_csp_has_no_seskia_source(self):
        self.assertNotIn('seskia.online', HEADERS)
        for downloader in DOWNLOADERS:
            content = downloader.read_text(encoding='utf-8')
            self.assertIn('/var/www/adlisho/app.apk', content)
            self.assertNotIn('seskia', content.lower())

    def test_direct_telegram_pipeline_is_opaque_atomic_and_retires_legacy_state(self):
        self.assertIn('APK_UPLOAD_ENABLED": "true"', DIRECT_ENABLE)
        self.assertIn('APK_DEPLOY_PATH": apk_target', DIRECT_ENABLE)
        self.assertIn('LEGACY_OVERRIDE_FILE=$OVERRIDE_DIR/apk-release.conf', DIRECT_ENABLE)
        self.assertIn('rm -f -- "$LEGACY_OVERRIDE_FILE"', DIRECT_ENABLE)
        for key in (
            'GITHUB_DISPATCH_TOKEN',
            'GITHUB_REPOSITORY',
            'GITHUB_WORKFLOW',
            'APK_SOURCE_URL',
            'RELEASE_WAIT_SECONDS',
        ):
            self.assertIn(key, DIRECT_ENABLE)
        self.assertIn('os.replace(temporary_path, target)', BOT)
        self.assertNotIn('zipfile', BOT)
        self.assertNotIn('apksigner', BOT)

    def test_bale_can_only_present_the_fixed_download_link(self):
        self.assertIn('APK_UPLOAD_ENABLED": "false"', BALE_ENABLE)
        self.assertIn("PUBLIC_URL='https://adlisho.online/download'", BALE_ENABLE)
        self.assertIn('APK_DEPLOY_PATH": ""', BALE_ENABLE)


if __name__ == '__main__':
    unittest.main()
