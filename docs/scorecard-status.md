# Scorecard follow-up — 2026-10-25

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
