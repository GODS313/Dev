#!/usr/bin/env python3
"""White-label, registration-free Telegram/Bale download bot for Hamkare.

Unlike bot/hamkare_bot.py (recruitment + admin), this bot has exactly one
job: hand a visitor the app download link. It has no admin commands and no
database of applicants -- it only remembers the last update offset so a
restart does not replay old messages. Every reply is built live from the
public /api/download-page content so a text/color edit made from the admin
panel (or the master bot) shows up here without redeploying this file.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

CONTENT_CACHE_SECONDS = 45
USER_AGENT = "HamkareDownloadBot/1.0"


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


@dataclass(frozen=True)
class Config:
    platform: str
    token: str
    download_url: str
    dl_page_url: str
    content_api_url: str
    brand_name: str
    database_path: Path

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
            for key in ("DOWNLOAD_URL", "DL_PAGE_URL", "CONTENT_API_URL")
        }
        for key, value in urls.items():
            if not valid_https_url(value):
                raise ValueError(f"{key} must be a complete HTTPS URL")
        database_path = Path(
            os.environ.get("DATABASE_PATH", "/opt/hamkare-download-bots/state.sqlite3")
        )
        if not database_path.is_absolute():
            raise ValueError("DATABASE_PATH must be an absolute path")
        return cls(
            platform=platform,
            token=token,
            download_url=urls["DOWNLOAD_URL"],
            dl_page_url=urls["DL_PAGE_URL"],
            content_api_url=urls["CONTENT_API_URL"],
            brand_name=os.environ.get("BRAND_NAME", "همکاره").strip()[:50] or "همکاره",
            database_path=database_path,
        )


DEFAULT_CONTENT = {
    "app_name": "همکاره",
    "tagline": "دستیار استخدام و همکاری شما",
    "description": "برای دریافت اپلیکیشن روی دکمهٔ زیر بزنید.",
    "cta_label": "دانلود مستقیم اپلیکیشن",
    "version_label": "",
}


class ContentCache:
    """Tiny TTL cache around the public download-page JSON endpoint."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._value: dict = DEFAULT_CONTENT
        self._fetched_at = 0.0

    def get(self) -> dict:
        now = time.monotonic()
        if now - self._fetched_at < CONTENT_CACHE_SECONDS:
            return self._value
        try:
            request = urllib.request.Request(
                self.url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                raw = response.read(256 * 1024 + 1)
            if len(raw) <= 256 * 1024:
                payload = json.loads(raw)
                content = payload.get("content")
                if isinstance(content, dict) and content.get("app_name"):
                    self._value = content
        except Exception:
            pass  # Keep serving the last known-good (or default) content.
        self._fetched_at = now
        return self._value


class Bot:
    def __init__(self, config: Config) -> None:
        self.config = config
        api_host = (
            "https://api.telegram.org/bot"
            if config.platform == "telegram"
            else "https://tapi.bale.ai/bot"
        )
        self.api_base = f"{api_host}{config.token}/"
        self.content = ContentCache(config.content_api_url)
        self.connection = sqlite3.connect(config.database_path, timeout=30)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)"
        )
        self.connection.commit()

    def setting(self, key: str, default: str = "") -> str:
        row = self.connection.execute(
            "SELECT value FROM settings WHERE key=?", (key,)
        ).fetchone()
        return str(row[0]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.connection.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
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

    def welcome_text(self, content: dict) -> str:
        lines = [
            f"👋 {content.get('app_name', self.config.brand_name)}",
        ]
        tagline = content.get("tagline")
        if tagline:
            lines.append(tagline)
        description = content.get("description")
        if description:
            lines.append("")
            lines.append(description)
        version_label = content.get("version_label")
        if version_label:
            lines.append("")
            lines.append(f"📦 {version_label}")
        return "\n".join(lines)

    def welcome_keyboard(self, content: dict) -> list:
        cta = content.get("cta_label") or "دانلود مستقیم اپلیکیشن"
        return [
            [{"text": f"📥 {cta}", "url": self.config.download_url}],
            [{"text": "🌐 مشاهدهٔ صفحهٔ کامل دانلود", "url": self.config.dl_page_url}],
        ]

    def handle_message(self, message: dict) -> None:
        chat_id = message.get("chat", {}).get("id")
        if chat_id is None:
            return
        content = self.content.get()
        self.send(chat_id, self.welcome_text(content), self.welcome_keyboard(content))

    def process(self, update: dict) -> None:
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
                    {"offset": offset, "timeout": 50, "allowed_updates": ["message"]},
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
