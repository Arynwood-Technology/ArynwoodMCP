import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time

# Real checkout + its own venv (pinned torch 2.3.1 / diffusers 0.11.1 / xformers
# 0.0.27 — deliberately isolated from the main project venv, whose torch version
# is far newer and would conflict) — lives outside the project on this machine.
ANIMATEDIFF_DIR = "/home/lorelei/tools/AnimateDiff"
ANIMATEDIFF_PYTHON = os.path.join(ANIMATEDIFF_DIR, "venv", "bin", "python")

DEFAULT_NEGATIVE = (
    "worst quality, low quality, jpeg artifacts, blurry, deformed, disfigured, "
    "bad anatomy, extra limbs, watermark, text"
)


def run_animatediff(prompt, out_dir, negative_prompt=DEFAULT_NEGATIVE, steps=25,
                     frames=16, width=512, height=512, seed=-1, guidance_scale=8.0):
    # animate.py's config format is YAML, but valid JSON is valid YAML — this
    # avoids needing PyYAML in whichever plain python3 runs this dispatcher.
    config = [{
        "inference_config": "configs/inference/inference-v2.yaml",
        "motion_module": "models/Motion_Module/mm_sd_v15_v2.ckpt",
        "dreambooth_path": "",
        "lora_model_path": "",
        "seed": [seed],
        "steps": steps,
        "guidance_scale": guidance_scale,
        "prompt": [prompt],
        "n_prompt": [negative_prompt or DEFAULT_NEGATIVE],
    }]

    fd, config_path = tempfile.mkstemp(suffix=".yaml")
    with os.fdopen(fd, "w") as f:
        json.dump(config, f)

    try:
        subprocess.run(
            [
                # Must run as "-m scripts.animate" (not a direct file path) — the
                # repo's own animatediff/ package is only importable when the
                # repo root is on sys.path, which -m gives you and a bare
                # script invocation does not.
                ANIMATEDIFF_PYTHON, "-m", "scripts.animate",
                "--config", config_path,
                # runwayml/stable-diffusion-v1-5 returns 401 (RunwayML deleted their
                # HF repos in 2024) — this is the actively-maintained successor org's
                # copy of the same weights.
                "--pretrained-model-path", "stable-diffusion-v1-5/stable-diffusion-v1-5",
                "--L", str(frames), "--W", str(width), "--H", str(height),
            ],
            cwd=ANIMATEDIFF_DIR, check=True,
        )
    finally:
        os.unlink(config_path)

    # animate.py writes samples/<config-stem>-<timestamp>/sample.gif relative
    # to cwd — scan for the newest one rather than trying to reconstruct its
    # internally-generated timestamp/stem.
    samples_root = os.path.join(ANIMATEDIFF_DIR, "samples")
    candidates = []
    if os.path.isdir(samples_root):
        for d in os.listdir(samples_root):
            p = os.path.join(samples_root, d, "sample.gif")
            if os.path.exists(p):
                candidates.append(p)
    if not candidates:
        raise RuntimeError("AnimateDiff finished but no sample.gif was found")
    newest = max(candidates, key=os.path.getmtime)

    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, f"animatediff_{time.strftime('%Y_%m_%d_%H.%M.%S')}.gif")
    tmp_dest = dest + ".tmp"
    shutil.copy2(newest, tmp_dest)
    os.replace(tmp_dest, dest)
    return dest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative_prompt", default=DEFAULT_NEGATIVE)
    parser.add_argument("--steps", type=int, default=25)
    parser.add_argument("--frames", type=int, default=16)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--output_dir", default="triggers/gpu_watch/animatediff_output")
    args = parser.parse_args()

    dest = run_animatediff(
        args.prompt, args.output_dir, args.negative_prompt,
        args.steps, args.frames, args.width, args.height, args.seed,
    )
    print(f"RESULT_PATH={dest}")
