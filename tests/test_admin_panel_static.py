import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = (ROOT / "seskia-admin" / "panel-lib.php").read_text(encoding="utf-8")
ADMIN = (ROOT / "seskia-admin" / "admin.php").read_text(encoding="utf-8")
INSTALLER = (ROOT / "install-seskia-admin-panel.sh").read_text(encoding="utf-8")
BOT_INSTALLER = (ROOT / "deploy-hamkare-bots.sh").read_text(encoding="utf-8")
DOWNLOAD = (ROOT / "seskia-admin" / "download.php").read_text(encoding="utf-8")


class AdminPanelStaticTests(unittest.TestCase):
    def test_bale_runtime_is_outside_the_admin_installer_scope(self):
        self.assertNotRegex(INSTALLER.lower(), r"/[^\n]*(bale|بله)")
        self.assertNotIn("hamkare-bale.service", INSTALLER)
        self.assertIn("hamkare-telegram.service", INSTALLER)

    def test_recruitment_bots_cannot_publish_apks(self):
        self.assertNotIn("APK_UPLOAD_ENABLED=true", BOT_INSTALLER)
        self.assertEqual(BOT_INSTALLER.count("APK_UPLOAD_ENABLED=false"), 2)
        self.assertNotIn("APK_DEPLOY_PATH=$APK_DEPLOY_PATH", BOT_INSTALLER)

    def test_panel_keeps_secrets_server_side(self):
        self.assertIn("PANEL_CONFIG_FILE = '/var/lib/seskia/config.json'", LIB)
        self.assertIn("panel_mask_token", LIB)
        self.assertNotRegex(ADMIN, r'name="bot_token"[^>]+value=')
        self.assertNotIn("bot_token'] ?>", ADMIN)
        self.assertNotIn("__DIR__ . '/panel-lib.php'", ADMIN)
        self.assertIn("Cache-Control: no-store", LIB)
        self.assertIn("panel_require_csrf", ADMIN)
        self.assertIn("admin_auth_version", LIB)

    def test_apk_pipeline_has_release_guards_and_atomic_publish(self):
        for expected in (
            "apksigner",
            "unzip",
            "PANEL_AOSP_TEST_CERT",
            "apk_signer_sha256",
            "گواهی امضای APK با نسخه رسمی فعلی یکسان نیست",
            "panel_assert_apk_paths",
            "is_link(PANEL_APK_LIVE)",
            "hash_file('sha256'",
            "flock($handle, LOCK_EX)",
            "rename($staged, PANEL_APK_LIVE)",
            "panel_public_apk_matches",
            "panel_restore_rejected",
            "$metadataError",
        ):
            self.assertIn(expected, LIB)

    def test_existing_webhook_and_canonical_download_are_reused(self):
        self.assertIn("https://seskia.online/telegram.php", LIB)
        self.assertIn("https://adlisho.online/download", LIB)
        self.assertNotIn("getUpdates", LIB)
        self.assertNotIn("deleteWebhook', ['drop_pending_updates' => 'true'", LIB)
        self.assertIn("panel_write_config($oldConfig)", LIB)
        self.assertIn("telegram_config_update_failed", LIB)
        self.assertIn("'getChat'", LIB)

    def test_login_rate_limit_is_serialized(self):
        self.assertIn("admin-login-rate.lock", LIB)
        self.assertIn("flock($lock, LOCK_EX)", LIB)
        self.assertIn("$entry['attempts'] >= 5", LIB)

    def test_config_mutations_are_serialized(self):
        self.assertIn("function panel_config_lock", LIB)
        self.assertGreaterEqual(LIB.count("panel_config_lock()"), 3)
        self.assertIn('exec 8>"$STATE_ROOT/admin-config.lock"', INSTALLER)

    def test_browser_upload_is_not_limited_by_telegram_bot_api(self):
        self.assertIn("PANEL_MAX_APK_BYTES = 209715200", LIB)
        self.assertIn('MAX_FILE_SIZE" value="209715200', ADMIN)

    def test_download_is_white_label_cacheable_and_resumable(self):
        self.assertIn('filename="hamkare.apk"', DOWNLOAD)
        self.assertIn("Cache-Control: ' . $cache", DOWNLOAD)
        self.assertIn("CDN-Cache-Control: ' . $cache", DOWNLOAD)
        self.assertIn("Accept-Ranges: bytes", DOWNLOAD)
        self.assertIn("Content-Range: bytes", DOWNLOAD)
        self.assertNotIn("seskia.apk", DOWNLOAD)

    def test_installer_backups_before_overwriting_admin(self):
        backup_position = INSTALLER.index('cp -a "$WEB_ROOT/admin.php"')
        install_position = INSTALLER.index('"$SOURCE_ADMIN" "$WEB_ROOT/admin.php"')
        self.assertLess(backup_position, install_position)
        self.assertIn("trap rollback_install EXIT", INSTALLER)

    def test_root_installer_opens_writable_state_without_following_symlinks(self):
        self.assertIn("os.O_NOFOLLOW", INSTALLER)
        self.assertIn("os.fchown", INSTALLER)
        self.assertNotIn('chown www-data:www-data "$CONFIG_FILE"', INSTALLER)

    def test_existing_recruitment_telegram_uploader_is_disabled_without_secrets_in_logs(self):
        self.assertIn('TELEGRAM_ENV=/opt/hamkare-bots/telegram.env', INSTALLER)
        self.assertIn('"APK_UPLOAD_ENABLED": "false"', INSTALLER)
        self.assertNotIn("print(lines)", INSTALLER)


if __name__ == "__main__":
    unittest.main()
