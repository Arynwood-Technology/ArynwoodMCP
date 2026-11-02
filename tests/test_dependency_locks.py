"""CI must install versions satisfying the reviewed dependency inputs."""
from pathlib import Path
import re

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
import pytest

ROOT = Path(__file__).resolve().parents[1]


def requirements(path):
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line.startswith("-r "):
            yield from requirements(path.parent / line[3:].strip())
        elif line:
            yield Requirement(line)


@pytest.mark.parametrize("name", ["requirements-ci", "requirements-verify"])
def test_lock_satisfies_inputs(name):
    locked = {}
    for line in (ROOT / f"{name}.lock").read_text().splitlines():
        match = re.match(r"^([\w.-]+)==([^\s;\\]+)", line)
        if match:
            locked.setdefault(canonicalize_name(match[1]), []).append(match[2])
    for requirement in requirements(ROOT / f"{name}.in"):
        versions = locked.get(canonicalize_name(requirement.name), [])
        assert versions and all(requirement.specifier.contains(v) for v in versions), (
            f"{name}.lock does not satisfy {requirement}: {versions}; regenerate the hashed lock"
        )
