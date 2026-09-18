"""scripts/push-guard.py (run by .githooks/pre-push) must stop personal content reaching a public
remote, and must fail CLOSED. These tests use throwaway repos and a throwaway denylist — the real
private terms are never in this repo."""
import os
import subprocess
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "scripts" / "push-guard.py"
HOOKS = ROOT / ".githooks"
ZERO = "0" * 40


def sh(*cmd, cwd, env=None, stdin=None):
    return subprocess.run(list(cmd), cwd=cwd, env=env, input=stdin, capture_output=True, text=True)


@pytest.fixture()
def world(tmp_path):
    """A repo, a private dir (denylist + private-remote marker), and an env pointing at it."""
    private = tmp_path / "private"
    private.mkdir()
    (private / "push-denylist.txt").write_text("# test terms\n\\bsecretword\\b\n")
    (private / "private-remotes.txt").write_text("private.example\n")
    (private / "forbidden-paths.txt").write_text("^secretdir/\n")
    repo = tmp_path / "repo"
    repo.mkdir()
    env = {**os.environ, "ARYNWOOD_PRIVATE_DIR": str(private), "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    sh("git", "init", "-q", "-b", "main", cwd=repo, env=env)
    return repo, private, env


def commit(repo, env, files: dict, message="change"):
    for rel, content in files.items():
        path = repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    sh("git", "add", "-A", cwd=repo, env=env)
    sh("git", "commit", "-q", "-m", message, cwd=repo, env=env)
    return sh("git", "rev-parse", "HEAD", cwd=repo, env=env).stdout.strip()


def guard(repo, env, *args, stdin=None):
    return sh("python3", str(GUARD), *args, cwd=repo, env=env, stdin=stdin)


def hook_input(sha, remote_ref="refs/heads/main", remote_sha=ZERO):
    return f"refs/heads/main {sha} {remote_ref} {remote_sha}\n"


def test_clean_history_passes(world):
    repo, _, env = world
    commit(repo, env, {"a.txt": "hello world\n"})
    assert guard(repo, env, "--range", "HEAD").returncode == 0


def test_added_line_matching_the_denylist_is_refused_and_located(world):
    repo, _, env = world
    commit(repo, env, {"notes/a.md": "fine\nthis has a SecretWord in it\n"})
    r = guard(repo, env, "--range", "HEAD")
    assert r.returncode == 1 and "notes/a.md" in r.stderr


def test_commit_message_is_scanned_too(world):
    repo, _, env = world
    commit(repo, env, {"a.txt": "x\n"}, message="add the secretword feature")
    assert guard(repo, env, "--range", "HEAD").returncode == 1


@pytest.mark.parametrize("path", ["secretdir/train.py", "personas.local.json", "config/x.db", "mcp/config/mcp_servers.json"])
def test_forbidden_paths_are_refused(world, path):
    repo, _, env = world
    commit(repo, env, {path: "harmless content\n"})
    r = guard(repo, env, "--range", "HEAD")
    assert r.returncode == 1 and "forbidden path" in r.stderr


def test_removing_the_line_in_a_later_commit_does_not_hide_it(world):
    repo, _, env = world
    commit(repo, env, {"a.txt": "secretword\n"})
    commit(repo, env, {"a.txt": "cleaned\n"}, message="oops, remove it")
    assert guard(repo, env, "--range", "HEAD").returncode == 1        # it is still in history


def test_staged_diff_mode(world):
    repo, _, env = world
    base = commit(repo, env, {"a.txt": "ok\n"})
    (repo / "b.txt").write_text("secretword\n")
    sh("git", "add", "b.txt", cwd=repo, env=env)
    assert guard(repo, env, "--staged-against", base).returncode == 1


def test_fails_closed_when_the_private_dir_is_missing(world, tmp_path):
    repo, _, env = world
    commit(repo, env, {"a.txt": "ok\n"})
    env = {**env, "ARYNWOOD_PRIVATE_DIR": str(tmp_path / "gone")}
    r = guard(repo, env, "--range", "HEAD")
    assert r.returncode != 0 and "fail closed" in r.stderr


# ── the pre-push contract ────────────────────────────────────────────────────────


def test_hook_refuses_bad_content_to_a_public_remote(world):
    repo, _, env = world
    sha = commit(repo, env, {"a.txt": "secretword\n"})
    r = guard(repo, env, "--hook", "origin", "https://github.com/acme/public.git", stdin=hook_input(sha))
    assert r.returncode == 1


def test_hook_allows_clean_content_to_a_public_remote(world):
    repo, _, env = world
    sha = commit(repo, env, {"a.txt": "fine\n"})
    assert guard(repo, env, "--hook", "origin", "https://github.com/acme/public.git", stdin=hook_input(sha)).returncode == 0


def test_hook_does_not_scan_a_known_private_remote(world):
    repo, _, env = world
    sha = commit(repo, env, {"a.txt": "secretword\n"})
    assert guard(repo, env, "--hook", "backup", "git@private.example:me/repo.git", stdin=hook_input(sha)).returncode == 0


def test_hook_only_lets_main_and_version_tags_reach_a_public_remote(world):
    repo, _, env = world
    sha = commit(repo, env, {"a.txt": "fine\n"})
    url = "https://github.com/acme/public.git"
    assert guard(repo, env, "--hook", "origin", url, stdin=hook_input(sha, "refs/heads/archive/old")).returncode == 1
    assert guard(repo, env, "--hook", "origin", url, stdin=hook_input(sha, "refs/tags/v1.2.3")).returncode == 0


def test_hook_ignores_deletes(world):
    repo, _, env = world
    commit(repo, env, {"a.txt": "fine\n"})
    assert guard(repo, env, "--hook", "origin", "https://x/y.git", stdin=f"(delete) {ZERO} refs/heads/old {'a' * 40}\n").returncode == 0


def test_hook_only_scans_commits_the_remote_does_not_have(world):
    repo, _, env = world
    old = commit(repo, env, {"a.txt": "secretword\n"})              # already "on the remote"
    new = commit(repo, env, {"b.txt": "fine\n"})
    r = guard(repo, env, "--hook", "origin", "https://x/y.git", stdin=hook_input(new, remote_sha=old))
    assert r.returncode == 0


def test_a_real_git_push_is_stopped_by_the_versioned_hook(world, tmp_path):
    """End to end: git itself runs .githooks/pre-push on a real push."""
    repo, _, env = world
    remote = tmp_path / "public.git"
    sh("git", "init", "-q", "--bare", "-b", "main", str(remote), cwd=tmp_path, env=env)
    sh("git", "remote", "add", "origin", str(remote), cwd=repo, env=env)
    sh("git", "config", "core.hooksPath", str(HOOKS), cwd=repo, env=env)
    commit(repo, env, {"a.txt": "secretword\n"})
    blocked = sh("git", "push", "origin", "main", cwd=repo, env=env)
    assert blocked.returncode != 0 and "REFUSING" in blocked.stderr
    assert sh("git", "rev-parse", "--verify", "-q", "refs/heads/main", cwd=remote, env=env).returncode != 0
    (repo / "a.txt").write_text("clean\n")
    sh("git", "commit", "-qam", "clean it", cwd=repo, env=env)
    still_blocked = sh("git", "push", "origin", "main", cwd=repo, env=env)    # history still contains it
    assert still_blocked.returncode != 0
    ok_repo = tmp_path / "ok"
    ok_repo.mkdir()
    sh("git", "init", "-q", "-b", "main", cwd=ok_repo, env=env)
    sh("git", "remote", "add", "origin", str(remote), cwd=ok_repo, env=env)
    sh("git", "config", "core.hooksPath", str(HOOKS), cwd=ok_repo, env=env)
    commit(ok_repo, env, {"a.txt": "clean from the start\n"})
    assert sh("git", "push", "origin", "main", cwd=ok_repo, env=env).returncode == 0
