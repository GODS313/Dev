#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY="${GITHUB_REPOSITORY:-GODS313/Dev}"
SOURCE_URL="${1:-}"
EXPECTED_SHA256="${2:-}"
EXPECTED_SHA256="${EXPECTED_SHA256,,}"
CANONICAL_URL="https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk"
MAX_APK_BYTES=20971520
AOSP_TEST_CERT=a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc

[[ "$REPOSITORY" == GODS313/Dev ]] || { echo 'Unexpected repository.' >&2; exit 1; }
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo 'SHA-256 must contain exactly 64 lowercase hexadecimal characters.' >&2; exit 1; }
[[ -n "${GH_TOKEN:-}" ]] || { echo 'GH_TOKEN is required.' >&2; exit 1; }

for command_name in apksigner curl gh python3 sha256sum stat timeout; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done

python3 - "$SOURCE_URL" "$EXPECTED_SHA256" <<'PY'
import sys
from urllib.parse import parse_qs, urlsplit

url, expected = sys.argv[1:]
parsed = urlsplit(url)
query = parse_qs(parsed.query, keep_blank_values=True)
if (
    parsed.scheme != "https"
    or parsed.hostname != "seskia.online"
    or parsed.port not in (None, 443)
    or parsed.username is not None
    or parsed.password is not None
    or parsed.path != "/download.php"
    or parsed.fragment
    or query.get("src") != ["github-release"]
    or query.get("sha256") != [expected]
    or set(query) != {"src", "sha256"}
):
    raise SystemExit("Source URL is outside the approved Seskia release endpoint.")
PY

WORK_DIR="$(mktemp -d)"
RELEASE_TAG=""
RELEASE_CREATED=0
RELEASE_VERIFIED=0
cleanup() {
  local exit_code=$?
  if [[ $RELEASE_CREATED -eq 1 && $RELEASE_VERIFIED -eq 0 && -n "$RELEASE_TAG" ]]; then
    gh release delete "$RELEASE_TAG" --repo "$REPOSITORY" --yes --cleanup-tag >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

CANDIDATE="$WORK_DIR/candidate.apk"
CURRENT="$WORK_DIR/current.apk"
PUBLIC_COPY="$WORK_DIR/public.apk"

curl --fail --silent --show-error \
  --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 \
  --output "$CANDIDATE" "$SOURCE_URL"

candidate_size="$(stat -c %s "$CANDIDATE")"
[[ "$candidate_size" =~ ^[0-9]+$ && "$candidate_size" -ge 1024 && "$candidate_size" -le $MAX_APK_BYTES ]] || {
  echo 'APK size is outside the approved Telegram limit.' >&2
  exit 1
}
python3 - "$CANDIDATE" <<'PY'
import pathlib
import sys
import zipfile

path = pathlib.Path(sys.argv[1])
with path.open("rb") as source:
    if source.read(4) != b"PK\x03\x04":
        raise SystemExit("APK ZIP header is invalid.")
try:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > 100_000:
            raise SystemExit("APK entry count is outside the safe range.")
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)):
            raise SystemExit("APK contains duplicate paths.")
        for name in names:
            parts = pathlib.PurePosixPath(name.replace("\\", "/")).parts
            if name.startswith(("/", "\\")) or ".." in parts:
                raise SystemExit("APK contains an unsafe internal path.")
        if "AndroidManifest.xml" not in names or "classes.dex" not in names:
            raise SystemExit("Required APK entries are missing.")
        if sum(entry.file_size for entry in entries) > 512 * 1024 * 1024:
            raise SystemExit("APK expanded size is outside the safe range.")
        for entry in entries:
            if entry.is_dir() or entry.flag_bits & 0x1:
                continue
            with archive.open(entry) as source:
                for _chunk in iter(lambda: source.read(1024 * 1024), b""):
                    pass
except (RuntimeError, zipfile.BadZipFile) as error:
    raise SystemExit(f"APK ZIP structure is invalid: {error}") from error
PY

actual_sha256="$(sha256sum "$CANDIDATE" | awk '{print $1}')"
[[ "$actual_sha256" == "$EXPECTED_SHA256" ]] || { echo 'Downloaded APK SHA-256 does not match the approved value.' >&2; exit 1; }

apksigner verify --verbose --print-certs "$CANDIDATE" >"$WORK_DIR/candidate-certificates.txt"
sed -nE 's/.*certificate SHA-256 digest: *([0-9A-Fa-f]{64}).*/\L\1/p' \
  "$WORK_DIR/candidate-certificates.txt" | sort -u >"$WORK_DIR/candidate-signers.txt"
[[ -s "$WORK_DIR/candidate-signers.txt" ]] || { echo 'Candidate signing certificate was not found.' >&2; exit 1; }
! grep -Fxq "$AOSP_TEST_CERT" "$WORK_DIR/candidate-signers.txt" || { echo 'Android public test certificate is forbidden.' >&2; exit 1; }

curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 \
  --retry 3 --retry-all-errors --output "$CURRENT" "$CANONICAL_URL?signer-check=$GITHUB_RUN_ID"
apksigner verify --verbose --print-certs "$CURRENT" >"$WORK_DIR/current-certificates.txt"
sed -nE 's/.*certificate SHA-256 digest: *([0-9A-Fa-f]{64}).*/\L\1/p' \
  "$WORK_DIR/current-certificates.txt" | sort -u >"$WORK_DIR/current-signers.txt"
[[ -s "$WORK_DIR/current-signers.txt" ]] || { echo 'Current release signing certificate was not found.' >&2; exit 1; }
cmp -s "$WORK_DIR/current-signers.txt" "$WORK_DIR/candidate-signers.txt" || {
  echo 'Candidate signer does not match the current trusted GitHub release.' >&2
  exit 1
}

current_sha256="$(sha256sum "$CURRENT" | awk '{print $1}')"
if [[ "$current_sha256" == "$EXPECTED_SHA256" ]]; then
  echo 'The approved APK is already the current GitHub release.'
  RELEASE_VERIFIED=1
  exit 0
fi

RELEASE_TAG="hamkare-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
gh release create "$RELEASE_TAG" "$CANDIDATE#hamkare.apk" \
  --repo "$REPOSITORY" --target "$GITHUB_SHA" --draft \
  --title "Hamkare APK ${EXPECTED_SHA256:0:12}" \
  --notes "Verified automated Telegram publication. SHA-256: $EXPECTED_SHA256"
RELEASE_CREATED=1
gh release edit "$RELEASE_TAG" --repo "$REPOSITORY" --draft=false --latest

for attempt in {1..12}; do
  rm -f -- "$PUBLIC_COPY"
  if curl --fail --silent --show-error --location \
      --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 \
      --output "$PUBLIC_COPY" "$CANONICAL_URL?verify=${EXPECTED_SHA256:0:16}&attempt=$attempt"; then
    public_size="$(stat -c %s "$PUBLIC_COPY")"
    if [[ "$public_size" -le $MAX_APK_BYTES && "$(sha256sum "$PUBLIC_COPY" | awk '{print $1}')" == "$EXPECTED_SHA256" ]]; then
      RELEASE_VERIFIED=1
      echo "Published verified hamkare.apk: $EXPECTED_SHA256"
      exit 0
    fi
  fi
  sleep 5
done

echo 'Published release could not be verified; the new release will be removed automatically.' >&2
exit 1
