import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = (ROOT / "hamkare-admin" / "panel-lib.php").read_text(encoding="utf-8")
ADMIN = (ROOT / "hamkare-admin" / "admin.php").read_text(encoding="utf-8")
INSTALLER = (ROOT / "install-hamkare-apk-panel.sh").read_text(encoding="utf-8")
BOT_INSTALLER = (ROOT / "deploy-hamkare-bots.sh").read_text(encoding="utf-8")
DOWNLOAD = (ROOT / "hamkare-admin" / "download.php").read_text(encoding="utf-8")
BOT = (ROOT / "bot" / "hamkare_bot.py").read_text(encoding="utf-8")
WRAPPER = (ROOT / "deploy-apk-panel-vps.sh").read_text(encoding="utf-8")
DIRECT_ENABLE = (ROOT / "enable-hamkare-telegram-direct-apk.sh").read_text(encoding="utf-8")


class AdminPanelStaticTests(unittest.TestCase):
    def test_panel_is_adlisho_only(self):
        production = "\n".join((LIB, ADMIN, INSTALLER, DOWNLOAD))
        self.assertNotIn("seskia", production.lower())
        self.assertIn("PANEL_CONFIG_FILE = '/var/lib/hamkare-apk-panel/config.json'", LIB)
        self.assertIn("PANEL_APK_LIVE = '/var/www/adlisho/app.apk'", LIB)
        self.assertIn("PANEL_PUBLIC_URL = 'https://adlisho.online/download'", LIB)
        self.assertIn("https://adlisho.online/admin/apk.php", INSTALLER)

    def test_bale_runtime_is_outside_the_admin_installer_scope(self):
        self.assertNotRegex(INSTALLER.lower(), r"/[^\n]*(bale|بله)")
        self.assertNotIn("hamkare-bale.service", INSTALLER)
        self.assertNotIn("hamkare-telegram.service", INSTALLER)

    def test_recruitment_bots_cannot_publish_apks_by_default(self):
        self.assertNotIn("APK_UPLOAD_ENABLED=true", BOT_INSTALLER)
        self.assertEqual(BOT_INSTALLER.count("APK_UPLOAD_ENABLED=false"), 2)

    def test_panel_keeps_secrets_server_side(self):
        self.assertNotRegex(ADMIN, r'name="bot_token"[^>]+value=')
        self.assertNotIn("__DIR__ . '/panel-lib.php'", ADMIN)
        self.assertIn("Cache-Control: no-store", LIB)
        self.assertIn("panel_require_csrf", ADMIN)
        self.assertIn("admin_auth_version", LIB)

    def test_login_never_enters_a_timed_lockout(self):
        self.assertNotIn("blocked_until", LIB)
        self.assertNotIn("۱۵ دقیقه", LIB)
        self.assertNotIn("PANEL_LOGIN_RATE", LIB)
        self.assertIn("usleep(700000)", LIB)
        self.assertIn('rm -f -- "$STATE_ROOT/admin-login-rate.json" "$STATE_ROOT/admin-login-rate.lock"', INSTALLER)

    def test_first_login_atomically_sets_the_initial_password(self):
        self.assertIn("admin_password_initialized", LIB)
        self.assertIn("panel_config_lock()", LIB)
        self.assertIn("password_hash($password, PASSWORD_DEFAULT)", LIB)
        self.assertIn("رمز اولیه باید حداقل ۸ کاراکتر باشد", LIB)
        self.assertNotIn("برای حفظ رمز فعلی Enter بزنید", INSTALLER)
        self.assertIn('minlength="8"', ADMIN)

    def test_apk_pipeline_treats_upload_as_opaque_and_publishes_atomically(self):
        for forbidden in (
            "apksigner", "unzip", "ZipArchive", "AndroidManifest.xml",
            "classes.dex", "apk_signer_sha256", "certificate_sha256",
        ):
            self.assertNotIn(forbidden, LIB)
        for expected in (
            "panel_assert_apk_paths", "is_link(PANEL_APK_LIVE)",
            "hash_file('sha256'", "flock($handle, LOCK_EX)",
            "rename($staged, PANEL_APK_LIVE)", "panel_public_apk_matches",
            "panel_restore_rejected", "'validation_mode' => 'opaque-bytes'",
        ):
            self.assertIn(expected, LIB)
        self.assertIn('enctype="multipart/form-data"', ADMIN)
        self.assertIn('بدون بازکردن، تغییر یا بررسی امضا', ADMIN)

    def test_browser_upload_limit_and_download_contract(self):
        self.assertIn("PANEL_MAX_APK_BYTES = 209715200", LIB)
        self.assertIn('MAX_FILE_SIZE" value="209715200', ADMIN)
        self.assertIn('filename="hamkare.apk"', DOWNLOAD)
        self.assertIn("Accept-Ranges: bytes", DOWNLOAD)
        self.assertIn("Content-Range: bytes", DOWNLOAD)

    def test_publish_verification_bypasses_public_dns_and_proxies(self):
        self.assertIn("CURLOPT_RESOLVE => ['adlisho.online:443:127.0.0.1']", LIB)
        self.assertIn("CURLOPT_NOPROXY => '*'", LIB)
        self.assertIn("CURLOPT_FOLLOWLOCATION => false", LIB)

    def test_installer_is_recoverable_and_grants_php_required_access(self):
        self.assertIn("trap rollback_install EXIT", INSTALLER)
        self.assertIn('install -d -o www-data -g www-data -m 0700 "$STATE_ROOT"', INSTALLER)
        self.assertIn('runuser -u www-data -- test -w "$STATE_ROOT"', INSTALLER)
        self.assertIn('runuser -u www-data -- test -w "$WEB_ROOT"', INSTALLER)
        self.assertIn('chown "$WEB_ROOT_UID:$WEB_ROOT_GID" "$WEB_ROOT"', INSTALLER)

    def test_installer_does_not_mutate_bot_settings(self):
        self.assertNotIn('TELEGRAM_ENV=', INSTALLER)
        self.assertNotIn('telegram.env', INSTALLER)
        self.assertNotIn('APK_UPLOAD_ENABLED', INSTALLER)
        self.assertNotIn('GITHUB_DISPATCH_TOKEN', INSTALLER)

    def test_one_command_enables_web_and_existing_telegram_bot(self):
        self.assertIn('install-hamkare-apk-panel.sh', WRAPPER)
        self.assertIn('enable-hamkare-telegram-direct-apk.sh', WRAPPER)
        self.assertIn('BOT_APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"', WRAPPER)

    def test_web_and_telegram_share_one_atomic_publish_lock(self):
        self.assertIn("PANEL_APK_STAGE . '/publish.lock'", LIB)
        self.assertEqual(BOT.count('stage_dir / "publish.lock"'), 3)
        self.assertIn('chown www-data:www-data "$APK_STAGE/publish.lock"', DIRECT_ENABLE)


if __name__ == "__main__":
    unittest.main()
