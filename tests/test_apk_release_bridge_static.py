import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github' / 'workflows' / 'publish-hamkare-apk.yml').read_text(encoding='utf-8')
PUBLISHER = (ROOT / 'scripts' / 'publish-hamkare-apk.sh').read_text(encoding='utf-8')
ENABLE = (ROOT / 'enable-hamkare-telegram-apk-release.sh').read_text(encoding='utf-8')
BOT = (ROOT / 'bot' / 'hamkare_bot.py').read_text(encoding='utf-8')
PANEL_INSTALLER = (ROOT / 'install-seskia-admin-panel.sh').read_text(encoding='utf-8')
RELEASE_CHECKS = (ROOT / '.github' / 'workflows' / 'release-checks.yml').read_text(encoding='utf-8')


class ApkReleaseBridgeStaticTests(unittest.TestCase):
    def test_workflow_is_manual_serialized_and_least_privilege(self):
        self.assertIn('workflow_dispatch:', WORKFLOW)
        self.assertIn('source_url:', WORKFLOW)
        self.assertIn('sha256:', WORKFLOW)
        self.assertIn('contents: write', WORKFLOW)
        self.assertIn('group: hamkare-apk-release', WORKFLOW)
        self.assertIn('cancel-in-progress: false', WORKFLOW)
        self.assertIn('scripts/publish-hamkare-apk.sh', WORKFLOW)
        self.assertNotIn('pull_request_target', WORKFLOW)

    def test_publisher_restricts_source_and_validates_before_release(self):
        for guard in (
            'parsed.hostname != "seskia.online"',
            'parsed.path != "/download.php"',
            'query.get("sha256") != [expected]',
            'MAX_APK_BYTES=20971520',
            'AndroidManifest.xml',
            'classes.dex',
            'unzip -tqq',
            'apksigner verify --verbose --print-certs',
            'AOSP_TEST_CERT',
            'cmp -s "$WORK_DIR/current-signers.txt" "$WORK_DIR/candidate-signers.txt"',
        ):
            self.assertIn(guard, PUBLISHER)
        self.assertLess(PUBLISHER.index('actual_sha256='), PUBLISHER.index('gh release create'))
        self.assertLess(PUBLISHER.index('cmp -s '), PUBLISHER.index('gh release create'))

    def test_release_is_draft_until_asset_upload_and_rolls_back_on_failed_verify(self):
        self.assertIn('$CANDIDATE#hamkare.apk', PUBLISHER)
        self.assertIn('--draft', PUBLISHER)
        self.assertIn('--draft=false --latest', PUBLISHER)
        self.assertIn('gh release delete "$RELEASE_TAG"', PUBLISHER)
        self.assertIn('RELEASE_VERIFIED=1', PUBLISHER)
        self.assertRegex(PUBLISHER, re.compile(r'sha256sum "\$PUBLIC_COPY".*EXPECTED_SHA256'))

    def test_activation_supports_one_selected_platform_and_keeps_secret_out_of_source(self):
        self.assertIn('PLATFORM=telegram', ENABLE)
        self.assertIn('"$PLATFORM" == telegram || "$PLATFORM" == bale', ENABLE)
        self.assertIn('ENV_FILE="$APP_DIR/$PLATFORM.env"', ENABLE)
        self.assertIn('SERVICE="hamkare-$PLATFORM.service"', ENABLE)
        self.assertIn('/run/lock/hamkare-apk-release.lock', ENABLE)
        self.assertIn('"APK_UPLOAD_ENABLED": "true"', ENABLE)
        self.assertIn('"PUBLIC_VERIFY_ENABLED": "true"', ENABLE)
        self.assertIn('"GITHUB_WORKFLOW": "publish-hamkare-apk.yml"', ENABLE)
        self.assertIn('os.fsync(destination.fileno())', ENABLE)
        self.assertIn('os.replace(temporary, path)', ENABLE)
        self.assertNotRegex(ENABLE, r'github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+')

    def test_bot_dispatches_sha_bound_workflow_and_waits_for_public_release(self):
        self.assertIn('def dispatch_release_workflow(', BOT)
        self.assertIn('"ref": "main"', BOT)
        self.assertIn('"source_url": release_source_url(source_url, digest)', BOT)
        self.assertIn('def wait_for_public_apk(', BOT)
        self.assertIn('self.publish_public_apk(user_id, digest)', BOT)
        self.assertIn('SafeGitHubRedirectHandler', BOT)
        self.assertIn('direct_admin_upload = (', BOT)
        self.assertIn('not direct_admin_upload', BOT)

    def test_panel_reinstall_preserves_only_a_complete_bridge(self):
        self.assertIn('bridge_ready = (', PANEL_INSTALLER)
        self.assertIn('current.get("GITHUB_REPOSITORY") == "GODS313/Dev"', PANEL_INSTALLER)
        self.assertIn('current.get("GITHUB_WORKFLOW") == "publish-hamkare-apk.yml"', PANEL_INSTALLER)
        self.assertIn('"APK_UPLOAD_ENABLED": "true"', PANEL_INSTALLER)
        self.assertIn('"APK_UPLOAD_ENABLED": "false"', PANEL_INSTALLER)

    def test_release_ci_syntax_checks_every_bridge_shell_file(self):
        self.assertIn('enable-hamkare-telegram-apk-release.sh', RELEASE_CHECKS)
        self.assertIn('scripts/publish-hamkare-apk.sh', RELEASE_CHECKS)


if __name__ == '__main__':
    unittest.main()
