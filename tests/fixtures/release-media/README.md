# Release media fixtures

Two-second synthetic clips for `scripts/check_webkit_media.py`: a 440 Hz tone
encoded as MP3, and a blue 160×120 H.264 video with an AAC tone. No recordings or
personal media. Generated locally with ffmpeg from `sine` and `color` sources.
The verification workflow generates its WAV fixture using the Python standard library.

These files let the artifact verifier test the bundled codecs without installing ffmpeg.
