"""
Prepares a kohya_ss-compatible LoRA training folder from a flat folder of art
(PNG/JPG/WEBP in, PNG always out).

Output layout (kohya_ss "n_repeats_trigger" convention):
    <output_root>/<repeats>_<trigger_word>/
        image1.png  image1.txt
        image2.png  image2.txt
        ...

Captioning uses kohya_ss's own bundled WD14 tagger
(sd-scripts/finetune/tag_images_by_wd14_tagger.py), run via kohya_ss's own venv
so this script and the main arynwood-mcp venv never need torch/onnxruntime.
WD14 was chosen over BLIP because: it already ships inside kohya_ss (zero new
deps to install), runs on ONNX Runtime (small model, ~1-2GB VRAM or CPU-only),
and produces comma-separated tags -- the standard "trigger_word, tag1, tag2"
caption format most kohya_ss LoRA guides expect. BLIP would need its own
torch/transformers install and produces sentence-style captions that don't
compose as cleanly with a single trigger word.

Bucketing: images are only ever downscaled (never upscaled or cropped) so
their longest side fits --resolution, preserving exact aspect ratio. kohya_ss
handles the actual bucket-resolution snapping itself at training time via
--enable_bucket, so this script doesn't need to replicate that logic.
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

KOHYA_SS_DIR = Path(  # same lookup as backend/external_paths.py; this script runs standalone
    os.environ.get("ARYNWOOD_KOHYA_DIR")
    or os.path.join(os.environ.get("ARYNWOOD_TOOLS_DIR") or os.path.expanduser("~/tools"), "kohya_ss"))
KOHYA_PYTHON = KOHYA_SS_DIR / "venv" / "bin" / "python"
WD14_SCRIPT = KOHYA_SS_DIR / "sd-scripts" / "finetune" / "tag_images_by_wd14_tagger.py"
WD14_MODEL_DIR = KOHYA_SS_DIR / "wd14_tagger_model"
DEFAULT_WD14_REPO = "SmilingWolf/wd-v1-4-convnext-tagger-v2"


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def load_config(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return json.loads(path.read_text())
    if suffix in (".yml", ".yaml"):
        try:
            import yaml
        except ImportError:
            raise SystemExit(
                f"Config file {path} is YAML but PyYAML isn't installed. "
                "Install it (`pip install pyyaml`) or use a .json config instead."
            )
        return yaml.safe_load(path.read_text())
    raise SystemExit(f"Unsupported config file extension '{suffix}' (use .json, .yaml, or .yml)")


SOURCE_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def gather_images(source_dir: Path) -> list[Path]:
    return sorted(p for p in source_dir.iterdir() if p.is_file() and p.suffix.lower() in SOURCE_EXTS)


def plan_targets(images: list[Path]) -> tuple[dict[Path, str], list[str]]:
    """Map each source image to a target basename, deduping case-insensitive collisions."""
    groups: dict[str, list[Path]] = {}
    for img in images:
        key = img.stem.lower() + ".png"
        groups.setdefault(key, []).append(img)

    mapping: dict[Path, str] = {}
    warnings = []
    for key, group in groups.items():
        if len(group) > 1:
            names = ", ".join(p.name for p in group)
            warnings.append(f"{len(group)} source files collide on target name '{key}' ({names}) -- auto-suffixed")
        for i, img in enumerate(sorted(group)):
            mapping[img] = key if i == 0 else f"{img.stem}_dup{i + 1}.png"
    return mapping, warnings


def compute_target_size(w: int, h: int, long_edge: int) -> tuple[int, int]:
    if max(w, h) <= long_edge:
        return w, h
    scale = long_edge / max(w, h)
    return max(1, round(w * scale)), max(1, round(h * scale))


def process_image(src: Path, dest: Path, long_edge: int, bg_color: str, dry_run: bool) -> dict:
    with Image.open(src) as im:
        orig_w, orig_h = im.size
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        target_w, target_h = compute_target_size(orig_w, orig_h, long_edge)
        needs_resize = (target_w, target_h) != (orig_w, orig_h)
        info = {
            "orig_size": (orig_w, orig_h),
            "target_size": (target_w, target_h),
            "needs_resize": needs_resize,
            "has_alpha": has_alpha,
            "short_side": min(orig_w, orig_h),
        }
        if dry_run:
            return info

        if has_alpha:
            rgba = im.convert("RGBA")
            out = Image.new("RGB", rgba.size, bg_color)
            out.paste(rgba, mask=rgba.split()[-1])
        else:
            out = im.convert("RGB")

        if needs_resize:
            out = out.resize((target_w, target_h), Image.Resampling.LANCZOS)

        if needs_resize or has_alpha:
            out.save(dest, "PNG", optimize=True)
        else:
            shutil.copy2(src, dest)
    return info


def classify_captions(
    target_dir: Path, basenames: list[str], caption_extension: str, force_recaption: bool
) -> tuple[list[str], list[str]]:
    """Returns (basenames needing a caption, basenames with a caption already kept)."""
    need, existing = [], []
    for base in basenames:
        txt_path = target_dir / (Path(base).stem + caption_extension)
        if txt_path.exists() and not force_recaption:
            existing.append(base)
        else:
            need.append(base)
    return need, existing


def stage_and_tag(
    target_dir: Path,
    basenames: list[str],
    trigger_word: str,
    *,
    caption_extension: str,
    force_recaption: bool,
    skip_captioning: bool,
    wd14_repo_id: str,
    wd14_batch_size: int,
    wd14_thresh: float,
    wd14_undesired_tags: str,
    device: str,
) -> tuple[int, int]:
    need, existing = classify_captions(target_dir, basenames, caption_extension, force_recaption)
    skipped = len(existing)
    if not need:
        return 0, skipped
    if skip_captioning:
        return 0, skipped + len(need)

    if not KOHYA_PYTHON.exists() or not WD14_SCRIPT.exists():
        raise RuntimeError(
            f"WD14 tagger not found (expected venv at {KOHYA_PYTHON}, script at {WD14_SCRIPT}). "
            "Has kohya_ss's setup.sh finished running?"
        )

    staging = Path(tempfile.mkdtemp(prefix="lora_wd14_"))
    try:
        for base in need:
            (staging / base).symlink_to((target_dir / base).resolve())

        cmd = [
            str(KOHYA_PYTHON), str(WD14_SCRIPT),
            "--onnx",
            "--repo_id", wd14_repo_id,
            "--model_dir", str(WD14_MODEL_DIR),
            "--batch_size", str(wd14_batch_size),
            "--thresh", str(wd14_thresh),
            "--caption_extension", caption_extension,
        ]
        if wd14_undesired_tags:
            cmd += ["--undesired_tags", wd14_undesired_tags]
        cmd.append(str(staging))

        env = os.environ.copy()
        if device == "cpu":
            env["CUDA_VISIBLE_DEVICES"] = ""

        subprocess.run(cmd, check=True, env=env)

        generated = 0
        for base in need:
            src_txt = staging / (Path(base).stem + caption_extension)
            if src_txt.exists():
                # The tagger's --always_first_tags only reorders tags it already
                # predicted; it can't inject an arbitrary trigger word the model
                # has never seen. So prepend it ourselves.
                tags = src_txt.read_text().strip()
                content = f"{trigger_word}, {tags}" if tags else trigger_word
                (target_dir / src_txt.name).write_text(content)
                generated += 1
            else:
                skipped += 1
        return generated, skipped
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="Folder of flattened artwork to prepare (PNG/JPG/WEBP)")
    parser.add_argument("--config", help="Optional JSON/YAML config file; CLI flags override its values")
    parser.add_argument("--trigger-word", dest="trigger_word", default=None)
    parser.add_argument("--repeats", type=int, default=None, help="kohya_ss repeat count, e.g. 10")
    parser.add_argument("--output-root", dest="output_root", default=None,
                         help="Parent dir for <repeats>_<trigger_word>/ "
                              "(default: kohya_ss/dataset/images/<trigger_word>/)")
    parser.add_argument("--resolution", type=int, default=None, help="Target long edge in px (default: 1024)")
    parser.add_argument("--min-short-side", dest="min_short_side", type=int, default=None,
                         help="Warn if an image's shortest side is below this (default: 768)")
    parser.add_argument("--background-color", dest="background_color", default=None,
                         help="Flatten color for images with alpha (default: white)")
    parser.add_argument("--wd14-repo-id", dest="wd14_repo_id", default=None,
                         help=f"HF repo id for the WD14 tagger model (default: {DEFAULT_WD14_REPO})")
    parser.add_argument("--wd14-thresh", dest="wd14_thresh", type=float, default=None,
                         help="Tag confidence threshold (default: 0.35)")
    parser.add_argument("--wd14-batch-size", dest="wd14_batch_size", type=int, default=None,
                         help="Tagger inference batch size (default: 4)")
    parser.add_argument("--wd14-undesired-tags", dest="wd14_undesired_tags", default=None,
                         help="Comma-separated tags to exclude from captions")
    parser.add_argument("--caption-extension", dest="caption_extension", default=None,
                         help="Caption file extension (default: .txt)")
    parser.add_argument("--device", choices=["cpu", "cuda"], default=None,
                         help="Where the WD14 tagger runs (default: cpu, to leave VRAM free for other GPU work)")
    parser.add_argument("--skip-captioning", action="store_true", help="Only copy/resize images, generate no captions")
    parser.add_argument("--force-recaption", action="store_true",
                         help="Regenerate captions even if a .txt already exists (off by default)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without writing anything")
    return parser


def main():
    parser = build_arg_parser()
    args = parser.parse_args()

    config = {}
    if args.config:
        config = load_config(Path(args.config).expanduser())

    def resolve(cli_val, key, default=None):
        return cli_val if cli_val is not None else config.get(key, default)

    trigger_word = resolve(args.trigger_word, "trigger_word")
    repeats = resolve(args.repeats, "repeats")
    if not trigger_word:
        parser.error("--trigger-word is required (via CLI flag or config file)")
    if not repeats:
        parser.error("--repeats is required (via CLI flag or config file)")
    repeats = int(repeats)

    resolution = int(resolve(args.resolution, "resolution", 1024))
    min_short_side = int(resolve(args.min_short_side, "min_short_side", 768))
    background_color = resolve(args.background_color, "background_color", "white")
    wd14_repo_id = resolve(args.wd14_repo_id, "wd14_repo_id", DEFAULT_WD14_REPO)
    wd14_thresh = float(resolve(args.wd14_thresh, "wd14_thresh", 0.35))
    wd14_batch_size = int(resolve(args.wd14_batch_size, "wd14_batch_size", 4))
    wd14_undesired_tags = resolve(args.wd14_undesired_tags, "wd14_undesired_tags", "")
    caption_extension = resolve(args.caption_extension, "caption_extension", ".txt")
    device = resolve(args.device, "device", "cpu")

    skip_captioning = args.skip_captioning or bool(config.get("skip_captioning", False))
    force_recaption = args.force_recaption or bool(config.get("force_recaption", False))
    dry_run = args.dry_run or bool(config.get("dry_run", False))

    output_root = resolve(args.output_root, "output_root")
    output_root = Path(output_root).expanduser() if output_root else KOHYA_SS_DIR / "dataset" / "images" / trigger_word
    target_dir = output_root / f"{repeats}_{trigger_word}"

    source_dir = Path(args.source).expanduser()
    if not source_dir.is_dir():
        parser.error(f"Source folder does not exist: {source_dir}")

    images = gather_images(source_dir)
    if not images:
        print(f"No supported images ({', '.join(SOURCE_EXTS)}) found in {source_dir}")
        return

    mapping, dup_warnings = plan_targets(images)

    print(f"Source folder: {source_dir}")
    print(f"Found {len(images)} image(s)")
    print(f"Output folder: {target_dir}")
    print()

    for w in dup_warnings:
        print(f"WARNING: {w}")

    too_small = []
    total_src_bytes = 0
    plans = {}
    for img in images:
        total_src_bytes += img.stat().st_size
        dest_path = target_dir / mapping[img]
        info = process_image(img, dest_path, resolution, background_color, dry_run=True)
        plans[img] = (dest_path, info)
        if info["short_side"] < min_short_side:
            too_small.append((img, info["orig_size"]))

    for img, size in too_small:
        print(f"WARNING: {img.name} is below {min_short_side}px on its shortest side (actual: {size[0]}x{size[1]})")

    resized_count = sum(1 for _, info in plans.values() if info["needs_resize"])
    alpha_count = sum(1 for _, info in plans.values() if info["has_alpha"])
    need, existing = classify_captions(target_dir, list(mapping.values()), caption_extension, force_recaption)

    print()
    print(f"{resized_count} image(s) will be resized to fit {resolution}px (aspect ratio preserved, no cropping)")
    print(f"{alpha_count} image(s) have alpha and will be flattened onto a {background_color} background")
    print(f"Estimated size (source total, upper bound): {human_size(total_src_bytes)}")
    if skip_captioning:
        print(f"Captions: {len(existing)} already exist and will be kept, captioning disabled ({len(need)} left uncaptioned)")
    else:
        print(f"Captions: {len(existing)} already exist and will be kept, {len(need)} would be generated")

    if dry_run:
        print()
        print("Dry run: no files were written.")
        return

    target_dir.mkdir(parents=True, exist_ok=True)

    for img in images:
        dest_path, _ = plans[img]
        process_image(img, dest_path, resolution, background_color, dry_run=False)

    generated, skipped = stage_and_tag(
        target_dir, list(mapping.values()), trigger_word,
        caption_extension=caption_extension,
        force_recaption=force_recaption,
        skip_captioning=skip_captioning,
        wd14_repo_id=wd14_repo_id,
        wd14_batch_size=wd14_batch_size,
        wd14_thresh=wd14_thresh,
        wd14_undesired_tags=wd14_undesired_tags,
        device=device,
    )

    final_size = sum(f.stat().st_size for f in target_dir.iterdir() if f.is_file())

    print()
    print("=== Summary ===")
    print(f"Images processed: {len(images)}")
    print(f"Captions generated: {generated}")
    print(f"Captions skipped (already existed): {skipped}")
    print(f"Output folder: {target_dir}")
    print(f"Output folder size: {human_size(final_size)}")


if __name__ == "__main__":
    main()
