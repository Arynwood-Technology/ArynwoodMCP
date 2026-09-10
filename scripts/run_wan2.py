import argparse
import os
import time

# Wan2.1 (Alibaba, Apache 2.0) — T2V-1.3B, the size the authors document running
# comfortably under ~8.2GB VRAM at 480p, a good fit alongside SD on this box's
# 12GB card. Runs in the main project venv (pure diffusers/transformers, no
# isolated env needed like SadTalker/AnimateDiff). Weights auto-download from
# Hugging Face to the local HF cache on first run. Verified against the
# installed diffusers==0.39.0: WanPipeline imports cleanly,
# "Wan-AI/Wan2.1-T2V-1.3B-Diffusers" has a real model_index.json
# (_class_name: WanPipeline), and the __call__ signature matches the kwargs
# below. Text-to-video only — the 1.3B checkpoint doesn't have an
# image-to-video variant (that needs the larger 14B Wan2.1-I2V line).
MODEL_ID = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"


def run_wan2(prompt, out_dir, negative_prompt="", num_frames=49, fps=16.0,
             width=832, height=480):
    import torch
    from diffusers import WanPipeline
    from diffusers.utils import export_to_video

    pipe = WanPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    # enable_model_cpu_offload() keeps one whole submodule resident on the GPU
    # at a time — fine on a spare card, but Wan2.1's umt5-xxl text encoder alone
    # is a ~5B-parameter model (~10GB in bf16), so on this box's 11.63GB card it
    # OOM'd inside the text encoder's own forward pass before the transformer or
    # VAE ever got a turn. Sequential offload moves layer-by-layer instead of
    # module-by-module, trading speed for a much lower peak — the standard fix
    # for this exact symptom on <=12GB cards.
    pipe.enable_sequential_cpu_offload()

    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt or None,
        num_frames=num_frames,
        width=width,
        height=height,
    )
    frames = result.frames[0]

    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, f"wan2_{time.strftime('%Y_%m_%d_%H.%M.%S')}.mp4")
    export_to_video(frames, dest, fps=fps)
    return dest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative_prompt", default="")
    parser.add_argument("--num_frames", type=int, default=49)
    parser.add_argument("--fps", type=float, default=16.0)
    parser.add_argument("--width", type=int, default=832)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    dest = run_wan2(
        args.prompt, args.output_dir, args.negative_prompt,
        args.num_frames, args.fps, args.width, args.height,
    )
    print(f"RESULT_PATH={dest}")
