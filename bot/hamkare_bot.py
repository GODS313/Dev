#!/usr/bin/env python3
"""White-label Telegram/Bale recruitment bot for Hamkare."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path


PERSIAN_DIGITS = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"
)
ADMIN_ACTIONS = {
    "admin_panel",
    "admin_stats",
    "admin_upload",
    "admin_toggle_pause",
    "admin_current_app",
    "admin_rollback",
    "admin_rollback_confirm",
}
APK_MIME_TYPES = {
    "application/vnd.android.package-archive",
    "application/zip",
    "application/octet-stream",
}
REJECTED_SIGNER_CERT_DIGESTS = {
    # Public Android AOSP test key; it is not a private production identity.
    "a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc",
}


def normalize(value: object) -> str:
    return str(value or "").translate(PERSIAN_DIGITS).strip()


def valid_national_id(value: object) -> bool:
    code = normalize(value)
    if not re.fullmatch(r"\d{10}", code) or len(set(code)) == 1:
        return False
    total = sum(int(code[index]) * (10 - index) for index in range(9))
    remainder = total % 11
    check = remainder if remainder < 2 else 11 - remainder
    return int(code[-1]) == check


def normalize_iranian_mobile(value: object) -> str:
    phone = re.sub(r"[\s()-]+", "", normalize(value))
    if re.fullmatch(r"\+989\d{9}", phone):
        phone = "0" + phone[3:]
    elif re.fullmatch(r"00989\d{9}", phone):
        phone = "0" + phone[4:]
    return phone if re.fullmatch(r"09\d{9}", phone) else ""


def normalize_person_name(value: object, max_length: int) -> str:
    """Return a single-line human name or an empty string when it is unsafe."""
    name = re.sub(r" +", " ", normalize(value))
    if not 2 <= len(name) <= max_length:
        return ""
    allowed_punctuation = {"-", "'", "’", "\u200c"}
    for character in name:
        category = unicodedata.category(character)
        if character == " " or character in allowed_punctuation:
            continue
        if category.startswith(("L", "M")):
            continue
        return ""
    return name


def parse_admin_ids(value: str) -> frozenset[str]:
    values = {item.strip() for item in value.split(",") if item.strip()}
    if not values or any(not re.fullmatch(r"\d{3,20}", item) for item in values):
        raise ValueError("ADMIN_IDS must contain comma-separated numeric user IDs")
    return frozenset(values)


def valid_https_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and bool(parsed.netloc)
        and not parsed.username
        and not parsed.password
        and "\n" not in value
        and "\r" not in value
    )


def can_access_action(action: str, user_id: str, admin_ids: frozenset[str]) -> bool:
    return action not in ADMIN_ACTIONS or user_id in admin_ids


def can_upload_apk(
    platform: str, user_id: str, admin_ids: frozenset[str], enabled: bool
) -> bool:
    return platform in {"telegram", "bale"} and enabled and user_id in admin_ids


def verify_apk_archive(path: Path) -> tuple[int, str]:
    size = path.stat().st_size
    if size < 1024:
        raise ValueError("فایل APK بیش از حد کوچک است.")
    with path.open("rb") as handle:
        if handle.read(4) != b"PK\x03\x04":
            raise ValueError("ساختار فایل APK معتبر نیست.")
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if "AndroidManifest.xml" not in names or "classes.dex" not in names:
                raise ValueError("فایل انتخاب‌شده یک APK کامل نیست.")
            if archive.testzip() is not None:
                raise ValueError("فایل APK خراب است.")
    except zipfile.BadZipFile as error:
        raise ValueError("ساختار ZIP فایل APK معتبر نیست.") from error
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return size, digest.hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_apk_signature(path: Path) -> bool:
    verifier = shutil.which("apksigner")
    if verifier is None:
        raise ValueError("ابزار بررسی امضای APK نصب نیست.")
    result = subprocess.run(
        [verifier, "verify", "--verbose", "--print-certs", str(path)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
        check=False,
        text=True,
    )
    if result.returncode != 0:
        raise ValueError("امضای دیجیتال APK معتبر نیست.")
    signer_digests = {
        match.lower()
        for match in re.findall(
            r"certificate SHA-256 digest:\s*([0-9a-f]{64})",
            result.stdout,
            flags=re.IGNORECASE,
        )
    }
    if not signer_digests:
        raise ValueError("شناسه گواهی امضاکننده APK قابل تأیید نیست.")
    if signer_digests & REJECTED_SIGNER_CERT_DIGESTS:
        raise ValueError("APK با کلید عمومی تست امضا شده و قابل انتشار نیست.")
    return True


class SafeGitHubRedirectHandler(urllib.request.HTTPRedirectHandler):
    allowed_hosts = {
        "seskia.online",
        "github.com",
        "github-releases.githubusercontent.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    }

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in self.allowed_hosts
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise urllib.error.HTTPError(newurl, code, "unsafe redirect", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def public_apk_matches(url: str, expected_digest: str, max_bytes: int) -> bool:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("verify", expected_digest[:16]))
    verification_url = urllib.parse.urlunsplit(
        parsed._replace(query=urllib.parse.urlencode(query))
    )
    request = urllib.request.Request(
        verification_url,
        headers={
            "Accept": "application/vnd.android.package-archive,application/octet-stream",
            "Cache-Control": "no-cache",
            "User-Agent": "HamkareBot-PublicVerify/2.0",
        },
    )
    digest = hashlib.sha256()
    received = 0
    opener = urllib.request.build_opener(SafeGitHubRedirectHandler())
    with opener.open(request, timeout=180) as response:
        final_host = urllib.parse.urlsplit(response.geturl()).hostname
        if final_host not in SafeGitHubRedirectHandler.allowed_hosts:
            return False
        content_type = response.headers.get_content_type().lower()
        if content_type not in APK_MIME_TYPES:
            return False
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            received += len(chunk)
            if received > max_bytes:
                return False
            digest.update(chunk)
    return received > 0 and digest.hexdigest() == expected_digest


def release_source_url(source_url: str, digest: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("release digest must be lowercase SHA-256")
    parsed = urllib.parse.urlsplit(source_url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "seskia.online"
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path != "/download.php"
        or parsed.fragment
        or query != [("src", "github-release")]
    ):
        raise ValueError("APK_SOURCE_URL must be the approved Seskia release endpoint")
    query.append(("sha256", digest))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def dispatch_release_workflow(
    token: str,
    repository: str,
    workflow: str,
    source_url: str,
    digest: str,
) -> None:
    if repository != "GODS313/Dev" or workflow != "publish-hamkare-apk.yml":
        raise ValueError("GitHub release destination is not approved")
    payload = json.dumps(
        {
            "ref": "main",
            "inputs": {
                "source_url": release_source_url(source_url, digest),
                "sha256": digest,
            },
        }
    ).encode()
    endpoint = (
        "https://api.github.com/repos/GODS313/Dev/actions/workflows/"
        "publish-hamkare-apk.yml/dispatches"
    )
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "HamkareTelegramReleaseBridge/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 204:
            raise RuntimeError(f"GitHub workflow dispatch returned HTTP {response.status}")


def wait_for_public_apk(
    url: str,
    expected_digest: str,
    max_bytes: int,
    timeout_seconds: int,
) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            if public_apk_matches(url, expected_digest, max_bytes):
                return True
        except (OSError, TimeoutError, urllib.error.URLError, urllib.error.HTTPError):
            pass
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(5, remaining))


@dataclass(frozen=True)
class Config:
    platform: str
    token: str
    log_chat_id: str
    admin_ids: frozenset[str]
    download_url: str
    site_url: str
    support_url: str
    privacy_url: str
    tracking_url: str
    brand_name: str
    database_path: Path
    apk_upload_enabled: bool
    apk_deploy_path: Path | None
    max_apk_bytes: int
    apk_stage_dir: Path | None = None
    public_verify_enabled: bool = True
    github_dispatch_token: str = ""
    github_repository: str = ""
    github_workflow: str = ""
    apk_source_url: str = ""
    release_wait_seconds: int = 300

    @classmethod
    def from_env(cls) -> "Config":
        platform = os.environ.get("PLATFORM", "").strip().lower()
        if platform not in {"telegram", "bale"}:
            raise ValueError("PLATFORM must be telegram or bale")
        token = os.environ.get("BOT_TOKEN", "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_:-]{20,200}", token):
            raise ValueError("BOT_TOKEN format is invalid")
        urls = {
            key: os.environ.get(key, "").strip()
            for key in (
                "DOWNLOAD_URL",
                "SITE_URL",
                "SUPPORT_URL",
                "PRIVACY_URL",
                "TRACKING_URL",
            )
        }
        for key, value in urls.items():
            if not valid_https_url(value):
                raise ValueError(f"{key} must be a complete HTTPS URL")
        enabled = os.environ.get("APK_UPLOAD_ENABLED", "false").lower() == "true"
        raw_target = os.environ.get("APK_DEPLOY_PATH", "").strip()
        raw_target_path = Path(raw_target) if raw_target else None
        target = raw_target_path.resolve(strict=False) if raw_target_path else None
        stage_dir = None
        if enabled:
            if target is None or not target.is_absolute():
                raise ValueError("APK_DEPLOY_PATH must be an absolute path")
            if raw_target_path is not None and raw_target_path.is_symlink():
                raise ValueError("APK_DEPLOY_PATH must not be a symbolic link")
            if target.suffix.lower() != ".apk" or not any(
                target.is_relative_to(root) for root in (Path("/var/www"), Path("/srv"))
            ):
                raise ValueError("APK_DEPLOY_PATH must be an .apk file under /var/www or /srv")
            if not target.parent.is_dir():
                raise ValueError("APK_DEPLOY_PATH parent directory does not exist")
            raw_stage = os.environ.get("APK_STAGE_DIR", "").strip()
            raw_stage_path = Path(raw_stage) if raw_stage else None
            if raw_stage_path is not None and raw_stage_path.is_symlink():
                raise ValueError("APK_STAGE_DIR must not be a symbolic link")
            stage_dir = (
                raw_stage_path.resolve(strict=False)
                if raw_stage_path is not None
                else target.parent / ".hamkare-apk-staging"
            )
            if stage_dir.parent != target.parent or not stage_dir.name.startswith("."):
                raise ValueError("APK_STAGE_DIR must be a hidden directory beside the live APK")
        log_chat_id = os.environ.get("LOG_CHAT_ID", "").strip()
        if not re.fullmatch(r"-?\d{3,30}", log_chat_id):
            raise ValueError("LOG_CHAT_ID must be numeric")
        database_path = Path(
            os.environ.get("DATABASE_PATH", "/opt/hamkare-bots/hamkare.sqlite3")
        )
        if not database_path.is_absolute():
            raise ValueError("DATABASE_PATH must be an absolute path")
        max_apk_bytes = int(os.environ.get("MAX_APK_BYTES", str(20 * 1024 * 1024)))
        if not 1024 * 1024 <= max_apk_bytes <= 20 * 1024 * 1024:
            raise ValueError("MAX_APK_BYTES must be between 1 MB and Telegram's 20 MB download limit")
        public_verify_enabled = os.environ.get("PUBLIC_VERIFY_ENABLED", "true").lower() == "true"
        github_dispatch_token = os.environ.get("GITHUB_DISPATCH_TOKEN", "").strip()
        github_repository = os.environ.get("GITHUB_REPOSITORY", "").strip()
        github_workflow = os.environ.get("GITHUB_WORKFLOW", "").strip()
        apk_source_url = os.environ.get("APK_SOURCE_URL", "").strip()
        release_wait_seconds = int(os.environ.get("RELEASE_WAIT_SECONDS", "300"))
        if enabled:
            github_url = "https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk"
            local_url = "https://seskia.online/download.php?src=hamkare"
            if github_dispatch_token:
                if urls["DOWNLOAD_URL"] != github_url:
                    raise ValueError("DOWNLOAD_URL must be the canonical GitHub release")
                if not re.fullmatch(r"\S{40,255}", github_dispatch_token):
                    raise ValueError("GITHUB_DISPATCH_TOKEN format is invalid")
                if github_repository != "GODS313/Dev" or github_workflow != "publish-hamkare-apk.yml":
                    raise ValueError("GitHub release workflow configuration is invalid")
                release_source_url(apk_source_url, "0" * 64)
            elif platform != "bale" or urls["DOWNLOAD_URL"] != local_url:
                raise ValueError("local APK publication is allowed only for Bale on the canonical Seskia URL")
            if not public_verify_enabled:
                raise ValueError("PUBLIC_VERIFY_ENABLED must stay true for APK publication")
            if not 60 <= release_wait_seconds <= 600:
                raise ValueError("RELEASE_WAIT_SECONDS must be between 60 and 600")
        return cls(
            platform=platform,
            token=token,
            log_chat_id=log_chat_id,
            admin_ids=parse_admin_ids(os.environ.get("ADMIN_IDS", "")),
            download_url=urls["DOWNLOAD_URL"],
            site_url=urls["SITE_URL"],
            support_url=urls["SUPPORT_URL"],
            privacy_url=urls["PRIVACY_URL"],
            tracking_url=urls["TRACKING_URL"],
            brand_name=os.environ.get("BRAND_NAME", "همکاره").strip()[:50] or "همکاره",
            database_path=database_path,
            apk_upload_enabled=enabled,
            apk_deploy_path=target,
            max_apk_bytes=max_apk_bytes,
            apk_stage_dir=stage_dir,
            public_verify_enabled=public_verify_enabled,
            github_dispatch_token=github_dispatch_token,
            github_repository=github_repository,
            github_workflow=github_workflow,
            apk_source_url=apk_source_url,
            release_wait_seconds=release_wait_seconds,
        )


class Bot:
    def __init__(self, config: Config):
        self.config = config
        api_host = (
            "https://api.telegram.org/bot"
            if config.platform == "telegram"
            else "https://tapi.bale.ai/bot"
        )
        self.api_base = f"{api_host}{config.token}/"
        self.connection = sqlite3.connect(config.database_path, timeout=30)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=30000")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS sessions("
            "platform TEXT,user_id TEXT,state TEXT,first_name TEXT,last_name TEXT,nid TEXT,"
            "PRIMARY KEY(platform,user_id))"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS registrations("
            "id INTEGER PRIMARY KEY,platform TEXT,user_id TEXT,national_hash TEXT,"
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(platform,user_id),"
            "UNIQUE(platform,national_hash))"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS settings("
            "key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS admin_sessions("
            "platform TEXT,user_id TEXT,state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,"
            "PRIMARY KEY(platform,user_id))"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS audit_events("
            "id INTEGER PRIMARY KEY,platform TEXT,actor_id TEXT,action TEXT,detail TEXT,"
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        self.connection.commit()
        self.last_action: dict[str, float] = {}
        if config.apk_stage_dir is not None and config.apk_deploy_path is not None:
            config.apk_stage_dir.mkdir(mode=0o700, exist_ok=True)
            os.chmod(config.apk_stage_dir, 0o700)
            if config.apk_stage_dir.stat().st_dev != config.apk_deploy_path.parent.stat().st_dev:
                raise ValueError("APK staging and live path must be on the same filesystem")

    def api(self, method: str, payload: dict, attempts: int = 3) -> dict:
        data = json.dumps(payload, ensure_ascii=False).encode()
        request = urllib.request.Request(
            self.api_base + method,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "HamkareBot/2.0"},
        )
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(request, timeout=70) as response:
                    output = json.loads(response.read())
                if not output.get("ok"):
                    raise RuntimeError(output.get("description", "API error"))
                return output
            except urllib.error.HTTPError as error:
                retry_after = 0
                try:
                    body = json.loads(error.read())
                    retry_after = int(body.get("parameters", {}).get("retry_after", 0))
                except Exception:
                    pass
                if attempt + 1 == attempts or error.code < 500 and error.code != 429:
                    raise
                time.sleep(min(max(retry_after, 2**attempt), 30))
            except (urllib.error.URLError, TimeoutError):
                if attempt + 1 == attempts:
                    raise
                time.sleep(2**attempt)
        raise RuntimeError("unreachable")

    def send(self, chat_id: object, text: str, keyboard: list | None = None) -> dict:
        payload: dict = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if keyboard:
            payload["reply_markup"] = {"inline_keyboard": keyboard}
        return self.api("sendMessage", payload)

    def answer(self, callback_id: str, text: str = "") -> None:
        try:
            payload = {"callback_query_id": callback_id}
            if text:
                payload["text"] = text
            self.api("answerCallbackQuery", payload, attempts=1)
        except Exception:
            pass

    def audit(self, actor_id: str, action: str, detail: str = "") -> None:
        self.connection.execute(
            "INSERT INTO audit_events(platform,actor_id,action,detail) VALUES(?,?,?,?)",
            (self.config.platform, actor_id, action[:80], detail[:500]),
        )
        self.connection.commit()

    def is_admin(self, user_id: str) -> bool:
        return user_id in self.config.admin_ids

    def is_registered(self, user_id: str) -> bool:
        return (
            self.connection.execute(
                "SELECT 1 FROM registrations WHERE platform=? AND user_id=?",
                (self.config.platform, user_id),
            ).fetchone()
            is not None
        )

    def setting(self, key: str, default: str = "") -> str:
        row = self.connection.execute(
            "SELECT value FROM settings WHERE key=?", (key,)
        ).fetchone()
        return str(row[0]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.connection.execute(
            "INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
            (key, value),
        )
        self.connection.commit()

    def paused(self) -> bool:
        return self.setting("registrations_paused", "0") == "1"

    def user_menu(self, user_id: str) -> list:
        first_label = "📥 دریافت اپلیکیشن" if self.is_registered(user_id) else "📝 شروع ثبت‌نام"
        first_action = "download" if self.is_registered(user_id) else "register"
        rows = [
            [{"text": first_label, "callback_data": first_action}],
            [
                {"text": "🌐 وب‌سایت رسمی", "url": self.config.site_url},
                {"text": "🔎 پیگیری درخواست", "url": self.config.tracking_url},
            ],
            [
                {"text": "☎️ پشتیبانی", "url": self.config.support_url},
                {"text": "🔐 حریم خصوصی", "callback_data": "privacy"},
            ],
            [{"text": "ℹ️ راهنما", "callback_data": "help"}],
        ]
        if self.is_admin(user_id):
            rows.append([{"text": "⚙️ پنل مدیریت", "callback_data": "admin_panel"}])
        return rows

    def show_menu(self, chat_id: object, user_id: str) -> None:
        role = "مدیر" if self.is_admin(user_id) else "کاربر"
        self.send(
            chat_id,
            f"به «{self.config.brand_name}» خوش آمدید 👋\n"
            f"وضعیت ورود: {role}\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
            self.user_menu(user_id),
        )

    @staticmethod
    def flow_keyboard() -> list:
        return [[
            {"text": "❌ لغو", "callback_data": "cancel"},
            {"text": "🏠 منوی اصلی", "callback_data": "menu"},
        ]]

    def admin_menu(self) -> list:
        rows = [
            [
                {"text": "📊 آمار", "callback_data": "admin_stats"},
                {"text": "🔗 لینک فعلی", "callback_data": "admin_current_app"},
            ],
            [{"text": "⏸ توقف/ادامه ثبت‌نام", "callback_data": "admin_toggle_pause"}],
        ]
        if self.config.apk_upload_enabled:
            rows.append(
                [{"text": "🔄 تعویض فایل APK", "callback_data": "admin_upload"}]
            )
            rows.append(
                [{"text": "↩️ بازگردانی نسخه قبل", "callback_data": "admin_rollback"}]
            )
        rows.append([{"text": "🏠 منوی اصلی", "callback_data": "menu"}])
        return rows

    def session(self, user_id: str, state: str, first: str = "", last: str = "", nid: str = "") -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?,?)",
            (self.config.platform, user_id, state, first, last, nid),
        )
        self.connection.commit()

    def session_row(self, user_id: str) -> tuple | None:
        return self.connection.execute(
            "SELECT state,first_name,last_name,nid FROM sessions "
            "WHERE platform=? AND user_id=?",
            (self.config.platform, user_id),
        ).fetchone()

    def clear_sessions(self, user_id: str) -> None:
        self.connection.execute(
            "DELETE FROM sessions WHERE platform=? AND user_id=?",
            (self.config.platform, user_id),
        )
        self.connection.execute(
            "DELETE FROM admin_sessions WHERE platform=? AND user_id=?",
            (self.config.platform, user_id),
        )
        self.connection.commit()

    def begin_registration(self, chat_id: object, user_id: str) -> None:
        if self.is_registered(user_id):
            self.download(chat_id, user_id)
            return
        if self.paused() and not self.is_admin(user_id):
            self.send(chat_id, "ثبت‌نام موقتاً متوقف است. لطفاً کمی بعد دوباره تلاش کنید.", self.user_menu(user_id))
            return
        self.session(user_id, "first")
        self.send(chat_id, "لطفاً نام خود را وارد کنید:", self.flow_keyboard())

    def download(self, chat_id: object, user_id: str) -> None:
        if not self.is_registered(user_id) and not self.is_admin(user_id):
            self.send(
                chat_id,
                "برای دریافت اپلیکیشن ابتدا ثبت‌نام را تکمیل کنید.",
                [[{"text": "📝 شروع ثبت‌نام", "callback_data": "register"}], *self.flow_keyboard()],
            )
            return
        if self.config.platform == "bale":
            self.send(
                chat_id,
                "✅ دفترچه آماده دانلود است.",
                [[{"text": "📥 دانلود دفترچه", "url": self.config.download_url}]],
            )
        else:
            self.send(
                chat_id,
                "نسخه رسمی اپلیکیشن از دکمه زیر در دسترس است.",
                [[{"text": "📥 دانلود امن اپلیکیشن", "url": self.config.download_url}],
                 [{"text": "🏠 منوی اصلی", "callback_data": "menu"}]],
            )

    def complete_bale_registration(
        self, chat_id: object, user_id: str, actor: dict, first: str, last: str, phone: str
    ) -> None:
        digest = hashlib.sha256(phone.encode()).hexdigest()
        try:
            self.connection.execute(
                "INSERT INTO registrations(platform,user_id,national_hash) VALUES(?,?,?)",
                ("bale", user_id, digest),
            )
            self.connection.commit()
        except sqlite3.IntegrityError:
            self.clear_sessions(user_id)
            self.download(chat_id, user_id)
            return
        username = actor.get("username")
        username_text = "@" + username if username else "ندارد"
        log = (
            f"📌 ثبت جدید {self.config.brand_name}\nبستر: بله\n"
            f"نام: {first}\nنام خانوادگی: {last}\nشماره تلفن: {phone}\n"
            f"شناسه کاربر: {user_id}\nنام کاربری: {username_text}"
        )
        try:
            self.send(self.config.log_chat_id, log)
        except Exception:
            self.connection.execute(
                "DELETE FROM registrations WHERE platform=? AND user_id=?",
                ("bale", user_id),
            )
            self.connection.commit()
            self.send(chat_id, "ثبت انجام نشد؛ لطفاً دوباره تلاش کنید.", self.flow_keyboard())
            return
        self.clear_sessions(user_id)
        self.audit(user_id, "bale_registration_completed")
        self.send(
            chat_id,
            "✅ مشخصات شما ثبت شد.",
            [[{"text": "📥 دانلود دفترچه", "url": self.config.download_url}]],
        )

    def show_admin_panel(self, chat_id: object, user_id: str) -> None:
        if not self.is_admin(user_id):
            self.audit(user_id, "denied_admin_panel")
            self.send(chat_id, "این بخش فقط برای مدیر مجاز است.", self.user_menu(user_id))
            return
        self.connection.execute(
            "DELETE FROM admin_sessions WHERE platform=? AND user_id=?",
            (self.config.platform, user_id),
        )
        self.connection.commit()
        state = "متوقف" if self.paused() else "فعال"
        upload = "فعال" if can_upload_apk(
            self.config.platform, user_id, self.config.admin_ids, self.config.apk_upload_enabled
        ) else "غیرفعال"
        self.send(
            chat_id,
            f"پنل مدیریت {self.config.brand_name}\n\n"
            f"ثبت‌نام: {state}\nتعویض APK در این بات: {upload}",
            self.admin_menu(),
        )

    def show_stats(self, chat_id: object) -> None:
        total = self.connection.execute("SELECT COUNT(*) FROM registrations").fetchone()[0]
        platform_total = self.connection.execute(
            "SELECT COUNT(*) FROM registrations WHERE platform=?", (self.config.platform,)
        ).fetchone()[0]
        today = self.connection.execute(
            "SELECT COUNT(*) FROM registrations WHERE date(created_at)=date('now')"
        ).fetchone()[0]
        active = self.connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        self.send(
            chat_id,
            f"📊 آمار سامانه\n\nکل ثبت‌ها: {total}\n"
            f"ثبت در این بستر: {platform_total}\nامروز: {today}\nفرایندهای نیمه‌کاره: {active}",
            self.admin_menu(),
        )

    def set_admin_state(self, user_id: str, state: str) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO admin_sessions(platform,user_id,state,created_at) "
            "VALUES(?,?,?,CURRENT_TIMESTAMP)",
            (self.config.platform, user_id, state),
        )
        self.connection.commit()

    def admin_state(self, user_id: str) -> str:
        row = self.connection.execute(
            "SELECT state,created_at >= datetime('now','-10 minutes') FROM admin_sessions "
            "WHERE platform=? AND user_id=?",
            (self.config.platform, user_id),
        ).fetchone()
        if row and row[1]:
            return str(row[0])
        if row:
            self.connection.execute(
                "DELETE FROM admin_sessions WHERE platform=? AND user_id=?",
                (self.config.platform, user_id),
            )
            self.connection.commit()
        return ""

    def handle_callback(self, query: dict) -> None:
        callback_id = str(query.get("id", ""))
        user_id = str(query.get("from", {}).get("id", ""))
        message = query.get("message", {})
        chat_id = message.get("chat", {}).get("id")
        action = str(query.get("data", ""))
        if chat_id is None or not user_id:
            self.answer(callback_id)
            return
        if not can_access_action(action, user_id, self.config.admin_ids):
            self.answer(callback_id, "دسترسی مدیر لازم است")
            self.audit(user_id, "denied_admin_action", action)
            self.send(chat_id, "این گزینه فقط برای مدیر مجاز است.", self.user_menu(user_id))
            return
        self.answer(callback_id)
        if action == "menu":
            self.clear_sessions(user_id)
            self.show_menu(chat_id, user_id)
        elif action == "register":
            self.begin_registration(chat_id, user_id)
        elif action == "download":
            self.download(chat_id, user_id)
        elif action == "privacy":
            self.send(
                chat_id,
                "اطلاعات فقط برای بررسی درخواست ثبت می‌شود. کد ملی پس از ثبت به‌صورت هش نگهداری می‌شود و متن آن در پایگاه داده باقی نمی‌ماند.",
                [[{"text": "متن کامل حریم خصوصی", "url": self.config.privacy_url}],
                 [{"text": "🏠 منوی اصلی", "callback_data": "menu"}]],
            )
        elif action == "help":
            self.send(
                chat_id,
                "از «شروع ثبت‌نام» وارد فرایند سه‌مرحله‌ای شوید. هر زمان خواستید می‌توانید لغو کنید یا به منوی اصلی برگردید.",
                self.user_menu(user_id),
            )
        elif action == "cancel":
            self.clear_sessions(user_id)
            self.send(chat_id, "فرایند لغو شد.", self.user_menu(user_id))
        elif action == "consent":
            self.complete_registration(chat_id, user_id, query.get("from", {}))
        elif action == "admin_panel":
            self.show_admin_panel(chat_id, user_id)
        elif action == "admin_stats":
            self.show_stats(chat_id)
        elif action == "admin_current_app":
            self.send(
                chat_id,
                f"لینک عمومی فعلی:\n{self.config.download_url}\n\n"
                "این لینک ثابت است؛ تعویض فایل APK نباید لینک عمومی را تغییر دهد.",
                self.admin_menu(),
            )
        elif action == "admin_toggle_pause":
            new_value = "0" if self.paused() else "1"
            self.set_setting("registrations_paused", new_value)
            self.audit(user_id, "toggle_registration_pause", new_value)
            self.show_admin_panel(chat_id, user_id)
        elif action == "admin_upload":
            if not can_upload_apk(
                self.config.platform, user_id, self.config.admin_ids, self.config.apk_upload_enabled
            ):
                self.send(chat_id, "تعویض فایل APK در این بات فعال نیست.", self.admin_menu())
                return
            self.set_admin_state(user_id, "awaiting_apk")
            self.send(
                chat_id,
                "فایل جدید را به‌صورت Document و با پسوند .apk ارسال کنید.\n"
                "فایل قبل از جایگزینی از نظر ساختار، اندازه، SHA-256 و امضای release بررسی و از نسخه قبلی بکاپ گرفته می‌شود. APK دارای کلید تست رد می‌شود.",
                [[{"text": "❌ لغو", "callback_data": "admin_panel"}]],
            )
        elif action == "admin_rollback":
            self.prepare_apk_rollback(chat_id, user_id)
        elif action == "admin_rollback_confirm":
            self.rollback_apk(chat_id, user_id)

    def complete_registration(self, chat_id: object, user_id: str, actor: dict) -> None:
        row = self.session_row(user_id)
        if not row or row[0] != "consent":
            self.send(chat_id, "نشست ثبت‌نام معتبر نیست؛ دوباره شروع کنید.", self.user_menu(user_id))
            return
        first, last, national_id = row[1], row[2], row[3]
        digest = hashlib.sha256(national_id.encode()).hexdigest()
        try:
            self.connection.execute(
                "INSERT INTO registrations(platform,user_id,national_hash) VALUES(?,?,?)",
                (self.config.platform, user_id, digest),
            )
            self.connection.commit()
        except sqlite3.IntegrityError:
            self.clear_sessions(user_id)
            self.download(chat_id, user_id)
            return
        masked = national_id[:3] + "****" + national_id[-3:]
        username = actor.get("username")
        username_text = "@" + username if username else "ندارد"
        platform_name = "تلگرام" if self.config.platform == "telegram" else "بله"
        log = (
            f"📌 ثبت جدید {self.config.brand_name}\nبستر: {platform_name}\n"
            f"نام: {first}\nنام خانوادگی: {last}\nکد ملی: {masked}\n"
            f"شناسه کاربر: {user_id}\nنام کاربری: {username_text}\nرضایت: تأیید شد"
        )
        try:
            self.send(self.config.log_chat_id, log)
        except Exception:
            self.connection.execute(
                "DELETE FROM registrations WHERE platform=? AND user_id=?",
                (self.config.platform, user_id),
            )
            self.connection.commit()
            self.send(chat_id, "ارسال ثبت به گروه مسئول انجام نشد؛ کمی بعد دوباره تأیید کنید.", self.flow_keyboard())
            return
        self.clear_sessions(user_id)
        self.audit(user_id, "registration_completed")
        self.send(
            chat_id,
            "✅ مشخصات شما ثبت شد. اکنون می‌توانید اپلیکیشن را دریافت کنید.",
            [[{"text": "📥 دریافت اپلیکیشن", "url": self.config.download_url}],
             [{"text": "🏠 منوی اصلی", "callback_data": "menu"}]],
        )

    def publish_public_apk(self, user_id: str, digest: str) -> bool | None:
        if self.config.github_dispatch_token:
            dispatch_release_workflow(
                self.config.github_dispatch_token,
                self.config.github_repository,
                self.config.github_workflow,
                self.config.apk_source_url,
                digest,
            )
            self.audit(user_id, "apk_github_release_dispatched", digest)
            verified = wait_for_public_apk(
                self.config.download_url,
                digest,
                self.config.max_apk_bytes,
                self.config.release_wait_seconds,
            )
            self.audit(
                user_id,
                "apk_github_release_verified" if verified else "apk_github_release_failed",
                digest,
            )
            return verified
        if not self.config.public_verify_enabled:
            return None
        return public_apk_matches(
            self.config.download_url, digest, self.config.max_apk_bytes
        )

    def handle_apk_upload(self, message: dict, user_id: str, chat_id: object) -> bool:
        document = message.get("document") or {}
        file_name = str(document.get("file_name", ""))
        direct_bale_upload = (
            self.config.platform == "bale"
            and self.is_admin(user_id)
            and file_name.lower().endswith(".apk")
        )
        if self.admin_state(user_id) != "awaiting_apk" and not direct_bale_upload:
            return False
        if not can_upload_apk(
            self.config.platform, user_id, self.config.admin_ids, self.config.apk_upload_enabled
        ):
            self.clear_sessions(user_id)
            self.audit(user_id, "denied_apk_upload")
            return True
        file_id = str(document.get("file_id", ""))
        mime_type = str(document.get("mime_type", "")).lower()
        try:
            declared_size = int(document.get("file_size", 0) or 0)
        except (TypeError, ValueError):
            declared_size = 0
        if not file_name.lower().endswith(".apk") or not file_id:
            self.send(chat_id, "فقط فایل Document با پسوند .apk پذیرفته می‌شود.", self.admin_menu())
            return True
        if mime_type not in APK_MIME_TYPES:
            self.send(chat_id, "نوع MIME فایل با APK سازگار نیست.", self.admin_menu())
            return True
        if declared_size <= 0 or declared_size > self.config.max_apk_bytes:
            self.send(chat_id, "اندازه فایل APK خارج از محدوده مجاز است.", self.admin_menu())
            return True
        target = self.config.apk_deploy_path
        stage_dir = self.config.apk_stage_dir
        if target is None or stage_dir is None:
            self.send(chat_id, "مسیر استقرار APK تنظیم نشده است.", self.admin_menu())
            return True
        temporary_name = ""
        published = False
        previous_backup = None
        try:
            file_info = self.api("getFile", {"file_id": file_id})["result"]
            file_path = str(file_info.get("file_path", ""))
            if not file_path or ".." in file_path:
                raise ValueError("مسیر فایل دریافتی نامعتبر است.")
            file_host = (
                "https://api.telegram.org/file/bot"
                if self.config.platform == "telegram"
                else "https://tapi.bale.ai/file/bot"
            )
            file_url = (
                f"{file_host}{self.config.token}/"
                + urllib.parse.quote(file_path, safe="/")
            )
            with tempfile.NamedTemporaryFile(
                prefix="apk-upload-", suffix=".tmp", dir=stage_dir, delete=False
            ) as temporary:
                temporary_name = temporary.name
                received = 0
                with urllib.request.urlopen(file_url, timeout=180) as response:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > self.config.max_apk_bytes:
                            raise ValueError("فایل از سقف مجاز بزرگ‌تر است.")
                        temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            if received != declared_size:
                raise ValueError("اندازه واقعی فایل با اطلاعات تلگرام یکسان نیست.")
            temporary_path = Path(temporary_name)
            size, digest = verify_apk_archive(temporary_path)
            verify_apk_signature(temporary_path)
            backup_dir = self.config.database_path.parent / "apk-backups"
            backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            lock_path = target.parent / ".hamkare-apk.lock"
            with lock_path.open("a+b") as lock_handle:
                os.chmod(lock_path, 0o600)
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                if sha256_file(temporary_path) != digest:
                    raise ValueError("فایل staging پس از اعتبارسنجی تغییر کرده است.")
                if target.exists() and sha256_file(target) == digest:
                    temporary_path.unlink(missing_ok=True)
                    temporary_name = ""
                    self.connection.execute(
                        "DELETE FROM admin_sessions WHERE platform=? AND user_id=?",
                        (self.config.platform, user_id),
                    )
                    self.connection.commit()
                    self.audit(user_id, "apk_duplicate", f"sha256={digest}")
                    if self.config.github_dispatch_token:
                        public_verified = self.publish_public_apk(user_id, digest)
                        if not public_verified:
                            raise ValueError("انتشار GitHub تکمیل نشد؛ نسخه فعلی سرور حفظ شد.")
                        self.send(
                            chat_id,
                            "✅ همین APK دوباره بررسی و انتشار GitHub آن تأیید شد.",
                            self.admin_menu(),
                        )
                        return True
                    self.send(
                        chat_id,
                        "این فایل همین حالا نسخه فعال است و دوباره منتشر نشد.",
                        self.admin_menu(),
                    )
                    return True
                if target.exists():
                    old_digest = sha256_file(target)
                    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
                    previous_backup = backup_dir / f"app-{stamp}-{old_digest[:12]}.apk"
                    shutil.copy2(target, previous_backup)
                self.prune_backups()
                os.chmod(temporary_path, 0o644)
                os.replace(temporary_path, target)
                temporary_name = ""
                published = True
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            self.connection.execute(
                "DELETE FROM admin_sessions WHERE platform=? AND user_id=?",
                (self.config.platform, user_id),
            )
            self.connection.commit()
            self.audit(user_id, "apk_replaced", f"size={size};sha256={digest}")
            try:
                public_verified = self.publish_public_apk(user_id, digest)
            except Exception:
                public_verified = False
            if public_verified is not None:
                self.audit(user_id, "apk_public_verified" if public_verified else "apk_public_verify_failed", digest)
                if not public_verified:
                    restored = self.restore_after_failed_publication(
                        target, stage_dir, digest, previous_backup
                    )
                    if restored:
                        published = False
                        self.audit(user_id, "apk_publication_reverted", digest)
                        raise ValueError(
                            "فایل لینک عمومی با APK جدید یکسان نبود؛ نسخه قبلی خودکار بازگردانده شد."
                        )
                    raise RuntimeError(
                        "public APK verification failed and safe restore was not possible"
                    )
            public_text = (
                "تأیید شد" if public_verified else "نیاز به بررسی دستی"
            ) if self.config.public_verify_enabled else "غیرفعال"
            self.send(
                chat_id,
                f"✅ فایل APK با موفقیت جایگزین شد.\n"
                f"اندازه: {size / 1024 / 1024:.2f} MB\nSHA-256: {digest[:16]}…\n"
                f"امضای release APK: تأیید شد\nانتشار GitHub و تطبیق لینک عمومی: {public_text}\n\n"
                f"لینک عمومی بدون تغییر باقی ماند:\n{self.config.download_url}",
                self.admin_menu(),
            )
        except Exception as error:
            action = "apk_post_publish_failed" if published else "apk_replace_failed"
            self.audit(user_id, action, type(error).__name__)
            if published:
                try:
                    self.send(chat_id, "فایل منتشر شد، اما تأیید نهایی/اعلان کامل نشد؛ لینک عمومی را بررسی کنید.", self.admin_menu())
                except Exception:
                    pass
            else:
                detail = str(error) if isinstance(error, ValueError) else "خطای داخلی؛ گزارش سرویس را بررسی کنید."
                self.send(chat_id, f"جایگزینی APK انجام نشد: {detail}", self.admin_menu())
        finally:
            if temporary_name:
                Path(temporary_name).unlink(missing_ok=True)
        return True

    def backup_dir(self) -> Path:
        return self.config.database_path.parent / "apk-backups"

    def prune_backups(self) -> None:
        backups = sorted(
            self.backup_dir().glob("app-*.apk"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        for old_backup in backups[10:]:
            old_backup.unlink(missing_ok=True)

    def restore_after_failed_publication(
        self,
        target: Path,
        stage_dir: Path,
        rejected_digest: str,
        previous_backup: Path | None,
    ) -> bool:
        """Restore the prior target only when the rejected build is still live."""
        lock_path = target.parent / ".hamkare-apk.lock"
        temporary_name = ""
        try:
            with lock_path.open("a+b") as lock_handle:
                os.chmod(lock_path, 0o600)
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                if not target.is_file() or sha256_file(target) != rejected_digest:
                    return False
                if previous_backup is None:
                    target.unlink()
                else:
                    with tempfile.NamedTemporaryFile(
                        prefix="apk-restore-",
                        suffix=".tmp",
                        dir=stage_dir,
                        delete=False,
                    ) as temporary:
                        temporary_name = temporary.name
                    temporary_path = Path(temporary_name)
                    shutil.copy2(previous_backup, temporary_path)
                    os.chmod(temporary_path, 0o644)
                    os.replace(temporary_path, target)
                    temporary_name = ""
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            return True
        finally:
            if temporary_name:
                Path(temporary_name).unlink(missing_ok=True)

    def prepare_apk_rollback(self, chat_id: object, user_id: str) -> None:
        if not can_upload_apk(
            self.config.platform, user_id, self.config.admin_ids, self.config.apk_upload_enabled
        ):
            self.send(chat_id, "بازگردانی APK در این بات فعال نیست.", self.admin_menu())
            return
        backups = sorted(
            self.backup_dir().glob("app-*.apk"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        if not backups:
            self.send(chat_id, "نسخه پشتیبان معتبری برای بازگردانی وجود ندارد.", self.admin_menu())
            return
        selected = backups[0]
        self.set_admin_state(user_id, f"confirm_rollback:{selected.name}")
        self.send(
            chat_id,
            f"نسخه پشتیبان انتخاب‌شده:\n{selected.name}\n\nبازگردانی را تأیید می‌کنید؟",
            [[{"text": "✅ تأیید بازگردانی", "callback_data": "admin_rollback_confirm"}],
             [{"text": "❌ لغو", "callback_data": "admin_panel"}]],
        )

    def rollback_apk(self, chat_id: object, user_id: str) -> None:
        if not can_upload_apk(
            self.config.platform, user_id, self.config.admin_ids, self.config.apk_upload_enabled
        ):
            self.send(chat_id, "بازگردانی APK در این بات فعال نیست.", self.admin_menu())
            return
        state = self.admin_state(user_id)
        if not state.startswith("confirm_rollback:"):
            self.send(chat_id, "درخواست بازگردانی منقضی یا نامعتبر است.", self.admin_menu())
            return
        backup_name = state.split(":", 1)[1]
        if not re.fullmatch(r"app-[A-Za-z0-9-]+\.apk", backup_name):
            self.clear_sessions(user_id)
            self.send(chat_id, "نام نسخه پشتیبان معتبر نیست.", self.admin_menu())
            return
        source = self.backup_dir() / backup_name
        target = self.config.apk_deploy_path
        stage_dir = self.config.apk_stage_dir
        if target is None or stage_dir is None or not source.is_file():
            self.clear_sessions(user_id)
            self.send(chat_id, "نسخه پشتیبان دیگر در دسترس نیست.", self.admin_menu())
            return
        temporary_name = ""
        current_backup = None
        published_digest = ""
        try:
            with tempfile.NamedTemporaryFile(
                prefix="apk-rollback-", suffix=".tmp", dir=stage_dir, delete=False
            ) as temporary:
                temporary_name = temporary.name
            temporary_path = Path(temporary_name)
            shutil.copy2(source, temporary_path)
            size, digest = verify_apk_archive(temporary_path)
            published_digest = digest
            verify_apk_signature(temporary_path)
            lock_path = target.parent / ".hamkare-apk.lock"
            with lock_path.open("a+b") as lock_handle:
                os.chmod(lock_path, 0o600)
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                if target.exists():
                    current_digest = sha256_file(target)
                    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
                    current_backup = self.backup_dir() / f"app-{stamp}-{current_digest[:12]}.apk"
                    shutil.copy2(target, current_backup)
                self.prune_backups()
                os.chmod(temporary_path, 0o644)
                os.replace(temporary_path, target)
                temporary_name = ""
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            self.clear_sessions(user_id)
            self.audit(user_id, "apk_rolled_back", f"size={size};sha256={digest}")
            try:
                public_verified = self.publish_public_apk(user_id, digest)
            except Exception:
                public_verified = False
            if public_verified is not None:
                if not public_verified:
                    restored = self.restore_after_failed_publication(
                        target, stage_dir, digest, current_backup
                    )
                    if restored:
                        self.audit(user_id, "apk_rollback_reverted", digest)
                        raise ValueError(
                            "لینک عمومی نسخه انتخاب‌شده را نشان نداد؛ نسخه جاری حفظ شد."
                        )
                    raise RuntimeError(
                        "rollback verification failed and safe restore was not possible"
                    )
            verify_text = "تأیید شد" if public_verified else "نیاز به بررسی دستی"
            self.send(
                chat_id,
                f"✅ نسخه قبلی بازگردانی شد.\nSHA-256: {digest[:16]}…\n"
                f"تطبیق لینک عمومی: {verify_text}",
                self.admin_menu(),
            )
        except Exception as error:
            self.audit(
                user_id,
                "apk_rollback_failed",
                f"{type(error).__name__};sha256={published_digest}",
            )
            detail = str(error) if isinstance(error, ValueError) else "خطای داخلی؛ گزارش سرویس را بررسی کنید."
            self.send(chat_id, f"بازگردانی انجام نشد: {detail}", self.admin_menu())
        finally:
            if temporary_name:
                Path(temporary_name).unlink(missing_ok=True)

    def handle_message(self, message: dict) -> None:
        if message.get("chat", {}).get("type") != "private":
            return
        chat_id = message["chat"]["id"]
        user_id = str(message.get("from", {}).get("id", chat_id))
        if self.handle_apk_upload(message, user_id, chat_id):
            return
        text = normalize(message.get("text", ""))
        command = text.split(maxsplit=1)[0].split("@", 1)[0].lower() if text else ""
        if command in {"/start", "/menu"}:
            self.clear_sessions(user_id)
            if self.config.platform == "bale":
                self.begin_registration(chat_id, user_id)
            else:
                self.show_menu(chat_id, user_id)
            return
        if command == "/admin" and self.is_admin(user_id):
            self.clear_sessions(user_id)
            self.show_admin_panel(chat_id, user_id)
            return
        if command in {"/stop", "/cancel"}:
            self.clear_sessions(user_id)
            self.send(chat_id, "فرایند جاری متوقف شد.", self.user_menu(user_id))
            return
        if command == "/privacy":
            self.send(chat_id, "متن کامل حریم خصوصی:", [[{"text": "مشاهده", "url": self.config.privacy_url}]])
            return
        row = self.session_row(user_id)
        if row is None:
            if self.config.platform == "bale":
                self.begin_registration(chat_id, user_id)
            else:
                self.show_menu(chat_id, user_id)
            return
        state, first, last, _national_id = row
        if state == "first":
            name = normalize_person_name(text, 50)
            if not name:
                self.send(chat_id, "نام معتبر وارد کنید.", self.flow_keyboard())
                return
            self.session(user_id, "last", name)
            self.send(chat_id, "نام خانوادگی خود را وارد کنید:", self.flow_keyboard())
        elif state == "last":
            family_name = normalize_person_name(text, 70)
            if not family_name:
                self.send(chat_id, "نام خانوادگی معتبر وارد کنید.", self.flow_keyboard())
                return
            if self.config.platform == "bale":
                self.session(user_id, "phone", first, family_name)
                self.send(chat_id, "شماره تلفن همراه خود را وارد کنید:", self.flow_keyboard())
            else:
                self.session(user_id, "nid", first, family_name)
                self.send(chat_id, "مرحله ۳ از ۳\nکد ملی ۱۰ رقمی خود را وارد کنید:", self.flow_keyboard())
        elif state == "phone" and self.config.platform == "bale":
            phone = normalize_iranian_mobile(text)
            if not phone:
                self.send(chat_id, "شماره تلفن معتبر وارد کنید؛ مثال: 09123456789", self.flow_keyboard())
                return
            self.complete_bale_registration(
                chat_id, user_id, message.get("from", {}), first, last, phone
            )
        elif state == "nid":
            if not valid_national_id(text):
                self.send(chat_id, "کد ملی معتبر نیست؛ دوباره وارد کنید.", self.flow_keyboard())
                return
            self.session(user_id, "consent", first, last, text)
            self.send(
                chat_id,
                f"اطلاعات شما:\nنام: {first}\nنام خانوادگی: {last}\n"
                f"کد ملی: {text[:3]}****{text[-3:]}\n\n"
                "با تأیید، مشخصات برای بررسی به گروه مسئول ارسال می‌شود.",
                [[{"text": "✅ تأیید و ثبت", "callback_data": "consent"}],
                 [{"text": "❌ لغو", "callback_data": "cancel"}]],
            )
        else:
            self.show_menu(chat_id, user_id)

    def process(self, update: dict) -> None:
        query = update.get("callback_query")
        if query:
            user_id = str(query.get("from", {}).get("id", ""))
            now = time.monotonic()
            if user_id and now - self.last_action.get(user_id, 0.0) < 0.4:
                self.answer(str(query.get("id", "")), "کمی آهسته‌تر")
                return
            if user_id:
                self.last_action[user_id] = now
            self.handle_callback(query)
            return
        message = update.get("message")
        if message:
            self.handle_message(message)

    def run(self) -> None:
        try:
            self.api("deleteWebhook", {"drop_pending_updates": False})
        except Exception:
            pass
        update_key = f"last_update_id:{self.config.platform}"
        offset = int(self.setting(update_key, "-1")) + 1
        while True:
            try:
                output = self.api(
                    "getUpdates",
                    {
                        "offset": offset,
                        "timeout": 50,
                        "allowed_updates": ["message", "callback_query"],
                    },
                )
                for update in output.get("result", []):
                    update_id = int(update["update_id"])
                    if update_id < offset:
                        continue
                    self.process(update)
                    self.set_setting(update_key, str(update_id))
                    offset = update_id + 1
            except KeyboardInterrupt:
                return
            except Exception as error:
                print(f"polling error: {type(error).__name__}", file=sys.stderr, flush=True)
                time.sleep(3)


def main() -> int:
    try:
        config = Config.from_env()
        config.database_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        Bot(config).run()
    except Exception as error:
        print(f"startup error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
