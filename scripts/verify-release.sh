#!/usr/bin/env bash
# Check a downloaded Arynwood MCP release: the signature on SHA256SUMS, then each package against it.
#
#   scripts/verify-release.sh [--require-all] [--key FILE] [--fingerprint FPR] [DIR]
#
# DIR (default: the current folder) holds SHA256SUMS, SHA256SUMS.asc and the packages you downloaded.
# The public key is --key, else DIR/release-signing-key.asc, else docs/release-signing-key.asc from this
# repository on GitHub. Whatever the source, the signature must come from the key with the fingerprint
# below. A package listed in SHA256SUMS that isn't in DIR is skipped, unless --require-all is given.
# Exit status is 0 only when the signature and every package checked pass.
#
# Needs gpg and sha256sum (or shasum); curl only when it has to fetch the key. Your own gpg keyring is
# not used or changed: the key is imported into a temporary one. See docs/release-signing.md.
set -euo pipefail

# The release key's primary fingerprint, 40 hex digits (docs/release-signing.md, "Release key").
RELEASE_KEY_FINGERPRINT="C536F3C4689A1734920A0E5BF1F80C83C5938FF0"
KEY_URL="https://raw.githubusercontent.com/Arynwood-Technology/ArynwoodMCP/main/docs/release-signing-key.asc"

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

require_all=0 key_file="" fingerprint="$RELEASE_KEY_FINGERPRINT" dir=.
while (($#)); do
  case "$1" in
    --require-all) require_all=1 ;;
    --key) key_file=${2:?--key needs a file}; shift ;;
    --fingerprint) fingerprint=${2:?--fingerprint needs a value}; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) dir=$1 ;;
  esac
  shift
done

problems=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; problems=$((problems + 1)); }
skip() { printf 'SKIP  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
stop() { fail "$*"; printf '\nRESULT: FAIL. Do not install or run these files.\n'; exit 1; }

# 1. Tools
command -v gpg > /dev/null || stop "gpg is not installed (Linux: the gnupg package; Windows: Gpg4win or Git Bash)"
if command -v sha256sum > /dev/null; then
  sha256() { sha256sum -- "$1" | cut -d' ' -f1; }
elif command -v shasum > /dev/null; then
  sha256() { shasum -a 256 -- "$1" | cut -d' ' -f1; }
else
  stop "neither sha256sum nor shasum is installed"
fi

# 2. The expected key
fingerprint=$(printf '%s' "$fingerprint" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
[[ -n "$fingerprint" ]] || stop "no release key has been published yet, so no release is signed. \
Check the download with SHA256SUMS.txt and its build attestation instead (docs/installation.md)."
[[ "$fingerprint" =~ ^[0-9A-F]{40}$ ]] || stop "the expected fingerprint is not 40 hex digits: $fingerprint"

# 3. The files
[[ -d "$dir" ]] || stop "no such folder: $dir"
cd "$dir"
[[ -f SHA256SUMS ]] || stop "SHA256SUMS is missing from $dir (download it from the same release)"
[[ -f SHA256SUMS.asc ]] || stop "SHA256SUMS.asc is missing from $dir (download it from the same release)"

home=$(mktemp -d)
cleanup() { gpgconf --homedir "$home" --kill all > /dev/null 2>&1 || true; rm -rf "$home"; }
trap cleanup EXIT
chmod 700 "$home"

if [[ -z "$key_file" && -f release-signing-key.asc ]]; then
  key_file=release-signing-key.asc
fi
if [[ -z "$key_file" ]]; then
  command -v curl > /dev/null || stop "curl is needed to fetch the public key; or download it and pass --key"
  curl -fsSL --proto '=https' --tlsv1.2 "$KEY_URL" -o "$home/release-signing-key.asc" \
    || stop "could not download the public key from $KEY_URL"
  key_file="$home/release-signing-key.asc"
fi
[[ -f "$key_file" ]] || stop "no such key file: $key_file"

# 4. The key: import into a throwaway keyring and check it is the release key
gpg --homedir "$home" --batch --quiet --import "$key_file" > /dev/null 2>&1 \
  || stop "the key file could not be read as an OpenPGP public key: $key_file"
primaries=$(gpg --homedir "$home" --batch --with-colons --fingerprint 2>/dev/null \
  | awk -F: '$1 == "pub" {want = 1; next} want && $1 == "fpr" {print $10; want = 0}')
if grep -qx "$fingerprint" <<< "$primaries"; then
  pass "public key is the release key ($fingerprint)"
else
  stop "the public key in $key_file is not the release key: it has $(tr '\n' ' ' <<< "$primaries")but the release key is $fingerprint"
fi

# 5. The signature on SHA256SUMS
status=$(gpg --homedir "$home" --batch --status-fd 1 --trust-model always \
  --verify SHA256SUMS.asc SHA256SUMS 2>/dev/null || true)
if grep -qE '^\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG|NO_PUBKEY)' <<< "$status"; then
  reason=$(grep -oE '^\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG|NO_PUBKEY)' <<< "$status" | head -1 | cut -d' ' -f2)
  case "$reason" in
    BADSIG) stop "the signature does not match SHA256SUMS: the file was changed after it was signed" ;;
    REVKEYSIG) stop "the signing key has been revoked" ;;
    EXPKEYSIG) stop "the signing key has expired; fetch the current public key from the repository and retry" ;;
    EXPSIG) stop "the signature has expired" ;;
    *) stop "the signature could not be checked with the release key ($reason)" ;;
  esac
fi
validsig=$(grep -E '^\[GNUPG:\] VALIDSIG ' <<< "$status" | head -1 || true)
[[ -n "$validsig" ]] || stop "SHA256SUMS.asc holds no valid signature over SHA256SUMS"
signer=$(cut -d' ' -f12 <<< "$validsig")
hash_algo=$(cut -d' ' -f10 <<< "$validsig")
[[ "$signer" == "$fingerprint" ]] || stop "SHA256SUMS was signed by $signer, not by the release key $fingerprint"
# OpenPGP hash ids: 8 SHA-256, 9 SHA-384, 10 SHA-512, 11 SHA-224. MD5, SHA-1 and RIPEMD-160 are refused.
[[ "$hash_algo" =~ ^(8|9|10|11)$ ]] || stop "the signature uses a weak hash (OpenPGP id $hash_algo)"
pass "SHA256SUMS is signed by the release key"

# 6. Each package against SHA256SUMS
checked=0 listed=()
line_no=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  line=${line%$'\r'}
  [[ -z "$line" ]] && continue
  if [[ ! "$line" =~ ^([0-9a-f]{64})\ [\ *]([A-Za-z0-9._+-]+)$ ]]; then
    fail "SHA256SUMS line $line_no is not '<sha256>  <file name>'"
    continue
  fi
  want=${BASH_REMATCH[1]} name=${BASH_REMATCH[2]}
  for seen in ${listed[@]+"${listed[@]}"}; do
    [[ "$seen" == "$name" ]] && { fail "$name is listed twice in SHA256SUMS"; continue 2; }
  done
  listed+=("$name")
  if [[ ! -f "$name" ]]; then
    if ((require_all)); then fail "$name is listed but not in $dir"; else skip "$name (not downloaded)"; fi
    continue
  fi
  got=$(sha256 "$name")
  if [[ "$got" == "$want" ]]; then
    pass "$name matches SHA256SUMS"
    checked=$((checked + 1))
  else
    fail "$name does NOT match SHA256SUMS (expected $want, got $got)"
  fi
done < SHA256SUMS
((${#listed[@]})) || fail "SHA256SUMS lists no files"
((checked)) || ((problems)) || fail "none of the packages in SHA256SUMS is in $dir"

# 7. Files here that the signature doesn't cover
for f in *; do
  [[ -f "$f" ]] || continue
  case "$f" in SHA256SUMS|SHA256SUMS.asc|SHA256SUMS*.txt|release-signing-key.asc) continue ;; esac
  covered=0
  for seen in ${listed[@]+"${listed[@]}"}; do [[ "$seen" == "$f" ]] && covered=1; done
  ((covered)) || warn "$f is not covered by the signature"
done

if ((problems)); then
  printf '\nRESULT: FAIL (%d problem(s)). Do not install or run these files.\n' "$problems"
  exit 1
fi
printf '\nRESULT: PASS. %d package(s) match the signed SHA256SUMS.\n' "$checked"
