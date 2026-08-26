import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTENT_LIB = (ROOT / 'functions' / '_lib' / 'content.js').read_text(encoding='utf-8')
SECURITY_LIB = (ROOT / 'functions' / '_lib' / 'security.js').read_text(encoding='utf-8')
ADMIN_PAGE_API = (ROOT / 'functions' / 'api' / 'admin' / 'download-page.js').read_text(encoding='utf-8')
PUBLIC_PAGE_API = (ROOT / 'functions' / 'api' / 'download-page.js').read_text(encoding='utf-8')
ADMIN_MEDIA_API = (ROOT / 'functions' / 'api' / 'admin' / 'media.js').read_text(encoding='utf-8')
PUBLIC_MEDIA_ROUTE = (ROOT / 'functions' / 'media' / '[id].js').read_text(encoding='utf-8')
DL_PAGE = (ROOT / 'functions' / 'dl.js').read_text(encoding='utf-8')
ADMIN_HTML = (ROOT / 'admin.html').read_text(encoding='utf-8')
MIGRATION = (ROOT / 'migrations' / '002_download_page_and_media.sql').read_text(encoding='utf-8')

DEFAULT_CONTENT_KEYS = {
    'app_name', 'tagline', 'description', 'cta_label', 'version_label', 'footer_note',
    'telegram_url', 'bale_url', 'features', 'theme', 'logo_media_id', 'icon_media_id',
    'screenshot_media_ids',
}


class DownloadPageCmsStaticTests(unittest.TestCase):
    def test_default_content_declares_every_field_dl_and_admin_consume(self):
        declared = set(re.findall(r'^\s{2}([a-z][a-z0-9_]*):', CONTENT_LIB, re.MULTILINE))
        self.assertTrue(DEFAULT_CONTENT_KEYS.issubset(declared))
        text_fields = DEFAULT_CONTENT_KEYS - {
            'features', 'theme', 'logo_media_id', 'icon_media_id', 'screenshot_media_ids',
        }
        for field in text_fields:
            self.assertIn(f'c.{field}', DL_PAGE, f'{field} missing from /dl renderer')
            self.assertIn(f'f_{field}', ADMIN_HTML, f'{field} missing from the admin form')
        # Media fields are managed as uploads, not text inputs -- check their own hooks instead.
        for media_field in ('logo', 'icon'):
            self.assertIn(f'{media_field}File', ADMIN_HTML)
            self.assertIn(f'{media_field}_url', DL_PAGE)

    def test_admin_endpoints_require_the_shared_admin_check(self):
        for source, name in ((ADMIN_PAGE_API, 'download-page.js'), (ADMIN_MEDIA_API, 'media.js')):
            self.assertIn('requireAdmin(request, env)', source, f'{name} skips admin auth')
            self.assertIn("import { json, requireAdmin } from", source)

    def test_public_endpoints_never_require_admin_key(self):
        self.assertNotIn('requireAdmin', PUBLIC_PAGE_API)
        self.assertNotIn('X-Admin-Key', PUBLIC_PAGE_API)
        self.assertNotIn('requireAdmin', PUBLIC_MEDIA_ROUTE)

    def test_every_content_save_bumps_a_revision(self):
        for source, name in ((ADMIN_PAGE_API, 'download-page.js'), (ADMIN_MEDIA_API, 'media.js')):
            self.assertIn('download_page_revision', source, f'{name} does not bump the revision')
            self.assertIn('crypto.randomUUID()', source)

    def test_media_upload_validates_size_and_sniffs_real_image_bytes(self):
        self.assertIn('MAX_BYTES', ADMIN_MEDIA_API)
        self.assertIn('sniffType(bytes)', ADMIN_MEDIA_API)
        self.assertIn("bytes[0] === 0x89", ADMIN_MEDIA_API, 'PNG magic bytes are not checked')
        self.assertIn("bytes[0] === 0xff && bytes[1] === 0xd8", ADMIN_MEDIA_API, 'JPEG magic bytes are not checked')
        self.assertNotIn('image/svg', ADMIN_MEDIA_API, 'SVG upload would allow stored XSS via same-origin /media/*')

    def test_media_route_only_serves_ids_matching_the_upload_naming_scheme(self):
        self.assertIn(r'^[a-f0-9-]{8,64}\.(png|jpe?g|webp)$', PUBLIC_MEDIA_ROUTE)
        self.assertIn('object.writeHttpMetadata(headers)', PUBLIC_MEDIA_ROUTE)

    def test_dl_page_escapes_free_text_cms_fields_before_interpolating(self):
        # Anything an admin can type into a text field must go through esc()
        # at least once before it lands in the HTML the browser parses.
        free_text_fields = ('app_name', 'tagline', 'description', 'cta_label', 'version_label', 'footer_note')
        for field in free_text_fields:
            self.assertIn(f'esc(c.{field})', DL_PAGE, f'c.{field} is never escaped in /dl')
        self.assertIn('const esc =', DL_PAGE)
        self.assertIn('.replace(/[&<>"\']/g', DL_PAGE)

    def test_migration_creates_both_new_tables_with_expected_columns(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS site_content', MIGRATION)
        self.assertIn('CREATE TABLE IF NOT EXISTS media_assets', MIGRATION)
        self.assertIn('id TEXT PRIMARY KEY', MIGRATION)
        self.assertIn('slot TEXT', MIGRATION)

    def test_security_lib_uses_constant_time_comparison(self):
        self.assertIn('mismatch |=', SECURITY_LIB)
        self.assertIn('left.length !== right.length', SECURITY_LIB)


if __name__ == '__main__':
    unittest.main()
