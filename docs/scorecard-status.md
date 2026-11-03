# Scorecard follow-up

## Signed releases — 2026-11-02

The analysis of `e5f016c` (after #48 and #49) is still **6.7/10**. Signed-Releases is
1/10. Scorecard v5.6.0 scores each of the last five releases: 8 for a signature asset
(`.asc` and similar), 10 for a provenance asset (`.intoto.jsonl`), then takes the average
rounded down. Only 0.5.4 counts (`SHA256SUMS.asc`).

Every package from 0.5.4 on already has a GitHub build attestation, but those live in
GitHub's attestation store, not among the release's files. **Verify release artifacts**
now also downloads them, checks every package against the downloaded copy, and attaches
them to the draft as `arynwood-mcp_<version>_provenance.intoto.jsonl`. Users can check a
download against it with `gh attestation verify <package> --bundle <file>`. The file uses
no new action. `slsa-github-generator`, the usual source of `.intoto.jsonl` files, was not
used: it must be referenced by tag, and Scorecard counts that reference as unpinned
(`checks/raw/pinned_dependencies.go`, `job.WorkflowCall.Uses`).

Releases up to 0.5.3 stay as published. If every release from now on is signed and carries
the provenance file, the check should read 3, 5, 7, 9 and then 10 over the next five releases.

## Review — 2026-11-01

The [published analysis](https://api.scorecard.dev/projects/github.com/Arynwood-Technology/ArynwoodMCP)
is dated November 2 (UTC), at `bafa974`, with an overall **6.7/10**. Pinning, fuzzing,
CI tests, SAST, token permissions and dangerous-workflow checks each score 10.
The Best Practices badge is now **Passing** (Scorecard gives that level 5/10).
The earlier October 25 notes below are historical.

Priorities and evidence:

- **Dependencies:** npm PR #46 and cargo PR #32 merged after successful CI,
  CodeQL and Windows runs. #32 removed `rand` 0.7/0.8/0.9 and `fxhash`, which took
  Vulnerabilities from 2/10 (8 findings) to 4/10 (6 findings). The six left are
  `glib` 0.18.5, the four unmaintained crates `proc-macro-error`, `zbus_names`,
  `zvariant` and `zvariant_derive`, and minimatch (below). CI does not compile the
  Linux desktop shell; #32 was also built for Linux in an Ubuntu 24.04 container.
  These remain upstream work. Do not suppress them.
- **Python:** the FastAPI, ddgs, jsonschema, pytest and PyInstaller PRs change
  inputs without regenerating hashed locks. Their passing tests can exercise
  old versions; FastAPI's version-consistency check catches this. The maintenance
  branch updates these inputs and locks together, adds a lock-consistency test,
  and patches certifi (2026.10.19 or newer) and setuptools (84.1.0 or newer).
  Both regenerated locks pass `pip-audit` with no known vulnerabilities.
- **Frontend audit:** 12 moderate findings trace to minimatch's
  [globparts advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) in the
  ESLint/TypeScript ESLint development tree. Its fixed 11.0.1 series is outside
  the parents' declared ranges: on November 1, no ESLint, `@eslint/eslintrc` or
  typescript-eslint release accepted minimatch 11. Do not force npm's suggested unrelated downgrade
  or substitute an incompatible major without testing the parent integrations.
- **Major updates (November 1):** #48 moved the frontend to Vite 8 with React
  plugin 6, ESLint 10, jest-dom 7, TypeScript 6.0, globals 17 and lucide-react 1.x
  together (replacing #14–16). #49 moved checkout, upload/download-artifact and
  deploy-pages to their current majors (replacing #19–22). TypeScript 7 waits for
  typescript-eslint (`<6.1.0`). jsdom 30 waits because it breaks seven tests:
  `Blob.stream` and accessible-name differences. `@types/node` 26 (#17) isn't
  adopted while CI and releases run Node 22.
- **Branch protection (4/10) and review (0/10):** retain required checks and PRs.
  Independent human review needs another maintainer; requiring an unavailable
  approver would block maintenance. Automated review is not independent human review.
- **Maintained (0/10):** still inside the first 90 days. Keep maintaining the
  project; no metadata changes to manufacture age or contributors.
- **Signed releases (1/10):** only one of five recent releases has a signed
  artifact. Preserve the checksum-signing and provenance-verification process in
  [release signing](release-signing.md); use it on future authorized releases.
  Do not rewrite old release artifacts to improve this score.
- **Packaging (-1):** registry publishing was not detected. Desktop release
  artifacts already exist; adding an unrelated registry publication just for a
  score is outside this work.

No alerts were dismissed. The public score will only reflect changes after a
new analysis; local audit results do not change the published score.

## Review — 2026-10-25

The open alerts were inspected against the public main branch. Scores change only
after another analysis; no alert was dismissed to improve the score.

- **Pinned dependencies (#34, #142, #144, #145):** Python CI/package installs now
  use `--require-hashes` and exact, transitive locks. Application/test builds
  use the cross-platform `requirements-ci.lock`; archive verification uses the
  smaller `requirements-verify.lock` so Ubuntu 22.04's GI Python 3.10 does not
  try to install application dependencies that require Python 3.11. Its initial versions match the tested repository venv.
  Regenerate with `uv pip compile requirements-ci.in --universal --python-version
  3.11 --generate-hashes --output-file requirements-ci.lock`, review the diff,
  then rerun the full suites and package checks. `uv` is local tooling; CI uses pip.
- **Branch protection (#1):** the existing public `Protect main` ruleset retains
  deletion/force-push protections and now requires PRs, resolved review threads,
  and up-to-date successful `backend`, `frontend`, `api-reference-py312` and
  `windows` checks. No bypass actors were added. Required approvals remain zero
  so the single maintainer can merge; this does not establish independent review.
- **Code review (#38):** 0 of the last 10 changesets had an approved review.
  Genuine review from another maintainer is required to change that history;
  self-approvals or invented reviewers are not a remedy.
- **Maintained (#39):** the repository was created September 10, 2026. The finding
  explicitly says it is under 90 days old. Continued maintenance and time are
  required; there is no source edit that fixes its age.
- **Fuzzing (#36):** bounded fast-check property fuzzing exercises adversarial IRC
  record keys (including prototype names) and formatting sequences in the normal
  frontend CI suite. Each property runs 2,000 cases; failures shrink and report a
  replay seed/path. Run `npm --prefix frontend test -- src/community/lib/irc-manager.fuzz.test.ts`.
- **Best practices (#40):** the external badge is InProgress. It must reflect
  verified project practices; release work does not automatically complete it.

## Vulnerabilities (#37)

The nine OSV records were fetched directly on October 25, 2026. Targeted patched
versions are `rand` 0.8.6, `serde_with` 3.21.0 and `tokio` 1.53.3, addressing affected instances of
[RUSTSEC-2026-0097](https://osv.dev/RUSTSEC-2026-0097),
[GHSA-7gcf-g7xr-8hxj](https://osv.dev/GHSA-7gcf-g7xr-8hxj), and
[RUSTSEC-2026-0386](https://osv.dev/RUSTSEC-2026-0386).

`glib` 0.18.5 remains affected by
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an
unsound iterator implementation. Tauri's Linux WebKit/GTK dependencies require
that series; the fixed 0.20 series cannot be substituted by a compatible Cargo
update. No local fork or security-suppression exception has been added.

Five remaining records report unmaintained transitive crates, rather than nine
separate demonstrated application exploits: `fxhash` (RUSTSEC-2025-0057),
`proc-macro-error` (RUSTSEC-2024-0370), `zbus_names` (RUSTSEC-2026-0371),
`zvariant` (RUSTSEC-2026-0370), and `zvariant_derive` (RUSTSEC-2026-0372).
Removing them needs compatible upstream replacements, not removal of lockfile
entries. These warnings remain visible.

A full updated-lockfile OSV rescan also finds `rand` 0.7.3 through
`phf_generator` 0.8 → `phf_codegen` 0.8 → `selectors` → `kuchikiki` → Tauri.
This is a build dependency, separate from the updated 0.8 series. Its advisory
(RUSTSEC-2026-0097 / GHSA-cq8v-f236-94qc) has no fixed 0.7 release; replacing it
requires upstream dependency changes. The rand alert is reduced, not fully cleared.
The rescan finds no remaining serde_with or tokio advisories in this lockfile.
