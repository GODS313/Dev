import importlib.util
import hashlib
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

    def test_apk_hash_treats_file_as_opaque_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opaque.apk"
            path.write_bytes(b"opaque-file-without-content-inspection" * 100)
            self.assertEqual(BOT.sha256_file(path), hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertTrue(hasattr(BOT, "validate_apk_file"))

    def test_admin_actions_are_denied_to_regular_users(self):
        for action in BOT.ADMIN_ACTIONS:
            self.assertFalse(BOT.can_access_action(action, "20002", self.admins))
            self.assertTrue(BOT.can_access_action(action, "10001", self.admins))

    def test_non_admin_actions_remain_available(self):
        for action in ("menu", "register", "download", "privacy", "help", "cancel"):
            self.assertTrue(BOT.can_access_action(action, "20002", self.admins))

    def test_apk_upload_is_telegram_admin_or_exact_allowed_group(self):
        allowed = frozenset({"-1004315509328"})
        self.assertTrue(BOT.can_upload_apk("telegram", "10001", self.admins, True))
        self.assertFalse(BOT.can_upload_apk("telegram", "20002", self.admins, True))
        self.assertTrue(BOT.can_upload_apk(
            "telegram", "20002", self.admins, True, "-1004315509328", allowed
        ))
        self.assertFalse(BOT.can_upload_apk(
            "telegram", "20002", self.admins, True, "-1009999999999", allowed
        ))
        self.assertFalse(BOT.can_upload_apk(
            "bale", "10001", self.admins, True, "-1004315509328", allowed
        ))
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
                download_url="https://adlisho.online/download",
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
            self.assertIn("admin_positions", panel_callbacks)
            self.assertIn("positions", user_callbacks)
            self.assertNotIn("https://adlisho.online", {
                button.get("url") for row in bot.user_menu("20002") for button in row
            })

            custom_positions = [
                {"title": f"سمت {index}", "description": f"توضیح سمت شماره {index}"}
                for index in range(1, 5)
            ]
            bot.set_setting("job_positions", json.dumps(custom_positions, ensure_ascii=False))
            self.assertEqual(bot.positions()[0], ("سمت 1", "توضیح سمت شماره 1"))
            sent = []
            bot.send = lambda chat_id, text, keyboard=None: sent.append((text, keyboard))
            bot.show_positions("20002")
            callbacks = [button["callback_data"] for row in sent[-1][1][:-1] for button in row]
            self.assertEqual(callbacks, ["position_0", "position_1", "position_2", "position_3"])

    def test_bale_download_button_uses_the_canonical_adlisho_endpoint(self):
        expected = "https://adlisho.online/download"
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


    def test_allowed_group_members_receive_admin_panel(self):
        with tempfile.TemporaryDirectory() as directory:
            config = BOT.Config(
                platform="telegram",
                token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
                log_chat_id="-1004315509328",
                admin_ids=self.admins,
                download_url="https://adlisho.online/download",
                site_url="https://adlisho.online",
                support_url="https://adlisho.online/contact.html",
                privacy_url="https://adlisho.online/privacy.html",
                tracking_url="https://adlisho.online/result.html",
                brand_name="همکاره",
                database_path=Path(directory) / "group.sqlite3",
                apk_upload_enabled=True,
                apk_deploy_path=Path(directory) / "app.apk",
                max_apk_bytes=20 * 1024 * 1024,
                apk_allowed_chat_ids=frozenset({"-1004315509328"}),
            )
            bot = BOT.Bot(config)
            sent = []
            bot.send = lambda chat_id, text, keyboard=None: sent.append((chat_id, text, keyboard))
            bot.handle_message({
                "chat": {"id": -1004315509328, "type": "supergroup"},
                "from": {"id": 20002},
                "text": "/admin",
            })
            self.assertIn("پنل مدیریت", sent[-1][1])
            callbacks = {
                button.get("callback_data")
                for row in sent[-1][2]
                for button in row
            }
            self.assertIn("admin_stats", callbacks)
            self.assertIn("admin_upload", callbacks)
            self.assertTrue(bot.is_operator("20002", -1004315509328))
            self.assertFalse(bot.is_operator("20002", -1009999999999))


class ValidationTests(unittest.TestCase):
    @staticmethod
    def config_for(directory, **overrides):
        values = dict(
            platform="telegram",
            token="1234567890:abcdefghijklmnopqrstuvwxyzABCDE",
            log_chat_id="-1001234567890",
            admin_ids=frozenset({"10001"}),
            download_url="https://adlisho.online/download",
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
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("AndroidManifest.xml", b"manifest-" + marker)
            archive.writestr("classes.dex", marker * 2048)
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
            with mock.patch.object(
                BOT.urllib.request,
                "urlopen",
                side_effect=lambda *args, **kwargs: io.BytesIO(updated),
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
            "DOWNLOAD_URL": "https://adlisho.online/download",
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
