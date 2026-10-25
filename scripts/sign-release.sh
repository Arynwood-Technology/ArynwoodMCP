#!/usr/bin/env bash
# Sign a release's checksums with the owner's release key. The owner runs this; see docs/release-signing.md.
#
#   scripts/sign-release.sh vX.Y.Z [--upload] [--out DIR]
#   scripts/sign-release.sh --from-dir DIR [--expect GLOB]... [--key FILE] [--fingerprint FPR]
#
# With a tag it downloads that DRAFT release's assets (a published release is refused: past releases are
# never re-signed) into DIR (default: a new temporary folder). With --from-dir it uses packages already on
# disk. Then, in order:
#   1. checks the packages against the CI's checksum lists (SHA256SUMS.txt, SHA256SUMS-windows.txt)
#   2. writes SHA256SUMS, one line per package
#   3. signs it with the release key: SHA256SUMS.asc, a detached, ASCII-armored OpenPGP signature
#   4. checks the result with scripts/verify-release.sh against the published public key
#   5. with --upload, attaches SHA256SUMS and SHA256SUMS.asc to the draft; otherwise prints that command
# gpg asks for the key's passphrase itself; this script never sees or stores it.
set -euo pipefail

REPO=Arynwood-Technology/ArynwoodMCP
# Every release carries exactly one of each (override with --expect, e.g. for another project).
DEFAULT_EXPECT=('*_amd64.AppImage' '*_amd64.deb' '*_x64-setup.exe')

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { printf 'sign-release: %s\n' "$*" >&2; exit 1; }
# True when file name $1 matches the pattern $2. Unquoted on purpose: --expect patterns are globs.
# shellcheck disable=SC2053
matches_glob() { [[ "$1" == $2 ]]; }

tag="" from_dir="" out="" upload=0 key_file="" fingerprint="" expect=()
while (($#)); do
  case "$1" in
    --from-dir) from_dir=${2:?--from-dir needs a folder}; shift ;;
    --out) out=${2:?--out needs a folder}; shift ;;
    --upload) upload=1 ;;
    --expect) expect+=("${2:?--expect needs a pattern}"); shift ;;
    --key) key_file=${2:?--key needs a file}; shift ;;
    --fingerprint) fingerprint=${2:?--fingerprint needs a value}; shift ;;
    -h|--help) usage ;;
    -*) die "unknown option: $1" ;;
    *) tag=$1 ;;
  esac
  shift
done
[[ -n "$tag" || -n "$from_dir" ]] || usage
[[ -n "$tag" && -n "$from_dir" ]] && die "give a tag or --from-dir, not both"
((upload)) && [[ -z "$tag" ]] && die "--upload needs a tag"
((${#expect[@]})) || expect=("${DEFAULT_EXPECT[@]}")

for tool in gpg sha256sum; do command -v "$tool" > /dev/null || die "$tool is not installed"; done

# The release key: the fingerprint pinned in verify-release.sh, and the published public key.
if [[ -z "$fingerprint" ]]; then
  fingerprint=$(sed -n 's/^RELEASE_KEY_FINGERPRINT="\([0-9A-Fa-f]*\)"$/\1/p' "$here/verify-release.sh")
fi
fingerprint=$(printf '%s' "$fingerprint" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
[[ -n "$fingerprint" ]] || die "no release key yet: create one first (docs/release-signing.md, \"One-time key setup\")"
[[ "$fingerprint" =~ ^[0-9A-F]{40}$ ]] || die "the fingerprint is not 40 hex digits: $fingerprint"
key_file=${key_file:-$root/docs/release-signing-key.asc}
[[ -f "$key_file" ]] || die "the public key isn't published at $key_file yet (docs/release-signing.md)"
gpg --batch --list-secret-keys "$fingerprint" > /dev/null 2>&1 \
  || die "the private key for $fingerprint isn't in this gpg keyring (gpg --list-secret-keys)"

# The packages
if [[ -n "$tag" ]]; then
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the tag must look like v1.2.3: $tag"
  command -v gh > /dev/null || die "gh (the GitHub CLI) is needed to download the draft release"
  [[ "$(gh release view "$tag" --repo "$REPO" --json isDraft --jq .isDraft)" == true ]] \
    || die "$tag is not a draft release; published releases are never re-signed"
  assets=$(gh release view "$tag" --repo "$REPO" --json assets --jq '.assets[].name')
  grep -qxE 'SHA256SUMS|SHA256SUMS\.asc' <<< "$assets" \
    && die "$tag already has SHA256SUMS or SHA256SUMS.asc; delete them from the draft first to sign again"
  if [[ -n "$out" ]]; then
    [[ ! -e "$out" ]] || [[ -z "$(ls -A "$out")" ]] || die "$out is not empty"
    mkdir -p "$out"
  else
    out=$(mktemp -d "${TMPDIR:-/tmp}/arynwood-sign-$tag.XXXXXX")
  fi
  gh release download "$tag" --repo "$REPO" --dir "$out"
  dir=$out
else
  [[ -d "$from_dir" ]] || die "no such folder: $from_dir"
  dir=$from_dir
fi
dir=$(cd "$dir" && pwd)
cd "$dir"
[[ -e SHA256SUMS || -e SHA256SUMS.asc ]] && die "$dir already has SHA256SUMS or SHA256SUMS.asc"

packages=()
for f in *; do
  [[ -f "$f" ]] || continue
  case "$f" in SHA256SUMS*.txt|*.asc|*.sig) continue ;; esac
  [[ "$f" =~ ^[A-Za-z0-9._+-]+$ ]] || die "unexpected characters in a file name: $f"
  packages+=("$f")
done
((${#packages[@]})) || die "no packages in $dir"

for pattern in "${expect[@]}"; do
  matches=0
  for f in "${packages[@]}"; do
    if matches_glob "$f" "$pattern"; then matches=$((matches + 1)); fi
  done
  ((matches == 1)) || die "expected exactly one package matching $pattern, found $matches"
done
for f in "${packages[@]}"; do
  known=0
  for pattern in "${expect[@]}"; do
    if matches_glob "$f" "$pattern"; then known=1; fi
  done
  ((known)) || die "unexpected file $f: remove it, or name its pattern with --expect"
  if [[ -n "$tag" && "$f" != *"_${tag#v}_"* ]]; then die "$f is not a ${tag#v} package"; fi
done

# 1. What CI built: every package must be in a CI checksum list, and every list must match.
lists=()
for list in SHA256SUMS*.txt; do [[ -f "$list" ]] && lists+=("$list"); done
if ((${#lists[@]})); then
  for list in "${lists[@]}"; do
    tr -d '\r' < "$list" | sha256sum --check --strict - || die "$list does not match the downloaded files"
  done
  for f in "${packages[@]}"; do
    cat "${lists[@]}" | tr -d '\r' | awk -v f="$f" '$2 == f || $2 == "*" f {found = 1} END {exit !found}' \
      || die "$f is in no CI checksum list (${lists[*]})"
  done
elif [[ -n "$tag" ]]; then
  die "the draft has no CI checksum list (SHA256SUMS.txt); was it made by the release workflow?"
else
  echo "note: no CI checksum list in $dir; signing the files as they are"
fi

# 2. SHA256SUMS
printf '%s\n' "${packages[@]}" | LC_ALL=C sort | while IFS= read -r f; do sha256sum -- "$f"; done > SHA256SUMS
echo "SHA256SUMS:"; cat SHA256SUMS

# 3. The signature (gpg asks for the passphrase through its own prompt)
GPG_TTY=${GPG_TTY:-$(tty 2> /dev/null || true)}
export GPG_TTY
gpg --local-user "$fingerprint" --digest-algo SHA512 --armor --detach-sign --output SHA256SUMS.asc SHA256SUMS

# 4. Check it the way a user will
"$here/verify-release.sh" --require-all --key "$key_file" --fingerprint "$fingerprint" "$dir"

# 5. Publish
if ((upload)); then
  gh release upload "$tag" --repo "$REPO" SHA256SUMS SHA256SUMS.asc
  echo "Attached SHA256SUMS and SHA256SUMS.asc to the $tag draft. Publishing it is still your step."
elif [[ -n "$tag" ]]; then
  echo "Signed. To attach both files to the $tag draft:"
  echo "  gh release upload $tag --repo $REPO \"$dir/SHA256SUMS\" \"$dir/SHA256SUMS.asc\""
else
  echo "Signed: $dir/SHA256SUMS and $dir/SHA256SUMS.asc"
fi
