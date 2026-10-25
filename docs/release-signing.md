# Release signing

From the first release signed with the release key, every release carries two more files:

- `SHA256SUMS`: the SHA-256 checksum of every package in the release (AppImage, `.deb`, Windows installer).
- `SHA256SUMS.asc`: a detached, ASCII-armored OpenPGP signature of `SHA256SUMS`, made with the owner's
  release key.

A checksum proves a file arrived intact. The signature proves the checksums came from the owner, so one
signature covers every package. The build attestations (from 0.5.4) are a separate check: they prove which
workflow built a file from which tag.

**Status:** the release key was created and published on 2026-10-25 (below). No release has been signed with
it yet; signing starts with the next release. Releases up to and including 0.5.3 are not signed and won't be
re-signed.

| File | Who runs it | What it does |
|---|---|---|
| `scripts/sign-release.sh` | the owner, at release time | checks a draft release's packages against the build's checksum lists, writes `SHA256SUMS`, signs it, checks the result |
| `scripts/verify-release.sh` | anyone who downloads a release | checks the signature against the release key, then each downloaded package against `SHA256SUMS` |
| `docs/release-signing-key.asc` | — | the public half of the release key |
| `tests/test_release_signing.py` | CI | signs and verifies with throwaway keys, including tampered files and the wrong key |

## Release key

- Fingerprint: **`C536 F3C4 689A 1734 920A  0E5B F1F8 0C83 C593 8FF0`**
- Key: Ed25519, signing only, created 2026-10-25, expires 2028-10-24
- Public key: [`docs/release-signing-key.asc`](release-signing-key.asc)

Before trusting a key, compare its fingerprint with this page and with arynwood.com's security page (once it
lists it). The private key never leaves the owner's machine and its offline backup.

## One-time key setup (owner)

Done for the current key on 2026-10-25. The steps stay here for replacing it; step 5 is how to extend it.

Do this on your own computer, in a terminal. Never paste the passphrase, the private key or the revocation
certificate into a chat, an issue, a commit or any file in a repository, including `arynwood-private`.

1. Create the key: Ed25519, signing only, valid for two years. Use an email address you're happy to have
   public forever; it becomes part of the key. gpg asks for a passphrase in its own window. Choose a long one
   and keep it in your password manager.

   ```bash
   gpg --quick-gen-key 'Arynwood Technology release signing <YOUR-ADDRESS@arynwood.com>' ed25519 sign 2y
   ```

   If it says `agent_genkey failed: Operation cancelled`, the passphrase window got no answer: it can open
   behind other windows, or gpg's background helper was started from another session. Run
   `export GPG_TTY=$(tty)` and `gpgconf --kill gpg-agent`, then try again. Or add `--pinentry-mode loopback`
   right after `gpg` to type the passphrase in the terminal; that is what worked for the current key.

2. Read its fingerprint (40 hex digits) and keep it in a shell variable for the next steps:

   ```bash
   FPR=$(gpg --with-colons --list-secret-keys 'Arynwood Technology release signing' | awk -F: '$1=="fpr"{print $10; exit}')
   echo "$FPR"
   ```

3. Back up the private key and its revocation certificate straight to an encrypted USB drive or another
   offline place. Replace `/media/BACKUP` with that drive's folder. The revocation certificate is what you'd
   use to announce "this key is no longer trusted" if it's ever stolen.

   ```bash
   gpg --armor --output "/media/BACKUP/arynwood-release-key.secret.asc" --export-secret-keys "$FPR"
   cp ~/.gnupg/openpgp-revocs.d/"$FPR".rev /media/BACKUP/arynwood-release-key.rev
   ```

4. Publish the public key, on a branch in its own folder (your main checkout stays as it is):

   ```bash
   git -C ~/GitHub/arynwood-mcp fetch public
   git -C ~/GitHub/arynwood-mcp worktree add -b release-key ~/GitHub/arynwood-mcp-release-key public/main
   cd ~/GitHub/arynwood-mcp-release-key
   gpg --armor --export "$FPR" > docs/release-signing-key.asc
   sed -i "s/^RELEASE_KEY_FINGERPRINT=\"\"/RELEASE_KEY_FINGERPRINT=\"$FPR\"/" scripts/verify-release.sh
   ```

   Then replace both "not published yet" lines under **Release key** above with the fingerprint and the
   link. `tests/test_release_signing.py` fails if the key file, the script and this page disagree. Commit,
   open a pull request and merge it. Also put the fingerprint on arynwood.com's security page, so a reader can
   check it somewhere other than GitHub.

5. Before the key expires (two years from step 1), extend it and publish the refreshed public key the same
   way. Verification of older releases keeps working, because the fingerprint stays the same:

   ```bash
   gpg --quick-set-expire "$FPR" 2y
   gpg --armor --export "$FPR" > docs/release-signing-key.asc
   ```

## Signing a release (owner)

Signing is the last step before publishing a draft. The steps before it are unchanged:

1. Push the tag `vX.Y.Z`. **Release (Linux)** builds the AppImage and `.deb`, attests them and creates the
   draft release with `SHA256SUMS.txt`.
2. **Windows desktop** builds the installer for the same tag.
3. Run **Verify release artifacts** with the tag and both run ids. It checks everything and attaches the
   Windows installer and `SHA256SUMS-windows.txt` to the draft.
4. Sign the draft, from an up-to-date checkout. gpg asks for the key's passphrase:

   ```bash
   cd ~/GitHub/arynwood-mcp
   git -c pull.rebase=false pull --ff-only public main
   scripts/sign-release.sh vX.Y.Z --upload
   ```

   It downloads the draft's files into a new temporary folder, then:
   - checks each package against the build's own checksum lists (`SHA256SUMS.txt`, `SHA256SUMS-windows.txt`);
   - writes `SHA256SUMS` and signs it (`SHA256SUMS.asc`);
   - runs `verify-release.sh --require-all` on the result, against the published key;
   - attaches both files to the draft.

   Without `--upload` it stops after the check and prints the `gh release upload` command. Add `--loopback`
   to type the passphrase in the terminal, if the passphrase window doesn't appear.

   It refuses, changing nothing, when:
   - the release is already published (past releases are never re-signed);
   - the draft already has `SHA256SUMS` or `SHA256SUMS.asc`;
   - a package is missing, unexpected, from another version, or doesn't match the build's lists;
   - the private key isn't in your keyring.

5. The draft's notes come from `CHANGELOG.md`. Add the **Verify your download** section from
   [`releases/TEMPLATE.md`](releases/TEMPLATE.md) to them, with the fingerprint.
6. Publish the draft.
7. Check it as a user would. In an empty folder:

   ```bash
   gh release download vX.Y.Z --repo Arynwood-Technology/ArynwoodMCP
   bash ~/GitHub/arynwood-mcp/scripts/verify-release.sh --require-all
   ```

## Verifying a download

Put `SHA256SUMS`, `SHA256SUMS.asc` and the package or packages you downloaded in one folder.

**Linux and macOS, with the script.** It uses a temporary keyring, so your own gpg keyring isn't changed. It
fetches the public key from this repository and refuses any key whose fingerprint isn't the release key's:

```bash
curl -fsSLO https://raw.githubusercontent.com/Arynwood-Technology/ArynwoodMCP/main/scripts/verify-release.sh
bash verify-release.sh
```

It prints PASS or FAIL for the key, the signature and each package, and `RESULT: PASS` only when everything
it checked passed. A package you didn't download is shown as SKIP.

**By hand**, the same two checks. Import the key once, then:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
```

The first must say `Good signature`, from a key whose fingerprint matches **Release key** above. gpg also
warns that the key "is not certified with a trusted signature"; the fingerprint check is what matters. The
second must say `OK` for each package you have.

**Windows, PowerShell** with [Gpg4win](https://gpg4win.org/) installed, after downloading the public key
(link under **Release key**) into the same folder. Git Bash can also run `verify-release.sh`. Neither route
has been tested yet.

```powershell
gpg --import .\release-signing-key.asc
gpg --verify .\SHA256SUMS.asc .\SHA256SUMS
$expected = (Select-String -Path .\SHA256SUMS -Pattern 'x64-setup.exe').Line.Split(' ')[0]
if ((Get-FileHash .\arynwood-mcp_X.Y.Z_x64-setup.exe -Algorithm SHA256).Hash -eq $expected) { 'OK' } else { 'MISMATCH: do not run this file' }
```

## When verification fails

- **A package does NOT match `SHA256SUMS`.** The download is damaged or was changed. Delete it and download it
  again from the release page. If it still fails, don't run it, and report it (`SECURITY.md`).
- **The signature doesn't match, the key is not the release key, or the file was signed by another key.**
  Treat it as tampering: don't run anything from that folder, and report it.
- **The signing key has expired.** Fetch the current public key (the owner extends it before it expires) and
  try again.
- **The signing key has been revoked.** Don't trust the files. Check this page and the release notes for the
  replacement key.
- **"No release key has been published yet".** That release isn't signed. Check it with `SHA256SUMS.txt` and
  its build attestation instead ([installation](installation.md)).

For the owner, `sign-release.sh` explains each refusal. The most likely one is a missing Windows installer:
run **Verify release artifacts** first.

If the private key is ever lost, published or stolen:

- Import the revocation certificate from the backup (`gpg --import arynwood-release-key.rev`).
- Publish the revoked public key as above, so verification refuses everything that key signed.
- Create a new key, and say what happened in a security advisory.
- To check an older release after a key change, keep the old public key and pass it with
  `--key old.asc --fingerprint OLDFINGERPRINT`.

## Scorecard

OpenSSF Scorecard's Signed-Releases check looks for signature files (such as `.asc`) among a project's
recent release assets. Signed releases give it something to find. Only releases signed from now on can
count, and the effect on the score hasn't been measured.

## Reusing this for another project

Both scripts are self-contained:

- **`sign-release.sh`:** change `REPO` and `DEFAULT_EXPECT` (the package name patterns). Its cross-check reads
  the build's `SHA256SUMS*.txt` lists, so a project that publishes per-file `.sha256` files, as Grove does,
  needs that step adapted.
- **`verify-release.sh`:** change `KEY_URL` and `RELEASE_KEY_FINGERPRINT`.

One owner key can sign several projects' releases. A key per project keeps them independent.
