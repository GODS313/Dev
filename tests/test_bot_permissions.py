import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "bot" / "hamkare_bot.py"
SPEC = importlib.util.spec_from_file_location("hamkare_bot", MODULE_PATH)
BOT = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = BOT
SPEC.loader.exec_module(BOT)


class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.admins = frozenset({"10001"})

    def test_iranian_mobile_normalization(self):
        self.assertEqual(BOT.normalize_iranian_mobile("۰۹۱۲ ۳۴۵ ۶۷۸۹"), "09123456789")
        self.assertEqual(BOT.normalize_iranian_mobile("+989123456789"), "09123456789")
        self.assertEqual(BOT.normalize_iranian_mobile("00989123456789"), "09123456789")
        self.assertEqual(BOT.normalize_iranian_mobile("123"), "")

    def test_apk_archive_accepts_encrypted_entries_for_signature_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "protected.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("AndroidManifest.xml", b"manifest")
                archive.writestr("classes.dex", b"dex\n" + b"0" * 1200)
            data = bytearray(path.read_bytes())
            marker = data.find(b"classes.dex")
            self.assertGreater(marker, 0)
            local_header = data.rfind(b"PK\x03\x04", 0, marker)
            data[local_header + 6 : local_header + 8] = (
                int.from_bytes(data[local_header + 6 : local_header + 8], "little") | 1
            ).to_bytes(2, "little")
            central_header = data.find(b"PK\x01\x02")
            while central_header >= 0:
                name_length = int.from_bytes(data[central_header + 28 : central_header + 30], "little")
                name = bytes(data[central_header + 46 : central_header + 46 + name_length])
                if name == b"classes.dex":
                    data[central_header + 8 : central_header + 10] = (
                        int.from_bytes(data[central_header + 8 : central_header + 10], "little") | 1
                    ).to_bytes(2, "little")
                    break
                central_header = data.find(b"PK\x01\x02", central_header + 4)
            path.write_bytes(data)
            size, digest = BOT.verify_apk_archive(path)
            self.assertEqual(size, path.stat().st_size)
            self.assertEqual(len(digest), 64)

    def test_admin_actions_are_denied_to_regular_users(self):
        for action in BOT.ADMIN_ACTIONS:
            self.assertFalse(BOT.can_access_action(action, "20002", self.admins))
            self.assertTrue(BOT.can_access_action(action, "10001", self.admins))

    def test_non_admin_actions_remain_available(self):
        for action in ("menu", "register", "download", "privacy", "help", "cancel"):
            self.assertTrue(BOT.can_access_action(action, "20002", self.admins))

    def test_apk_upload_is_telegram_admin_only(self):
        self.assertTrue(BOT.can_upload_apk("telegram", "10001", self.admins, True))
        self.assertFalse(BOT.can_upload_apk("telegram", "20002", self.admins, True))
        self.assertTrue(BOT.can_upload_apk("bale", "10001", self.admins, True))
        self.assertFalse(BOT.can_upload_apk("telegram", "10001", self.admins, False))

    def test_admin_id_parser_rejects_ambiguous_values(self):
        self.assertEqual(BOT.parse_admin_ids("10001,20002"), frozenset({"10001", "20002"}))
        for value in ("", "10001,user", "-10001", "1"):
            with self.assertRaises(ValueError):
                BOT.parse_admin_ids(value)

    def test_admin_buttons_are_not_rendered_for_regular_users(self):
        with tempfile.TemporaryDirectory() as directory:
            config = BOT.Config(
                platform="telegram",
                token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
                log_chat_id="-1001234567890",
                admin_ids=self.admins,
                download_url="https://adlisho.online/download.php",
                site_url="https://adlisho.online",
                support_url="https://adlisho.online/contact.html",
                privacy_url="https://adlisho.online/privacy.html",
                tracking_url="https://adlisho.online/result.html",
                brand_name="همکاره",
                database_path=Path(directory) / "bot.sqlite3",
                apk_upload_enabled=True,
                apk_deploy_path=Path(directory) / "app.apk",
                max_apk_bytes=20 * 1024 * 1024,
            )
            bot = BOT.Bot(config)
            user_callbacks = {
                button.get("callback_data")
                for row in bot.user_menu("20002")
                for button in row
                if button.get("callback_data")
            }
            admin_callbacks = {
                button.get("callback_data")
                for row in bot.user_menu("10001")
                for button in row
                if button.get("callback_data")
            }
            panel_callbacks = {
                button.get("callback_data")
                for row in bot.admin_menu()
                for button in row
                if button.get("callback_data")
            }
            self.assertNotIn("admin_panel", user_callbacks)
            self.assertNotIn("admin_upload", user_callbacks)
            self.assertIn("admin_panel", admin_callbacks)
            self.assertIn("admin_upload", panel_callbacks)
            self.assertIn("admin_rollback", panel_callbacks)

    def test_bale_download_button_uses_the_canonical_adlisho_endpoint(self):
        expected = "https://adlisho.online/download.php"
        with tempfile.TemporaryDirectory() as directory:
            config = BOT.Config(
                platform="bale",
                token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
                log_chat_id="-1001234567890",
                admin_ids=self.admins,
                download_url=expected,
                site_url="https://adlisho.online",
                support_url="https://adlisho.online/contact.html",
                privacy_url="https://adlisho.online/privacy.html",
                tracking_url="https://adlisho.online/result.html",
                brand_name="همکاره",
                database_path=Path(directory) / "bale.sqlite3",
                apk_upload_enabled=False,
                apk_deploy_path=None,
                max_apk_bytes=20 * 1024 * 1024,
            )
            bot = BOT.Bot(config)
            sent = []
            bot.send = lambda chat_id, text, keyboard=None: sent.append((chat_id, text, keyboard))
            bot.download("10001", "10001")
            self.assertEqual(sent[-1][2][0][0]["url"], expected)


class ValidationTests(unittest.TestCase):
    @staticmethod
    def config_for(directory, **overrides):
        values = dict(
            platform="telegram",
            token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
            log_chat_id="-1001234567890",
            admin_ids=frozenset({"10001"}),
            download_url="https://adlisho.online/download.php",
            site_url="https://adlisho.online",
            support_url="https://adlisho.online/contact.html",
            privacy_url="https://adlisho.online/privacy.html",
            tracking_url="https://adlisho.online/result.html",
            brand_name="همکاره",
            database_path=Path(directory) / "bot.sqlite3",
            apk_upload_enabled=True,
            apk_deploy_path=Path(directory) / "app.apk",
            max_apk_bytes=20 * 1024 * 1024,
            apk_stage_dir=Path(directory) / ".stage",
            public_verify_enabled=False,
        )
        values.update(overrides)
        return BOT.Config(**values)

    def test_person_names_are_single_line_and_directionally_safe(self):
        for value in ("علی", "زهرا سادات", "سارا-محمدی", "O'Connor", "می\u200cنویسد"):
            self.assertEqual(BOT.normalize_person_name(value, 70), value)
        for value in (
            "علی\nنقش: مدیر",
            "علی\tمحمدی",
            "علی\u202eexe.apk",
            "@admin",
            "https://example.com",
            "علی123",
        ):
            self.assertEqual(BOT.normalize_person_name(value, 70), "")

    def test_only_safe_https_urls_are_accepted(self):
        self.assertTrue(BOT.valid_https_url("https://adlisho.online/result.html"))
        for value in (
            "http://adlisho.online",
            "javascript:alert(1)",
            "https://user:pass@example.com",
            "https://example.com\nX-Test: injected",
            "/relative",
        ):
            self.assertFalse(BOT.valid_https_url(value))

    def test_release_source_is_sha_bound_and_host_restricted(self):
        digest = "a" * 64
        self.assertEqual(
            BOT.release_source_url(
                "https://seskia.online/download.php?src=github-release", digest
            ),
            "https://seskia.online/download.php?src=github-release&sha256=" + digest,
        )
        for value in (
            "https://evil.example/download.php?src=github-release",
            "https://seskia.online/other.php?src=github-release",
            "https://seskia.online/download.php?src=other",
            "https://user@seskia.online/download.php?src=github-release",
        ):
            with self.assertRaises(ValueError):
                BOT.release_source_url(value, digest)
        with self.assertRaises(ValueError):
            BOT.release_source_url(
                "https://seskia.online/download.php?src=github-release", "not-a-digest"
            )

    def test_github_dispatch_contains_only_the_approved_contract(self):
        response = mock.MagicMock()
        response.status = 204
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with mock.patch.object(BOT.urllib.request, "urlopen", return_value=response) as request_call:
            BOT.dispatch_release_workflow(
                "x" * 40,
                "GODS313/Dev",
                "publish-hamkare-apk.yml",
                "https://seskia.online/download.php?src=github-release",
                "b" * 64,
            )
        request = request_call.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://api.github.com/repos/GODS313/Dev/actions/workflows/"
            "publish-hamkare-apk.yml/dispatches",
        )
        payload = json.loads(request.data)
        self.assertEqual(payload["ref"], "main")
        self.assertEqual(payload["inputs"]["sha256"], "b" * 64)
        self.assertIn("sha256=" + "b" * 64, payload["inputs"]["source_url"])
        self.assertNotIn("x" * 40, request.data.decode())

    def test_known_valid_and_invalid_national_ids(self):
        self.assertTrue(BOT.valid_national_id("0013541579"))
        self.assertTrue(BOT.valid_national_id("۰۰۱۳۵۴۱۵۷۹"))
        self.assertFalse(BOT.valid_national_id("1111111111"))
        self.assertFalse(BOT.valid_national_id("0013541578"))

    def test_apk_validation_requires_android_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            valid_path = Path(directory) / "valid.apk"
            with zipfile.ZipFile(valid_path, "w") as archive:
                archive.writestr("AndroidManifest.xml", b"x" * 800)
                archive.writestr("classes.dex", b"y" * 800)
            size, digest = BOT.verify_apk_archive(valid_path)
            self.assertGreater(size, 1024)
            self.assertEqual(len(digest), 64)

            invalid_path = Path(directory) / "invalid.apk"
            with zipfile.ZipFile(invalid_path, "w") as archive:
                archive.writestr("readme.txt", b"not an apk" * 200)
            with self.assertRaises(ValueError):
                BOT.verify_apk_archive(invalid_path)

    def test_apk_signature_requires_verifier_and_rejects_public_test_key(self):
        apk_path = Path("/tmp/release.apk")
        with mock.patch.object(BOT.shutil, "which", return_value=None):
            with self.assertRaisesRegex(ValueError, "ابزار بررسی امضای APK"):
                BOT.verify_apk_signature(apk_path)

        test_key_output = (
            "Signer #1 certificate SHA-256 digest: "
            "a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc"
        )
        with (
            mock.patch.object(BOT.shutil, "which", return_value="/usr/bin/apksigner"),
            mock.patch.object(
                BOT.subprocess,
                "run",
                return_value=mock.Mock(returncode=0, stdout=test_key_output, stderr=""),
            ),
        ):
            with self.assertRaisesRegex(ValueError, "کلید عمومی تست"):
                BOT.verify_apk_signature(apk_path)

        release_output = "Signer #1 certificate SHA-256 digest: " + "b" * 64
        with (
            mock.patch.object(BOT.shutil, "which", return_value="/usr/bin/apksigner"),
            mock.patch.object(
                BOT.subprocess,
                "run",
                return_value=mock.Mock(returncode=0, stdout=release_output, stderr=""),
            ),
        ):
            self.assertTrue(BOT.verify_apk_signature(apk_path))

    def test_bad_apk_mime_is_rejected_before_network_or_file_write(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = BOT.Bot(self.config_for(directory))
            messages = []
            bot.send = lambda chat_id, text, keyboard=None: messages.append(text)
            bot.set_admin_state("10001", "awaiting_apk")
            handled = bot.handle_apk_upload(
                {
                    "document": {
                        "file_name": "app.apk",
                        "file_id": "file-1",
                        "file_size": 2048,
                        "mime_type": "text/html",
                    }
                },
                "10001",
                10001,
            )
            self.assertTrue(handled)
            self.assertIn("MIME", messages[-1])
            self.assertFalse((Path(directory) / "app.apk").exists())

    @staticmethod
    def apk_bytes(marker):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("AndroidManifest.xml", marker * 900)
            archive.writestr("classes.dex", marker * 900)
        return output.getvalue()

    def test_authorized_upload_duplicate_and_rollback_pipeline(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = BOT.Bot(self.config_for(directory))
            messages = []
            bot.send = lambda chat_id, text, keyboard=None: messages.append(text)
            bot.api = lambda method, payload, attempts=3: {
                "ok": True,
                "result": {"file_path": "documents/app.apk"},
            }
            target = Path(directory) / "app.apk"
            previous = self.apk_bytes(b"A")
            updated = self.apk_bytes(b"B")
            target.write_bytes(previous)
            document = {
                "document": {
                    "file_name": "hamkare.apk",
                    "file_id": "file-1",
                    "file_size": len(updated),
                    "mime_type": "application/vnd.android.package-archive",
                }
            }
            with (
                mock.patch.object(
                    BOT.urllib.request,
                    "urlopen",
                    side_effect=lambda *args, **kwargs: io.BytesIO(updated),
                ),
                mock.patch.object(BOT, "verify_apk_signature", return_value=True),
            ):
                bot.set_admin_state("10001", "awaiting_apk")
                self.assertTrue(bot.handle_apk_upload(document, "10001", 10001))
                self.assertEqual(target.read_bytes(), updated)
                backups_after_publish = list(bot.backup_dir().glob("app-*.apk"))
                self.assertEqual(len(backups_after_publish), 1)

                bot.set_admin_state("10001", "awaiting_apk")
                self.assertTrue(bot.handle_apk_upload(document, "10001", 10001))
                self.assertEqual(len(list(bot.backup_dir().glob("app-*.apk"))), 1)
                self.assertIn("همین حالا نسخه فعال", messages[-1])

                bot.prepare_apk_rollback(10001, "10001")
                bot.rollback_apk(10001, "10001")
                self.assertEqual(target.read_bytes(), previous)
                self.assertIn("نسخه قبلی بازگردانی شد", messages[-1])

    def test_public_checksum_mismatch_restores_previous_apk(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = BOT.Bot(self.config_for(directory, public_verify_enabled=True))
            messages = []
            bot.send = lambda chat_id, text, keyboard=None: messages.append(text)
            bot.api = lambda method, payload, attempts=3: {
                "ok": True,
                "result": {"file_path": "documents/app.apk"},
            }
            target = Path(directory) / "app.apk"
            previous = self.apk_bytes(b"A")
            updated = self.apk_bytes(b"B")
            target.write_bytes(previous)
            document = {
                "document": {
                    "file_name": "hamkare.apk",
                    "file_id": "file-1",
                    "file_size": len(updated),
                    "mime_type": "application/vnd.android.package-archive",
                }
            }
            with (
                mock.patch.object(
                    BOT.urllib.request,
                    "urlopen",
                    side_effect=lambda *args, **kwargs: io.BytesIO(updated),
                ),
                mock.patch.object(BOT, "verify_apk_signature", return_value=True),
                mock.patch.object(BOT, "public_apk_matches", return_value=False),
            ):
                bot.set_admin_state("10001", "awaiting_apk")
                self.assertTrue(bot.handle_apk_upload(document, "10001", 10001))
            self.assertEqual(target.read_bytes(), previous)
            self.assertIn("نسخه قبلی خودکار بازگردانده شد", messages[-1])

    def test_oversized_apk_is_rejected_before_download(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = BOT.Bot(self.config_for(directory))
            messages = []
            bot.send = lambda chat_id, text, keyboard=None: messages.append(text)
            bot.api = mock.Mock(side_effect=AssertionError("network must not be called"))
            bot.set_admin_state("10001", "awaiting_apk")
            handled = bot.handle_apk_upload(
                {
                    "document": {
                        "file_name": "app.apk",
                        "file_id": "file-1",
                        "file_size": bot.config.max_apk_bytes + 1,
                        "mime_type": "application/vnd.android.package-archive",
                    }
                },
                "10001",
                10001,
            )
            self.assertTrue(handled)
            self.assertIn("اندازه", messages[-1])

    def test_admin_upload_state_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = BOT.Bot(self.config_for(directory))
            bot.set_admin_state("10001", "awaiting_apk")
            bot.connection.execute(
                "UPDATE admin_sessions SET created_at=datetime('now','-11 minutes')"
            )
            bot.connection.commit()
            self.assertEqual(bot.admin_state("10001"), "")

    def test_environment_rejects_apk_target_outside_publish_roots(self):
        environment = {
            "PLATFORM": "telegram",
            "BOT_TOKEN": "1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
            "LOG_CHAT_ID": "-1001234567890",
            "ADMIN_IDS": "10001",
            "DOWNLOAD_URL": "https://adlisho.online/download.php",
            "SITE_URL": "https://adlisho.online",
            "SUPPORT_URL": "https://adlisho.online/contact.html",
            "PRIVACY_URL": "https://adlisho.online/privacy.html",
            "TRACKING_URL": "https://adlisho.online/result.html",
            "DATABASE_PATH": "/opt/hamkare-bots/hamkare.sqlite3",
            "APK_UPLOAD_ENABLED": "true",
            "APK_DEPLOY_PATH": "/etc/host-config.apk",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(ValueError, "/var/www or /srv"):
                BOT.Config.from_env()


if __name__ == "__main__":
    unittest.main()
