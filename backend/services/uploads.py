"""Size caps for uploads the backend reads before handing them to a sidecar.

Starlette spools an upload to a temporary file; `await upload.read()` then loads all of it into
memory at once, whatever its size. These stop one byte past the limit instead.
"""
import os

from fastapi import HTTPException, UploadFile

MB = 1024 * 1024
AUDIO_MAX_BYTES = 512 * MB    # about 50 minutes of 16-bit 44.1 kHz stereo WAV
MODEL_MAX_BYTES = 1024 * MB   # an RVC voice model's .pth or .index


def _too_big(upload: UploadFile, limit: int) -> HTTPException:
    return HTTPException(413, f"{upload.filename or 'That file'} is over {limit // MB} MB, the most this accepts.")


async def read_capped(upload: UploadFile, limit: int | None = None) -> bytes:
    """The upload's bytes, or a 413 once it passes `limit` (AUDIO_MAX_BYTES unless given); never more
    than limit + 1 bytes in memory."""
    limit = limit or AUDIO_MAX_BYTES
    if upload.size is not None and upload.size > limit:
        raise _too_big(upload, limit)
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise _too_big(upload, limit)
    return data


async def save_capped(upload: UploadFile, path, limit: int | None = None) -> None:
    """Copy the upload to `path` a megabyte at a time; past `limit` (MODEL_MAX_BYTES unless given),
    remove what was written and 413."""
    limit = limit or MODEL_MAX_BYTES
    if upload.size is not None and upload.size > limit:
        raise _too_big(upload, limit)
    written = 0
    try:
        with open(path, "wb") as out:
            while piece := await upload.read(MB):
                written += len(piece)
                if written > limit:
                    raise _too_big(upload, limit)
                out.write(piece)
    except BaseException:
        if os.path.exists(path):
            os.remove(path)
        raise
