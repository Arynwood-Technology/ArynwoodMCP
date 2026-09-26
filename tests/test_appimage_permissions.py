"""Regression: mode 0770 works for the builder but fails after a root-owned mount."""
import importlib.util
from pathlib import Path
import shutil
import subprocess

import pytest

SPEC = importlib.util.spec_from_file_location('finalize_appimage', Path(__file__).parents[1] / 'scripts/finalize_appimage.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def tree(root):
    for name in ('AppRun', 'AppRun.wrapped', 'usr/bin/arynwood', 'usr/bin/arynwood-backend'):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/sh\nexit 0\n')
        path.chmod(0o755)


def test_rejects_builder_only_launcher(tmp_path):
    tree(tmp_path)
    (tmp_path / 'AppRun.wrapped').chmod(0o770)
    with pytest.raises(RuntimeError, match='AppRun.wrapped'):
        MODULE.check_tree(tmp_path)


def test_repairs_archive_not_just_staging_directory(tmp_path):
    if not all(shutil.which(tool) for tool in ('mksquashfs', 'unsquashfs')):
        pytest.skip('squashfs-tools required')
    root = tmp_path / 'source'
    tree(root)
    (root / 'AppRun.wrapped').chmod(0o770)
    payload = tmp_path / 'payload'
    subprocess.run(['mksquashfs', str(root), str(payload), '-noappend', '-no-progress'], check=True)
    # Minimal executable runtime implementing the offset interface used by the finalizer.
    runtime = b'#!/bin/sh\necho 4096\nexit 0\n'
    image = tmp_path / 'test.AppImage'
    image.write_bytes(runtime.ljust(4096, b'\0') + payload.read_bytes())
    image.chmod(0o755)
    MODULE.finalize(image)
    extracted = tmp_path / 'extracted'
    subprocess.run(['unsquashfs', '-o', '4096', '-d', str(extracted), str(image)], check=True)
    MODULE.check_tree(extracted)
    assert (extracted / 'AppRun.wrapped').stat().st_mode & 0o777 == 0o755
    assert image.read_bytes()[:4096] == runtime.ljust(4096, b'\0')
