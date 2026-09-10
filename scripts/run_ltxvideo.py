import argparse
import os
import time

# LTX-Video (Lightricks, Apache 2.0) — the original 2B-param line, not the newer
# LTX-2 19B "dev" checkpoint, which doesn't fit in this box's 12GB even with full
# sequential offload (confirmed: that was the previous, never-working config here).
# Runs in the main project venv (pure diffusers/transformers, no isolated env
# needed like SadTalker/AnimateDiff). Weights auto-download from Hugging Face to
# the local HF cache on first run (~4-5GB, two safetensors shards). Verified
# against the installed diffusers==0.39.0: LTXPipeline/LTXImageToVideoPipeline
# import cleanly, "Lightricks/LTX-Video" has a real model_index.json
# (_class_name: LTXPipeline), and the __call__ signature matches the kwargs below.
MODEL_ID = "Lightricks/LTX-Video"


def run_ltx_video(prompt, out_dir, negative_prompt="", image_path=None,
                   num_frames=121, fps=24.0, width=768, height=512, guidance_scale=None,
                   guidance_rescale=None, num_inference_steps=None):
    import torch
    from diffusers import LTXPipeline, LTXImageToVideoPipeline
    from diffusers.utils import export_to_video

    if image_path:
        pipe = LTXImageToVideoPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    else:
        pipe = LTXPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)

    # At 2B params this comfortably fits in 12GB — whole-submodule offload
    # (moving unused submodules to CPU between steps) is enough headroom and is
    # far faster than the previous sequential (per-layer) offload the 19B model
    # needed.
    pipe.enable_model_cpu_offload()

    kwargs = dict(
        prompt=prompt,
        negative_prompt=negative_prompt or None,
        num_frames=num_frames,
        frame_rate=fps,
        width=width,
        height=height,
    )
    # Left unset -> diffusers' own default (3.0), same behavior as before this
    # was added. A conditioning image otherwise tends to dominate the
    # denoising trajectory at low CFG (confirmed directly: default guidance
    # produced a near-frozen reconstruction of the input frame on a
    # deliberately-subtle motion prompt) — callers wanting more visible
    # motion against a still image can push this up explicitly. Pushing CFG
    # up trades stillness for high-frequency flicker/warping in fine detail
    # (confirmed directly on a densely-lined image) — guidance_rescale
    # (standard technique from the "Common Diffusion Noise Schedules and
    # Sample Steps are Flawed" paper, exposed directly by this pipeline)
    # tames that without giving back all the motion.
    if guidance_scale is not None:
        kwargs["guidance_scale"] = guidance_scale
    if guidance_rescale is not None:
        kwargs["guidance_rescale"] = guidance_rescale
    if num_inference_steps is not None:
        kwargs["num_inference_steps"] = num_inference_steps
    if image_path:
        from PIL import Image
        kwargs["image"] = Image.open(image_path).convert("RGB")

    result = pipe(**kwargs)
    frames = result.frames[0]

    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, f"ltx2_{time.strftime('%Y_%m_%d_%H.%M.%S')}.mp4")
    export_to_video(frames, dest, fps=fps)
    return dest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative_prompt", default="")
    parser.add_argument("--image", default=None)
    parser.add_argument("--num_frames", type=int, default=121)
    parser.add_argument("--fps", type=float, default=24.0)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--guidance_scale", type=float, default=None)
    parser.add_argument("--guidance_rescale", type=float, default=None)
    parser.add_argument("--num_inference_steps", type=int, default=None)
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    dest = run_ltx_video(
        args.prompt, args.output_dir, args.negative_prompt, args.image,
        args.num_frames, args.fps, args.width, args.height, args.guidance_scale,
        args.guidance_rescale, args.num_inference_steps,
    )
    print(f"RESULT_PATH={dest}")
