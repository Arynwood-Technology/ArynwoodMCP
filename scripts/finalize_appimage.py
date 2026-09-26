#!/usr/bin/env python3
"""Repair launcher permissions in an unsigned Tauri AppImage, then verify the archive.

Run after bundling, before checksums/upload. Requires squashfs-tools. Preserves the
AppImage runtime and replaces its SquashFS payload; never use on signed images.
"""
import argparse
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile


def check_tree(root):
    for name in ('AppRun', 'AppRun.wrapped', 'usr/bin/arynwood-mcp', 'usr/bin/arynwood-backend'):
        path = root / name
        if not path.is_file() or stat.S_IMODE(path.stat().st_mode) & 0o555 != 0o555:
            raise RuntimeError(f'{name} must be readable and executable by every user')


def finalize(image):
    image = image.resolve()
    offset = int(subprocess.check_output([str(image), '--appimage-offset'], text=True))
    with tempfile.TemporaryDirectory(prefix='arynwood-appimage-') as tmp:
        tmp = Path(tmp)
        root = tmp / 'AppDir'
        subprocess.run(['unsquashfs', '-no-progress', '-o', str(offset), '-d', str(root), str(image)], check=True)
        for name in ('AppRun', 'AppRun.wrapped'):
            (root / name).chmod(0o755)
        check_tree(root)
        payload = tmp / 'payload.squashfs'
        subprocess.run(['mksquashfs', str(root), str(payload), '-noappend', '-all-root', '-no-progress', '-comp', 'gzip'], check=True)
        # Build beside the destination so replacement is atomic, even across filesystems.
        fd, staged = tempfile.mkstemp(prefix=image.name + '.', dir=image.parent)
        try:
            with os.fdopen(fd, 'wb') as out, image.open('rb') as source, payload.open('rb') as squash:
                runtime = source.read(offset)
                if len(runtime) != offset:
                    raise RuntimeError('Truncated AppImage runtime')
                out.write(runtime)
                shutil.copyfileobj(squash, out)
            Path(staged).chmod(0o755)
            verified = tmp / 'verified'
            subprocess.run(['unsquashfs', '-no-progress', '-o', str(offset), '-d', str(verified), staged], check=True)
            check_tree(verified)
            os.replace(staged, image)
        finally:
            Path(staged).unlink(missing_ok=True)
    print(f'Verified launcher permissions: {image}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('images', nargs='+', type=Path)
    for image in parser.parse_args().images:
        finalize(image)
