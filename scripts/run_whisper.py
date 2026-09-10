import argparse
import os
import subprocess

# openai-whisper lives in its own venv (not pip-installed in the main project
# venv) since it pulls in its own torch/numba stack independent of the backend.
WHISPER_BIN = "/home/lorelei/tools/whisper-venv/bin/whisper"


def run_whisper(audio_path, out_dir, model_name="base"):
    os.makedirs(out_dir, exist_ok=True)
    subprocess.run(
        [WHISPER_BIN, audio_path, "--model", model_name,
         "--output_format", "json", "--output_dir", out_dir],
        check=True,
    )
    base = os.path.splitext(os.path.basename(audio_path))[0]
    result_path = os.path.join(out_dir, f"{base}.json")
    if not os.path.exists(result_path):
        raise RuntimeError("Whisper finished but no output JSON was found")
    return result_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--model", default="base")
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    result_path = run_whisper(args.audio, args.output_dir, args.model)
    print(f"RESULT_PATH={result_path}")
