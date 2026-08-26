import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOT = (ROOT / 'bot' / 'hamkare_master_bot.py').read_text(encoding='utf-8')
DEPLOY = (ROOT / 'deploy-hamkare-master-bot.sh').read_text(encoding='utf-8')


class MasterBotStaticTests(unittest.TestCase):
    def test_never_calls_the_website_to_read_or_write_content(self):
        # The entire point of this bot is to keep working when adlisho.online
        # does not. It must never perform a network call against the site --
        # site_url is only ever used to print a link back to it.
        network_call_lines = [
            line for line in BOT.splitlines()
            if re.search(r'urllib\.request\.(Request|urlopen)\(', line) or 'urlopen(' in line
        ]
        self.assertTrue(network_call_lines, 'no network calls found -- test needs updating')
        for line in network_call_lines:
            self.assertNotIn('adlisho.online', line, f'call to the website leaked in: {line.strip()}')
            self.assertNotIn('site_url', line, f'call built from site_url leaked in: {line.strip()}')

    def test_talks_only_to_cloudflare_and_telegram_apis(self):
        self.assertIn('api.cloudflare.com', BOT)
        self.assertIn('r2.cloudflarestorage.com', BOT)
        self.assertIn('api.telegram.org', BOT)

    def test_r2_requests_are_actually_signed(self):
        self.assertIn('AWS4-HMAC-SHA256', BOT)
        self.assertIn('def _signing_key(', BOT)
        self.assertIn('x-amz-content-sha256', BOT)
        self.assertIn('x-amz-date', BOT)
        # The canonical headers block must end with a lone newline right
        # before signed_headers -- no accidental blank line, or every
        # signature this bot produces would be rejected by R2.
        self.assertIn('{canonical_headers}{signed_headers}', BOT)

    def test_admin_allowlist_is_checked_before_any_state_change(self):
        self.assertIn('user_id not in self.config.admin_ids', BOT)
        self.assertIn('parse_admin_ids', BOT)
        # handle_callback must bail out for non-admins before dispatching.
        callback_body = BOT.split('def handle_callback')[1].split('def handle_message')[0]
        deny_index = callback_body.index('if user_id not in self.config.admin_ids')
        dispatch_index = callback_body.index("if data == \"menu\"")
        self.assertLess(deny_index, dispatch_index)

    def test_every_content_write_bumps_a_revision(self):
        self.assertIn('def write_content(', BOT)
        self.assertIn("'download_page_revision'", BOT)
        self.assertIn('uuid.uuid4().hex', BOT)

    def test_image_uploads_are_sniffed_and_size_capped(self):
        self.assertIn('MAX_IMAGE_BYTES', BOT)
        self.assertIn('def sniff_image_type(', BOT)
        self.assertNotIn('"image/svg', BOT, 'SVG uploads would allow stored XSS via same-origin /media/*')

    def test_deploy_script_requires_scoped_cloudflare_and_r2_credentials(self):
        for value in ('CF_ACCOUNT_ID', 'CF_D1_DATABASE_ID', 'CF_API_TOKEN', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'):
            self.assertIn(value, DEPLOY)
        self.assertIn('prompt_secret CF_API_TOKEN', DEPLOY)
        self.assertIn('prompt_secret R2_SECRET_ACCESS_KEY', DEPLOY)
        self.assertIn('prompt_secret MASTER_BOT_TOKEN', DEPLOY)

    def test_deploy_script_installs_a_single_telegram_only_service(self):
        self.assertIn('hamkare-master-bot.service', DEPLOY)
        self.assertNotIn('bale.env', DEPLOY)


if __name__ == '__main__':
    unittest.main()
