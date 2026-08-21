import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "repair-hamkare-form-and-apk-panel.sh").read_text(encoding="utf-8")


class RuntimeRepairStaticTests(unittest.TestCase):
    def test_registration_and_panel_are_explicit_fastcgi_routes(self):
        self.assertIn("location = /api/register", SCRIPT)
        self.assertIn("SCRIPT_FILENAME /var/www/adlisho/register.php", SCRIPT)
        self.assertIn("location = /admin/apk.php", SCRIPT)
        self.assertIn("SCRIPT_FILENAME /var/www/adlisho/admin/apk.php", SCRIPT)
        self.assertIn("fastcgi_pass unix:/run/php/php8.3-fpm.sock", SCRIPT)
        self.assertIn("client_max_body_size 205m", SCRIPT)
        self.assertIn("fastcgi_send_timeout 300s", SCRIPT)

    def test_download_is_served_directly_by_vps_nginx(self):
        self.assertIn("location = /download", SCRIPT)
        self.assertIn("alias /var/www/adlisho/app.apk", SCRIPT)
        self.assertIn("application/vnd.android.package-archive", SCRIPT)
        self.assertIn("--resolve adlisho.online:443:127.0.0.1", SCRIPT)
        self.assertIn("cmp -s /var/www/adlisho/app.apk", SCRIPT)

    def test_public_compatibility_routes_are_installed_and_verified(self):
        for route in ("/register/", "/exam/", "/app/"):
            self.assertIn(route, SCRIPT)
        self.assertIn("location = /download.php", SCRIPT)
        self.assertIn("return 302 /download", SCRIPT)
        self.assertIn("for public_path in register/ exam/ app/", SCRIPT)
        self.assertIn("location\\s*=\\s*/download\\.php", SCRIPT)
        self.assertIn("legacy_end = closing_brace", SCRIPT)

    def test_php_source_is_denied_and_configuration_rolls_back(self):
        self.assertIn(r"location ~ \.php$", SCRIPT)
        self.assertIn("return 404;", SCRIPT)
        self.assertIn("trap cleanup EXIT", SCRIPT)
        self.assertIn('cp -a "$BACKUP_DIR/adlisho.conf" "$SITE_CONFIG"', SCRIPT)
        self.assertIn("nginx -t", SCRIPT)

    def test_installs_existing_opaque_apk_panel_and_verifies_boundaries(self):
        self.assertIn("install-hamkare-apk-panel.sh", SCRIPT)
        self.assertIn("https://adlisho.online/admin/apk.php", SCRIPT)
        self.assertIn("https://adlisho.online/api/register", SCRIPT)
        self.assertIn("https://adlisho.online/register.php", SCRIPT)
        self.assertIn('[[ "$source_code" == 404 ]]', SCRIPT)


if __name__ == "__main__":
    unittest.main()
