#!/usr/bin/env python3
"""Telegram-only master control bot for Hamkare.

Purpose: a second, independent path to manage the /dl download page's
content, colors and images when https://adlisho.online/admin cannot be
reached (filtering, an outage, a DNS problem inside Iran, ...).

It never talks to adlisho.online at all. Instead it calls Cloudflare's own
APIs directly:
  - D1 HTTP API (api.cloudflare.com) to read/write the same `site_content`
    table the admin panel's /api/admin/download-page endpoint uses.
  - R2's S3-compatible API (<account>.r2.cloudflarestorage.com) to upload
    logo/icon/screenshot images, signed with AWS SigV4 by hand (stdlib only,
    same house rule as bot/hamkare_bot.py -- no third-party dependencies).

Scope is deliberately narrower than the admin panel: flat text fields,
four curated color presets, and image uploads. The feature-card list stays
admin-panel-only since editing an array of structured rows over chat is
poor UX. Everything this bot writes is read by the exact same /dl renderer,
so a change here shows up on the public page immediately either way.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path

USER_AGENT = "HamkareMasterBot/1.0"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SLOTS = {"logo", "icon"}

FIELDS: dict[str, tuple[str, int, bool]] = {
    "app_name": ("نام اپلیکیشن", 60, False),
    "tagline": ("عنوان کوتاه", 120, False),
    "description": ("توضیح کامل", 600, False),
    "cta_label": ("متن دکمهٔ دانلود", 40, False),
    "version_label": ("برچسب نسخه", 60, False),
    "footer_note": ("یادداشت پایین صفحه", 160, False),
    "telegram_url": ("لینک ربات دانلود تلگرام", 300, True),
    "bale_url": ("لینک ربات دانلود بله", 300, True),
}

THEME_PRESETS: dict[str, dict[str, str]] = {
    "navy_gold": {"label": "سرمه‌ای و طلایی (پیش‌فرض)", "bg_from": "#071d36", "bg_to": "#0b3866", "accent": "#ffc957", "accent_2": "#6ce0bd"},
    "blue_mint": {"label": "آبی و فیروزه‌ای", "bg_from": "#04263f", "bg_to": "#0b4a72", "accent": "#37c2ff", "accent_2": "#6ce0bd"},
    "violet": {"label": "بنفش مدرن", "bg_from": "#1b1533", "bg_to": "#2c2350", "accent": "#a78bfa", "accent_2": "#f472b6"},
    "charcoal_neon": {"label": "زغالی و نئون", "bg_from": "#0b0d10", "bg_to": "#171b21", "accent": "#39ff88", "accent_2": "#39d4ff"},
}

DEFAULT_CONTENT: dict = {
    "app_name": "همکاره",
    "tagline": "دستیار استخدام و همکاری شما",
    "description": "",
    "cta_label": "دانلود مستقیم اپلیکیشن",
    "version_label": "",
    "footer_note": "",
    "telegram_url": "",
    "bale_url": "",
    "features": [],
    "theme": THEME_PRESETS["navy_gold"],
    "logo_media_id": "",
    "icon_media_id": "",
    "screenshot_media_ids": [],
}

URL_RE = re.compile(r"^https://[^\s<>\"']{3,300}$")


def parse_admin_ids(value: str) -> frozenset[str]:
    values = {item.strip() for item in value.split(",") if item.strip()}
    if not values or any(not re.fullmatch(r"\d{3,20}", item) for item in values):
        raise ValueError("MASTER_ADMIN_IDS must contain comma-separated numeric user IDs")
    return frozenset(values)


@dataclass(frozen=True)
class Config:
    token: str
    admin_ids: frozenset[str]
    cf_account_id: str
    cf_database_id: str
    cf_api_token: str
    r2_bucket: str
    r2_access_key_id: str
    r2_secret_access_key: str
    site_url: str
    database_path: Path

    @classmethod
    def from_env(cls) -> "Config":
        token = os.environ.get("MASTER_BOT_TOKEN", "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_:-]{20,200}", token):
            raise ValueError("MASTER_BOT_TOKEN format is invalid")
        required = {
            "CF_ACCOUNT_ID": os.environ.get("CF_ACCOUNT_ID", "").strip(),
            "CF_D1_DATABASE_ID": os.environ.get("CF_D1_DATABASE_ID", "").strip(),
            "CF_API_TOKEN": os.environ.get("CF_API_TOKEN", "").strip(),
            "R2_BUCKET": os.environ.get("R2_BUCKET", "").strip(),
            "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID", "").strip(),
            "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY", "").strip(),
        }
        for key, value in required.items():
            if not value:
                raise ValueError(f"{key} is required")
        site_url = os.environ.get("SITE_URL", "https://adlisho.online").strip()
        database_path = Path(
            os.environ.get("DATABASE_PATH", "/opt/hamkare-master-bot/state.sqlite3")
        )
        if not database_path.is_absolute():
            raise ValueError("DATABASE_PATH must be an absolute path")
        return cls(
            token=token,
            admin_ids=parse_admin_ids(os.environ.get("MASTER_ADMIN_IDS", "")),
            cf_account_id=required["CF_ACCOUNT_ID"],
            cf_database_id=required["CF_D1_DATABASE_ID"],
            cf_api_token=required["CF_API_TOKEN"],
            r2_bucket=required["R2_BUCKET"],
            r2_access_key_id=required["R2_ACCESS_KEY_ID"],
            r2_secret_access_key=required["R2_SECRET_ACCESS_KEY"],
            site_url=site_url,
            database_path=database_path,
        )


# ---------- Cloudflare D1 HTTP API ----------

def d1_query(cfg: Config, sql: str, params: list | None = None) -> dict:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{cfg.cf_account_id}"
        f"/d1/database/{cfg.cf_database_id}/query"
    )
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {cfg.cf_api_token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read())
    if not payload.get("success"):
        raise RuntimeError(f"D1 error: {payload.get('errors')}")
    results = payload.get("result") or []
    return results[0] if results else {"results": []}


def ensure_tables(cfg: Config) -> None:
    d1_query(cfg, "CREATE TABLE IF NOT EXISTS site_content(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    d1_query(cfg, "CREATE TABLE IF NOT EXISTS media_assets(id TEXT PRIMARY KEY, slot TEXT, kind TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, label TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")


def read_content(cfg: Config) -> dict:
    result = d1_query(cfg, "SELECT value FROM site_content WHERE key = 'download_page'")
    rows = result.get("results", [])
    content = dict(DEFAULT_CONTENT)
    if rows and rows[0].get("value"):
        try:
            stored = json.loads(rows[0]["value"])
            if isinstance(stored, dict):
                content.update(stored)
        except Exception:
            pass
    content.setdefault("theme", dict(THEME_PRESETS["navy_gold"]))
    content.setdefault("features", [])
    content.setdefault("screenshot_media_ids", [])
    return content


def write_content(cfg: Config, content: dict) -> str:
    revision = uuid.uuid4().hex
    value = json.dumps(content, ensure_ascii=False)
    d1_query(
        cfg,
        "INSERT INTO site_content(key,value,updated_at) VALUES('download_page',?,CURRENT_TIMESTAMP) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
        [value],
    )
    d1_query(
        cfg,
        "INSERT INTO site_content(key,value,updated_at) VALUES('download_page_revision',?,CURRENT_TIMESTAMP) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
        [revision],
    )
    return revision


def record_media_asset(cfg: Config, media_id: str, slot: str | None, kind: str, content_type: str, byte_size: int) -> None:
    if slot:
        existing = d1_query(cfg, "SELECT id FROM media_assets WHERE slot = ?", [slot])
        for row in existing.get("results", []):
            old_id = row.get("id")
            if old_id:
                d1_query(cfg, "DELETE FROM media_assets WHERE id = ?", [old_id])
                try:
                    r2_request(cfg, "DELETE", old_id)
                except Exception:
                    pass
        sort_order = 0
    else:
        max_row = d1_query(cfg, "SELECT MAX(sort_order) AS m FROM media_assets WHERE kind = 'screenshot'")
        rows = max_row.get("results", [])
        current_max = rows[0].get("m") if rows and rows[0].get("m") is not None else -1
        sort_order = current_max + 1
    d1_query(
        cfg,
        "INSERT INTO media_assets(id, slot, kind, content_type, byte_size, sort_order, created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)",
        [media_id, slot, kind, content_type, byte_size, sort_order],
    )


# ---------- Cloudflare R2 (S3-compatible, hand-signed SigV4) ----------

def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _hmac(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, service)
    return _hmac(k_service, "aws4_request")


def r2_request(cfg: Config, method: str, key: str, body: bytes = b"", content_type: str = "application/octet-stream") -> bytes:
    host = f"{cfg.cf_account_id}.r2.cloudflarestorage.com"
    region, service = "auto", "s3"
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    canonical_uri = f"/{cfg.r2_bucket}/{urllib.parse.quote(key, safe='')}"
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = f"{method}\n{canonical_uri}\n\n{canonical_headers}{signed_headers}\n{payload_hash}"
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )
    signature = hmac.new(
        _signing_key(cfg.r2_secret_access_key, date_stamp, region, service),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={cfg.r2_access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": authorization,
        "User-Agent": USER_AGENT,
    }
    if method == "PUT":
        headers["Content-Type"] = content_type
    request = urllib.request.Request(
        f"https://{host}{canonical_uri}",
        data=body if method == "PUT" else None,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def sniff_image_type(data: bytes) -> str | None:
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


EXT_BY_TYPE = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


# ---------- Telegram bot plumbing (same shape as bot/hamkare_bot.py) ----------

class Bot:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.api_base = f"https://api.telegram.org/bot{config.token}/"
        self.connection = sqlite3.connect(config.database_path, timeout=30)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)")
        self.connection.commit()
        self.pending: dict[str, tuple[str, str]] = {}
        ensure_tables(config)

    def setting(self, key: str, default: str = "") -> str:
        row = self.connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return str(row[0]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.connection.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        self.connection.commit()

    def api(self, method: str, payload: dict, attempts: int = 3) -> dict:
        data = json.dumps(payload, ensure_ascii=False).encode()
        request = urllib.request.Request(
            self.api_base + method,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
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
                if attempt + 1 == attempts or (error.code < 500 and error.code != 429):
                    raise
                time.sleep(min(max(retry_after, 2**attempt), 30))
            except (urllib.error.URLError, TimeoutError):
                if attempt + 1 == attempts:
                    raise
                time.sleep(2**attempt)
        raise RuntimeError("unreachable")

    def send(self, chat_id: object, text: str, keyboard: list | None = None) -> dict:
        payload: dict = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
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

    # ---------- menus ----------

    def main_menu(self, chat_id: object) -> None:
        self.send(
            chat_id,
            "🎛 پنل مدیریت پشتیبان همکاره\nاین ربات مستقیم روی Cloudflare می‌نویسد؛ حتی اگر سایت در دسترس نباشد کار می‌کند.",
            [
                [{"text": "📝 ویرایش متن‌ها", "callback_data": "texts"}],
                [{"text": "🎨 رنگ‌بندی", "callback_data": "colors"}],
                [{"text": "🖼 تصاویر", "callback_data": "media"}],
                [{"text": "📊 وضعیت", "callback_data": "status"}],
            ],
        )

    def texts_menu(self, chat_id: object) -> None:
        rows = [[{"text": label, "callback_data": f"edit:{key}"}] for key, (label, _, _) in FIELDS.items()]
        rows.append([{"text": "⬅️ بازگشت", "callback_data": "menu"}])
        self.send(chat_id, "کدام متن را می‌خواهید ویرایش کنید؟", rows)

    def colors_menu(self, chat_id: object) -> None:
        rows = [[{"text": preset["label"], "callback_data": f"preset:{name}"}] for name, preset in THEME_PRESETS.items()]
        rows.append([{"text": "⬅️ بازگشت", "callback_data": "menu"}])
        self.send(chat_id, "یک ترکیب رنگ آماده انتخاب کنید:", rows)

    def media_menu(self, chat_id: object) -> None:
        self.send(
            chat_id,
            "کدام تصویر را می‌فرستید؟ بعد از انتخاب، عکس یا فایل تصویری را ارسال کنید (PNG/JPEG/WebP، حداکثر ۵ مگابایت).",
            [
                [{"text": "لوگوی روی کارت", "callback_data": "upload:logo"}],
                [{"text": "آیکون تب مرورگر", "callback_data": "upload:icon"}],
                [{"text": "افزودن اسکرین‌شات", "callback_data": "upload:screenshot"}],
                [{"text": "⬅️ بازگشت", "callback_data": "menu"}],
            ],
        )

    def status_message(self, chat_id: object) -> None:
        try:
            content = read_content(self.config)
            settings = d1_query(self.config, "SELECT key FROM bot_settings WHERE key IN ('telegram_token','bale_token')")
            connected = {row["key"] for row in settings.get("results", [])}
            lines = [
                "📊 وضعیت فعلی",
                f"تلگرام متصل: {'بله' if 'telegram_token' in connected else 'خیر'}",
                f"بله متصل: {'بله' if 'bale_token' in connected else 'خیر'}",
                f"نام اپلیکیشن: {content.get('app_name', '')}",
                f"تعداد اسکرین‌شات: {len(content.get('screenshot_media_ids', []))}",
                "",
                f"صفحهٔ دانلود: {self.config.site_url}/dl",
                f"پنل تصویری: {self.config.site_url}/admin",
            ]
            self.send(chat_id, "\n".join(lines))
        except Exception as error:
            self.send(chat_id, f"❌ خواندن وضعیت با خطا مواجه شد: {type(error).__name__}")

    # ---------- actions ----------

    def apply_preset(self, chat_id: object, name: str) -> None:
        preset = THEME_PRESETS.get(name)
        if not preset:
            return
        try:
            content = read_content(self.config)
            content["theme"] = {k: v for k, v in preset.items() if k != "label"}
            revision = write_content(self.config, content)
            self.send(chat_id, f"✅ رنگ‌بندی «{preset['label']}» اعمال شد.\nنسخهٔ جدید: {revision[:8]}")
        except Exception as error:
            self.send(chat_id, f"❌ ذخیره‌سازی ناموفق بود: {type(error).__name__}")

    def start_field_edit(self, chat_id: object, user_id: str, field: str) -> None:
        if field not in FIELDS:
            return
        label, max_len, _ = FIELDS[field]
        self.pending[user_id] = ("field", field)
        self.send(chat_id, f"مقدار جدید «{label}» را در یک پیام بفرستید (حداکثر {max_len} نویسه).\nبرای انصراف: /cancel")

    def start_upload(self, chat_id: object, user_id: str, kind: str) -> None:
        self.pending[user_id] = ("upload", kind)
        self.send(chat_id, "حالا عکس یا فایل تصویری را ارسال کنید.\nبرای انصراف: /cancel")

    def finish_field_edit(self, chat_id: object, user_id: str, field: str, raw_text: str) -> None:
        label, max_len, needs_url = FIELDS[field]
        value = raw_text.strip()[:max_len]
        if needs_url and value and not URL_RE.match(value):
            self.send(chat_id, "❌ آدرس باید با https:// شروع شود. دوباره امتحان کنید یا /cancel بفرستید.")
            return
        try:
            content = read_content(self.config)
            content[field] = value
            revision = write_content(self.config, content)
            self.pending.pop(user_id, None)
            self.send(chat_id, f"✅ «{label}» ذخیره شد.\nنسخهٔ جدید: {revision[:8]}")
        except Exception as error:
            self.send(chat_id, f"❌ ذخیره‌سازی ناموفق بود: {type(error).__name__}")

    def finish_upload(self, chat_id: object, user_id: str, kind: str, file_id: str) -> None:
        try:
            file_info = self.api("getFile", {"file_id": file_id})
            file_path = file_info["result"]["file_path"]
            file_url = f"https://api.telegram.org/file/bot{self.config.token}/{file_path}"
            with urllib.request.urlopen(file_url, timeout=60) as response:
                data = response.read(MAX_IMAGE_BYTES + 1)
            if len(data) > MAX_IMAGE_BYTES:
                self.send(chat_id, "❌ حجم فایل بیشتر از ۵ مگابایت است.")
                return
            content_type = sniff_image_type(data)
            if not content_type:
                self.send(chat_id, "❌ فقط PNG، JPEG یا WebP پذیرفته می‌شود.")
                return
            if kind == "screenshot":
                count_result = d1_query(self.config, "SELECT COUNT(*) AS n FROM media_assets WHERE kind = 'screenshot'")
                count = count_result.get("results", [{}])[0].get("n", 0)
                if count >= 6:
                    self.send(chat_id, "❌ حداکثر ۶ اسکرین‌شات مجاز است؛ یکی را از پنل تصویری حذف کنید.")
                    return

            media_id = f"{uuid.uuid4()}.{EXT_BY_TYPE[content_type]}"
            r2_request(self.config, "PUT", media_id, data, content_type)
            record_media_asset(
                self.config, media_id, kind if kind in SLOTS else None, kind, content_type, len(data)
            )

            content = read_content(self.config)
            if kind == "logo":
                content["logo_media_id"] = media_id
            elif kind == "icon":
                content["icon_media_id"] = media_id
            else:
                content.setdefault("screenshot_media_ids", []).append(media_id)
            revision = write_content(self.config, content)
            self.pending.pop(user_id, None)
            self.send(chat_id, f"✅ تصویر ذخیره شد.\nنسخهٔ جدید: {revision[:8]}\n{self.config.site_url}/media/{media_id}")
        except Exception as error:
            self.send(chat_id, f"❌ آپلود ناموفق بود: {type(error).__name__}")

    # ---------- update handling ----------

    def handle_callback(self, query: dict) -> None:
        user_id = str(query.get("from", {}).get("id", ""))
        chat_id = query.get("message", {}).get("chat", {}).get("id")
        data = str(query.get("data", ""))
        self.answer(str(query.get("id", "")))
        if user_id not in self.config.admin_ids:
            return
        if chat_id is None:
            return
        if data == "menu":
            self.pending.pop(user_id, None)
            self.main_menu(chat_id)
        elif data == "texts":
            self.texts_menu(chat_id)
        elif data == "colors":
            self.colors_menu(chat_id)
        elif data == "media":
            self.media_menu(chat_id)
        elif data == "status":
            self.status_message(chat_id)
        elif data.startswith("edit:"):
            self.start_field_edit(chat_id, user_id, data.split(":", 1)[1])
        elif data.startswith("preset:"):
            self.apply_preset(chat_id, data.split(":", 1)[1])
        elif data.startswith("upload:"):
            self.start_upload(chat_id, user_id, data.split(":", 1)[1])

    def handle_message(self, message: dict) -> None:
        chat_id = message.get("chat", {}).get("id")
        user_id = str(message.get("from", {}).get("id", ""))
        if chat_id is None:
            return
        if user_id not in self.config.admin_ids:
            self.send(chat_id, "⛔ این ربات فقط برای مدیران مجاز همکاره است.")
            return

        text = (message.get("text") or "").strip()
        if text in {"/start", "/panel", "/menu"}:
            self.pending.pop(user_id, None)
            self.main_menu(chat_id)
            return
        if text == "/cancel":
            self.pending.pop(user_id, None)
            self.send(chat_id, "لغو شد.")
            self.main_menu(chat_id)
            return

        state = self.pending.get(user_id)
        photo_list = message.get("photo")
        document = message.get("document")
        image_file_id = None
        if document and str(document.get("mime_type", "")).startswith("image/"):
            image_file_id = document.get("file_id")
        elif photo_list:
            image_file_id = photo_list[-1].get("file_id")

        if state and state[0] == "upload" and image_file_id:
            self.finish_upload(chat_id, user_id, state[1], image_file_id)
            return
        if state and state[0] == "field" and text:
            self.finish_field_edit(chat_id, user_id, state[1], text)
            return
        self.main_menu(chat_id)

    def process(self, update: dict) -> None:
        query = update.get("callback_query")
        if query:
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
        offset = int(self.setting("last_update_id", "-1")) + 1
        while True:
            try:
                output = self.api(
                    "getUpdates",
                    {"offset": offset, "timeout": 50, "allowed_updates": ["message", "callback_query"]},
                )
                for update in output.get("result", []):
                    update_id = int(update["update_id"])
                    if update_id < offset:
                        continue
                    self.process(update)
                    self.set_setting("last_update_id", str(update_id))
                    offset = update_id + 1
            except KeyboardInterrupt:
                return
            except urllib.error.HTTPError as error:
                print(f"polling HTTP error: {error.code}", file=sys.stderr, flush=True)
                if error.code == 409:
                    try:
                        self.api("deleteWebhook", {"drop_pending_updates": False}, attempts=1)
                    except Exception:
                        pass
                time.sleep(3)
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
