import hashlib
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "release_hamkare_apk.py"
SPEC = importlib.util.spec_from_file_location("release_hamkare_apk", MODULE_PATH)
release = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release)


class HamkareApkValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.apk = Path(self.temporary.name) / "hamkare.apk"

    def make_apk(self, *, signed=True, missing=None, unsafe_name=None):
        entries = {
            "AndroidManifest.xml": b"manifest",
            "classes.dex": b"dex\n035\x00",
            "resources.arsc": b"resources",
        }
        if missing:
            entries.pop(missing)
        if signed:
            entries["META-INF/CERT.SF"] = b"signature metadata"
            entries["META-INF/CERT.RSA"] = b"signature block"
        if unsafe_name:
            entries[unsafe_name] = b"unsafe"
        with zipfile.ZipFile(self.apk, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)

    def test_valid_signed_apk_passes(self):
        self.make_apk()
        release.validate_apk(self.apk, min_size=1)

    def test_required_apk_entries_are_enforced(self):
        self.make_apk(missing="AndroidManifest.xml")
        with self.assertRaisesRegex(release.ReleaseError, "AndroidManifest.xml"):
            release.validate_apk(self.apk, min_size=1)

    def test_unsigned_archive_is_rejected(self):
        self.make_apk(signed=False)
        with self.assertRaisesRegex(release.ReleaseError, "signing metadata"):
            release.validate_apk(self.apk, min_size=1)

    def test_zip_path_traversal_is_rejected(self):
        self.make_apk(unsafe_name="../outside")
        with self.assertRaisesRegex(release.ReleaseError, "unsafe ZIP path"):
            release.validate_apk(self.apk, min_size=1)

    def test_sha256_mismatch_is_rejected(self):
        self.make_apk()
        wrong = "0" * 64
        with self.assertRaisesRegex(release.ReleaseError, "SHA-256 mismatch"):
            release.verify_file_hash(self.apk, wrong)

    def test_sha256_match_passes(self):
        self.make_apk()
        expected = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        self.assertEqual(release.verify_file_hash(self.apk, expected), expected)

    @mock.patch.object(release.socket, "getaddrinfo")
    def test_private_source_address_is_rejected(self, resolver):
        resolver.return_value = [(2, 1, 6, "", ("127.0.0.1", 443))]
        with self.assertRaisesRegex(release.ReleaseError, "non-public"):
            release.checked_url("https://example.test/app.apk")

    def test_http_and_embedded_credentials_are_rejected(self):
        with self.assertRaisesRegex(release.ReleaseError, "HTTPS"):
            release.checked_url("http://example.com/app.apk")
        with self.assertRaisesRegex(release.ReleaseError, "credentials"):
            release.checked_url("https://user:pass@example.com/app.apk")
        with self.assertRaisesRegex(release.ReleaseError, "control character"):
            release.checked_url("https://example.com/app.apk\nignored")

    def test_workflow_is_manual_main_only_and_does_not_use_release_parts(self):
        workflow = (ROOT / ".github/workflows/publish-hamkare-apk.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("source_url:", workflow)
        self.assertIn("sha256:", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("hamkare.apk#hamkare.apk", workflow)
        self.assertNotIn(".release/parts", workflow)


if __name__ == "__main__":
    unittest.main()
