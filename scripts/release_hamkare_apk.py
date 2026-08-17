#!/usr/bin/env python3
"""Safely fetch and validate an approved Hamkare APK.

Approval is represented by an operator-supplied SHA-256 digest. Downloads are
limited to public HTTPS endpoints on port 443, including every redirect hop.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import ipaddress
import os
import re
import socket
import ssl
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit


MIN_APK_BYTES = 64 * 1024
MAX_APK_BYTES = 100 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_ZIP_ENTRIES = 200_000
MAX_REDIRECTS = 5
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
APK_SIG_BLOCK_MAGIC = b"APK Sig Block 42"
REQUIRED_ENTRIES = {"AndroidManifest.xml", "classes.dex", "resources.arsc"}
ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


class ReleaseError(RuntimeError):
    """A safe, user-facing validation failure."""


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection whose TCP destination is a previously checked IP."""

    def __init__(self, host: str, ip: str, *, timeout: int = 30) -> None:
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = ip

    def connect(self) -> None:
        raw_socket = socket.create_connection((self._pinned_ip, 443), self.timeout)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)


def normalized_sha256(value: str) -> str:
    value = value.strip().lower()
    if not SHA256_RE.fullmatch(value):
        raise ReleaseError("SHA-256 must contain exactly 64 hexadecimal characters")
    return value


def _public_addresses(host: str) -> list[str]:
    try:
        records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ReleaseError(f"source host could not be resolved: {host}") from exc

    addresses = sorted({record[4][0].split("%", 1)[0] for record in records})
    if not addresses:
        raise ReleaseError(f"source host has no usable address: {host}")
    for address in addresses:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError as exc:
            raise ReleaseError(f"source host resolved to an invalid address: {address}") from exc
        if not parsed.is_global:
            raise ReleaseError(f"source host resolved to a non-public address: {address}")
    return addresses


def checked_url(url: str) -> tuple[str, str, str]:
    if any(ord(character) < 32 or ord(character) == 127 for character in url):
        raise ReleaseError("source URL contains a control character")
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise ReleaseError("source URL is malformed") from exc
    if parsed.scheme.lower() != "https":
        raise ReleaseError("source URL must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ReleaseError("source URL must not contain credentials or a fragment")
    if port not in (None, 443):
        raise ReleaseError("source URL must use HTTPS port 443")

    try:
        host = parsed.hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ReleaseError("source URL contains an invalid host name") from exc
    addresses = _public_addresses(host)
    request_target = parsed.path or "/"
    if parsed.query:
        request_target += "?" + parsed.query
    return host, addresses[0], request_target


def _safe_display_url(url: str) -> str:
    parsed = urlsplit(url)
    return f"https://{parsed.hostname}{parsed.path or '/'}"


def download(url: str, destination: Path, expected_sha256: str) -> tuple[int, str]:
    expected = normalized_sha256(expected_sha256)
    current_url = url.strip()
    temporary = destination.with_name(destination.name + ".part")
    temporary.unlink(missing_ok=True)

    try:
        for redirect_count in range(MAX_REDIRECTS + 1):
            host, ip, request_target = checked_url(current_url)
            connection = PinnedHTTPSConnection(host, ip)
            try:
                connection.request(
                    "GET",
                    request_target,
                    headers={
                        "Accept": "application/vnd.android.package-archive, application/octet-stream",
                        "Accept-Encoding": "identity",
                        "User-Agent": "hamkare-release-publisher/1.0",
                    },
                )
                response = connection.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    if not location:
                        raise ReleaseError("redirect response did not include a Location header")
                    if redirect_count == MAX_REDIRECTS:
                        raise ReleaseError("source URL exceeded the redirect limit")
                    current_url = urljoin(current_url, location)
                    continue
                if response.status != 200:
                    raise ReleaseError(f"source returned HTTP {response.status}")

                content_length = response.getheader("Content-Length")
                if content_length:
                    try:
                        declared_size = int(content_length)
                    except ValueError as exc:
                        raise ReleaseError("source returned an invalid Content-Length") from exc
                    if not MIN_APK_BYTES <= declared_size <= MAX_APK_BYTES:
                        raise ReleaseError("declared APK size is outside the allowed range")

                digest = hashlib.sha256()
                size = 0
                with temporary.open("xb") as output:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_APK_BYTES:
                            raise ReleaseError("downloaded APK exceeds the 100 MiB limit")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if content_length and size != declared_size:
                    raise ReleaseError("downloaded size does not match Content-Length")
                if size < MIN_APK_BYTES:
                    raise ReleaseError("downloaded APK is smaller than 64 KiB")
                actual = digest.hexdigest()
                if actual != expected:
                    raise ReleaseError(f"SHA-256 mismatch: expected {expected}, received {actual}")
                os.replace(temporary, destination)
                print(f"Downloaded {_safe_display_url(current_url)} ({size} bytes)")
                return size, actual
            finally:
                connection.close()
        raise ReleaseError("source URL exceeded the redirect limit")
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _has_v2_or_newer_signature(path: Path, archive: zipfile.ZipFile) -> bool:
    central_directory_offset = archive.start_dir
    if central_directory_offset < len(APK_SIG_BLOCK_MAGIC):
        return False
    with path.open("rb") as apk:
        apk.seek(central_directory_offset - len(APK_SIG_BLOCK_MAGIC))
        return apk.read(len(APK_SIG_BLOCK_MAGIC)) == APK_SIG_BLOCK_MAGIC


def validate_apk(
    path: Path,
    *,
    min_size: int = MIN_APK_BYTES,
    max_size: int = MAX_APK_BYTES,
) -> None:
    size = path.stat().st_size
    if not min_size <= size <= max_size:
        raise ReleaseError("APK size is outside the allowed range")
    if not zipfile.is_zipfile(path):
        raise ReleaseError("file is not a valid ZIP/APK archive")

    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ZIP_ENTRIES:
            raise ReleaseError("APK contains an invalid number of ZIP entries")

        names: set[str] = set()
        uncompressed_size = 0
        for entry in entries:
            name = entry.filename
            pure_name = PurePosixPath(name)
            if (
                not name
                or "\\" in name
                or name.startswith("/")
                or "\x00" in name
                or ".." in pure_name.parts
            ):
                raise ReleaseError(f"APK contains an unsafe ZIP path: {name!r}")
            if name in names:
                raise ReleaseError(f"APK contains a duplicate ZIP entry: {name}")
            names.add(name)
            if entry.flag_bits & 0x1:
                raise ReleaseError(f"APK contains an encrypted ZIP entry: {name}")
            if entry.compress_type not in ALLOWED_COMPRESSION:
                raise ReleaseError(f"APK uses an unsupported compression method: {name}")
            mode = (entry.external_attr >> 16) & 0xFFFF
            if mode and stat.S_ISLNK(mode):
                raise ReleaseError(f"APK contains a symbolic link: {name}")
            uncompressed_size += entry.file_size
            if uncompressed_size > MAX_UNCOMPRESSED_BYTES:
                raise ReleaseError("APK expands beyond the 512 MiB safety limit")

        missing = sorted(REQUIRED_ENTRIES - names)
        if missing:
            raise ReleaseError("APK is missing required entries: " + ", ".join(missing))

        upper_names = {name.upper() for name in names}
        has_v1_metadata = any(
            name.startswith("META-INF/") and name.endswith(".SF") for name in upper_names
        ) and any(
            name.startswith("META-INF/") and name.endswith((".RSA", ".DSA", ".EC"))
            for name in upper_names
        )
        if not has_v1_metadata and not _has_v2_or_newer_signature(path, archive):
            raise ReleaseError("APK has no recognizable Android signing metadata")

        corrupt_entry = archive.testzip()
        if corrupt_entry is not None:
            raise ReleaseError(f"APK CRC validation failed for: {corrupt_entry}")


def verify_file_hash(path: Path, expected_sha256: str) -> str:
    expected = normalized_sha256(expected_sha256)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        raise ReleaseError(f"SHA-256 mismatch: expected {expected}, received {actual}")
    return actual


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch = subparsers.add_parser("fetch", help="download and validate an APK")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--sha256", required=True)
    fetch.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate", help="validate a local APK")
    validate.add_argument("--file", type=Path, required=True)
    validate.add_argument("--sha256", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "fetch":
            download(args.url, args.output, args.sha256)
            validate_apk(args.output)
            verify_file_hash(args.output, args.sha256)
        else:
            validate_apk(args.file)
            verify_file_hash(args.file, args.sha256)
    except (OSError, ReleaseError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print("APK validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
