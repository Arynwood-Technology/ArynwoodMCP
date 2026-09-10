import argparse
import os
import re
import tempfile
import time

# Chatterbox TTS (Resemble AI, Apache 2.0) — zero-shot voice cloning from a short
# reference clip. Runs in a dedicated venv (see tools.py's _CHATTERBOX_PYTHON):
# chatterbox-tts pins torch==2.6.0 and transformers==5.2.0, which conflict with
# the main project venv's torch 2.12 and the transformers<5 pin Wan2.1/LTX-Video
# need. Weights auto-download from Hugging Face ("ResembleAI/chatterbox") to the
# local HF cache on first run.

# ChatterboxTTS.generate() hardcodes max_new_tokens=1000 per call with no way to
# override it (confirmed from source) — roughly 20-40s of audio. Feeding it a
# full podcast script in one call runs the model past that ceiling with no
# natural stop point, which is what was actually causing CUDA "device-side
# assert" crashes on real scripts (confirmed: a ~2000-word script failed
# reliably; nothing under a few hundred characters ever did, across 12+ runs).
# Chunk well under that ceiling and generate+stitch each piece separately.
_MAX_CHUNK_CHARS = 300

# ChatterboxTTS.prepare_conditionals() only ever reads the first 10s (S3Gen
# timbre ref) / 6s (T3 prompt tokens) of the reference file — DEC_COND_LEN /
# ENC_COND_LEN in chatterbox/tts.py. A longer file isn't a richer clone, it's
# just wasted librosa resampling (observed: a 13-minute reference cost real
# time for no benefit, since everything past ~10s is discarded anyway).
_MAX_REFERENCE_SECONDS = 15.0


def _trim_reference(path, max_seconds=_MAX_REFERENCE_SECONDS):
    import soundfile as sf

    info = sf.info(path)
    if info.frames / info.samplerate <= max_seconds:
        return path
    data, sr = sf.read(path, frames=int(max_seconds * info.samplerate))
    trimmed = os.path.join(tempfile.mkdtemp(), "reference_trimmed.wav")
    sf.write(trimmed, data, sr)
    return trimmed


def _split_into_chunks(text, max_chars=_MAX_CHUNK_CHARS):
    sentences = []
    for paragraph in (p.strip() for p in text.split("\n")):
        if paragraph:
            # \s* (not \s+): pasted scripts routinely have sentences with no
            # space after the period at all ("Yours.Alright.") — \s+ silently
            # refuses to split those, letting a whole run-on paragraph through
            # as one "sentence" and defeating the max_chars cap below.
            sentences += re.split(r"(?<=[.!?])\s*", paragraph)

    chunks, current = [], ""
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        # Belt-and-suspenders: even after the split above, a stretch with no
        # sentence-ending punctuation at all could still exceed max_chars.
        # Force-break it on whitespace so nothing ever reaches generate()
        # over budget — that's what was crashing it in the first place.
        while len(sentence) > max_chars:
            cut = sentence.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            piece, sentence = sentence[:cut].strip(), sentence[cut:].strip()
            if current:
                chunks.append(current)
                current = ""
            chunks.append(piece)
        if current and len(current) + len(sentence) + 1 > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks or [text]


def run_chatterbox(text, out_dir, reference_audio=None, exaggeration=0.5, cfg_weight=0.5):
    import torch
    import torchaudio
    from chatterbox.tts import ChatterboxTTS

    if reference_audio:
        reference_audio = _trim_reference(reference_audio)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)

    # Prepare the voice conditioning once up front rather than letting
    # generate() redo it on every chunk (its default behavior when passed
    # audio_prompt_path each call) — same reference clip, no reason to
    # re-embed it dozens of times for one script.
    if reference_audio:
        model.prepare_conditionals(reference_audio, exaggeration=exaggeration)

    gap = torch.zeros(1, int(0.4 * model.sr))
    pieces = []
    for i, chunk in enumerate(_split_into_chunks(text)):
        if i > 0:
            pieces.append(gap)
        pieces.append(model.generate(chunk, exaggeration=exaggeration, cfg_weight=cfg_weight))
    wav = torch.cat(pieces, dim=1)

    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, f"chatterbox_{time.strftime('%Y_%m_%d_%H.%M.%S')}.wav")
    torchaudio.save(dest, wav, model.sr)
    return dest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text_file", required=True, help="Path to a UTF-8 text file with the script to synthesize")
    parser.add_argument("--reference_audio", default=None, help="Optional voice clip to clone")
    parser.add_argument("--exaggeration", type=float, default=0.5)
    parser.add_argument("--cfg_weight", type=float, default=0.5)
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    with open(args.text_file, "r", encoding="utf-8") as f:
        text = f.read()

    dest = run_chatterbox(
        text, args.output_dir, args.reference_audio, args.exaggeration, args.cfg_weight,
    )
    print(f"RESULT_PATH={dest}")
