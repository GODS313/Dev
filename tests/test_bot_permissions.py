import importlib.util
import io
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
        self.assertFalse(BOT.can_upload_apk("bale", "10001", self.admins, True))
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
                download_url="https://seskia.online/est/download",
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


class ValidationTests(unittest.TestCase):
    @staticmethod
    def config_for(directory, **overrides):
        values = dict(
            platform="telegram",
            token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
            log_chat_id="-1001234567890",
            admin_ids=frozenset({"10001"}),
            download_url="https://seskia.online/est/download",
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
            "DOWNLOAD_URL": "https://seskia.online/est/download",
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
