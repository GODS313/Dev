import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOT = (ROOT / 'bot' / 'hamkare_download_bot.py').read_text(encoding='utf-8')
DEPLOY = (ROOT / 'deploy-hamkare-download-bot.sh').read_text(encoding='utf-8')


class DownloadBotStaticTests(unittest.TestCase):
    def test_bot_has_no_registration_or_admin_surface(self):
        # This bot is deliberately dumb: it hands out the download link and
        # nothing else. It must stay separate from the recruitment bot's
        # registration flow and admin/APK-management commands.
        for forbidden in ('ADMIN_ACTIONS', 'national_id', 'AndroidManifest', 'admin_upload', 'rollback'):
            self.assertNotIn(forbidden, BOT, f'{forbidden} leaked into the download-only bot')

    def test_bot_only_reads_content_it_does_not_write_it(self):
        self.assertNotIn('PUT', BOT)
        self.assertNotIn('X-Admin-Key', BOT)
        self.assertIn('CONTENT_API_URL', BOT)

    def test_content_fetch_is_https_only_and_bounded(self):
        self.assertIn('valid_https_url', BOT)
        self.assertIn('256 * 1024', BOT, 'content response body is not size-bounded')

    def test_content_cache_has_a_ttl_so_it_does_not_hammer_the_api(self):
        self.assertIn('CONTENT_CACHE_SECONDS', BOT)
        self.assertIn('time.monotonic()', BOT)

    def test_falls_back_to_default_content_when_the_site_is_unreachable(self):
        self.assertIn('DEFAULT_CONTENT', BOT)
        self.assertIn('except Exception:', BOT)

    def test_supports_both_messengers_with_correct_api_hosts(self):
        self.assertIn('api.telegram.org/bot', BOT)
        self.assertIn('tapi.bale.ai/bot', BOT)
        self.assertIn('PLATFORM must be telegram or bale', BOT)

    def test_deploy_script_uses_separate_tokens_from_the_recruitment_bot(self):
        self.assertIn('توکن ربات دانلود تلگرام', DEPLOY)
        self.assertIn('hamkare-download-telegram.service', DEPLOY)
        self.assertIn('hamkare-download-bale.service', DEPLOY)
        self.assertNotIn('ADMIN_IDS', DEPLOY)

    def test_deploy_script_installs_with_systemd_hardening(self):
        for directive in ('ProtectSystem=strict', 'NoNewPrivileges=true', 'PrivateDevices=true'):
            self.assertIn(directive, DEPLOY)
        self.assertIn('python3 -m py_compile', DEPLOY)


if __name__ == '__main__':
    unittest.main()
