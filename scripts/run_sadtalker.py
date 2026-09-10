import argparse
import os
import subprocess

# Real checkout + its conda env (torch+CUDA already installed there) — the
# repo has no bundled SadTalker; it lives outside the project on this machine.
SADTALKER_DIR = "/home/lorelei/tools/sad-talker"
SADTALKER_PYTHON = "/home/lorelei/miniconda3/envs/sadtalker/bin/python"


def run_sadtalker(img_path, audio_path, out_dir, pose_style=0, expression_scale=1.0):
    cmd = [
        SADTALKER_PYTHON, "inference.py",
        "--driven_audio", os.path.abspath(audio_path),
        "--source_image", os.path.abspath(img_path),
        "--enhancer", "gfpgan",
        "--result_dir", os.path.abspath(out_dir),
        "--still",
        "--preprocess", "full",
        "--pose_style", str(pose_style),
        "--expression_scale", str(expression_scale),
    ]
    subprocess.run(cmd, cwd=SADTALKER_DIR, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("audio")
    parser.add_argument("--output_dir", default="triggers/gpu_watch/stable_output/sadtalker")
    parser.add_argument("--pose_style", type=int, default=0)
    parser.add_argument("--expression_scale", type=float, default=1.0)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    run_sadtalker(args.image, args.audio, args.output_dir, args.pose_style, args.expression_scale)
