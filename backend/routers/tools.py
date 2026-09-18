import asyncio
import base64
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
import httpx
from pydantic import BaseModel

from backend import external_paths
from backend.services.gpu_jobs import (
    APP_DIR, DATA_DIR, _jobs, gpu_queue, _new_job, _newest_file,
    _sd_unload_checkpoint, _sd_reload_checkpoint,
    _free_sd_vram_for_job, _restore_sd_vram_after_job,
)

router = APIRouter()

# Prefer the project venv pip so installs don't hit the system-managed environment
_VENV_PIP = os.path.join(APP_DIR, "venv", "bin", "pip")
_PIP = _VENV_PIP if os.path.isfile(_VENV_PIP) else "pip"

# ── Stable Diffusion checkpoint presets ─────────────────────────────────────────
# Each "style" bundles a checkpoint + VAE with the sampler/steps/cfg/hires/resolution
# settings that checkpoint actually looks good with, so the caller just picks a style
# instead of hand-tuning generation params per model.
#
#   realistic — RealVisXL: photoreal portraits/scenes. Full steps + hires fix for detail.
#   general   — Juggernaut-XL: all-purpose SDXL, good default for mixed/unspecified subjects.
#   stylized  — DreamShaperXL Turbo: illustrative/stylized look, few steps, low cfg, no hires
#               fix (Turbo models oversaturate/melt under hires fix + normal cfg).
#   legacy    — original SD1.5 base checkpoint, kept around for before/after comparisons.
#               Needs its own (non-SDXL) VAE and degrades above ~512-768px.
SD_BASE = "http://localhost:7860"
# The docker-compose container name for A1111 (its compose project lives under
# external_paths.A1111_DIR).
# Used to recover from A1111 getting stuck with its internal model reference corrupted —
# observed after unload/reload-checkpoint cycles, where even /sdapi/v1/reload-checkpoint
# itself starts raising AttributeErrors and only a container restart clears it.
A1111_CONTAINER = "a1111"

SD_CHECKPOINTS = {
    "realistic": {
        "label": "Photorealistic (RealVisXL)",
        "description": "Best for portraits and photography-style images",
        "checkpoint": "RealVisXL_V5.0_fp16.safetensors",
        "vae": "sdxl-vae-fp16-fix.safetensors",
        "sampler_name": "DPM++ 2M Karras",
        "steps": 30,
        "cfg_scale": 5.5,
        "enable_hr": True,
        "hr_scale": 1.5,
        "hr_upscaler": "Latent",
        "hr_second_pass_steps": 15,
        "denoising_strength": 0.45,
        "default_width": 1024,
        "default_height": 1024,
    },
    "general": {
        "label": "General Purpose (Juggernaut XL)",
        "description": "Good all-around default for mixed or unspecified subjects",
        "checkpoint": "Juggernaut-XL-v9.safetensors",
        "vae": "sdxl-vae-fp16-fix.safetensors",
        "sampler_name": "DPM++ 2M Karras",
        "steps": 30,
        "cfg_scale": 5.0,
        "enable_hr": True,
        "hr_scale": 1.5,
        "hr_upscaler": "Latent",
        "hr_second_pass_steps": 15,
        "denoising_strength": 0.4,
        "default_width": 1024,
        "default_height": 1024,
    },
    "stylized": {
        "label": "Stylized / Artistic (DreamShaper Turbo)",
        "description": "Illustration, fantasy, painterly styles — fast, few steps",
        "checkpoint": "DreamShaperXL_Turbo_v2.safetensors",
        "vae": "sdxl-vae-fp16-fix.safetensors",
        "sampler_name": "DPM++ SDE Karras",
        "steps": 8,
        "cfg_scale": 2.0,
        "enable_hr": False,
        "denoising_strength": 0.3,
        "default_width": 1024,
        "default_height": 1024,
    },
    "legacy": {
        "label": "Classic SD 1.5 (original)",
        "description": "The original base model — softer, lower detail, for comparison",
        "checkpoint": "v1-5-pruned-emaonly.safetensors",
        "vae": "vae-ft-mse-840000-ema-pruned.ckpt",
        "sampler_name": "Euler a",
        "steps": 20,
        "cfg_scale": 7,
        "enable_hr": False,
        "denoising_strength": 0.4,
        "default_width": 512,
        "default_height": 512,
    },
}
DEFAULT_STYLE = "realistic"

# A1111 >=1.9 split the scheduler (Karras/Exponential/etc.) out of sampler_name into its
# own "scheduler" field — sending the old combined string ("DPM++ 2M Karras") as
# sampler_name now 404s with "Sampler not found". SD_CHECKPOINTS keeps the familiar
# combined name for readability; this splits it into the two fields A1111 actually expects.
_LEGACY_SCHEDULER_SUFFIXES = {
    "Karras": "karras",
    "Exponential": "exponential",
    "Polyexponential": "polyexponential",
    "SGM Uniform": "sgm_uniform",
    "Uniform": "uniform",
}


def _split_sampler_scheduler(sampler_name: str) -> tuple[str, str]:
    for suffix, scheduler in _LEGACY_SCHEDULER_SUFFIXES.items():
        if sampler_name.endswith(f" {suffix}"):
            return sampler_name[: -(len(suffix) + 1)], scheduler
    return sampler_name, "automatic"


def _style_txt2img_params(style: str) -> dict:
    """Per-checkpoint generation defaults (sampler/steps/cfg/hires/checkpoint+vae) for a style name.

    Does not include width/height — callers apply _style_default_size() for those,
    since "explicit vs. not passed" needs to be distinguishable (dict.pop vs dict default).
    """
    cfg = SD_CHECKPOINTS.get(style, SD_CHECKPOINTS[DEFAULT_STYLE])
    sampler_name, scheduler = _split_sampler_scheduler(cfg["sampler_name"])
    return {
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "steps": cfg["steps"],
        "cfg_scale": cfg["cfg_scale"],
        "enable_hr": cfg.get("enable_hr", False),
        "hr_scale": cfg.get("hr_scale", 1.5),
        "hr_upscaler": cfg.get("hr_upscaler", "Latent"),
        "hr_second_pass_steps": cfg.get("hr_second_pass_steps", 0),
        "denoising_strength": cfg.get("denoising_strength", 0.4),
        "override_settings": {
            "sd_model_checkpoint": cfg["checkpoint"],
            "sd_vae": cfg["vae"],
        },
    }


def _style_default_size(style: str) -> tuple[int, int]:
    """(width, height) a style looks good at — 512 for legacy SD1.5, 1024 for the SDXL styles."""
    cfg = SD_CHECKPOINTS.get(style, SD_CHECKPOINTS[DEFAULT_STYLE])
    return cfg.get("default_width", 1024), cfg.get("default_height", 1024)


_sd_checkpoints_validated = False


async def _validate_sd_checkpoints():
    """Warn (without raising) if a configured checkpoint isn't visible to the running A1111 instance.

    Runs once, lazily, on the first SD generate request rather than at import time —
    A1111 may not be up yet when this module is imported.
    """
    global _sd_checkpoints_validated
    if _sd_checkpoints_validated:
        return
    _sd_checkpoints_validated = True
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{SD_BASE}/sdapi/v1/sd-models")
            r.raise_for_status()
            available = {os.path.basename(m.get("filename", "")) for m in r.json()}
        for style, cfg in SD_CHECKPOINTS.items():
            if cfg["checkpoint"] not in available:
                print(f"[tools] WARNING: SD style '{style}' checkpoint not found in A1111: {cfg['checkpoint']}")
    except Exception as e:
        print(f"[tools] WARNING: could not validate SD checkpoints against A1111 ({SD_BASE}): {e}")


# ── Tool registry ──────────────────────────────────────────────────────────────
# Each entry: id → { name, description, type, category, port?, endpoint?, script?, homepage, install }

TOOLS = {
    # ── Image ────────────────────────────────────────────────────────────────
    "stable_diffusion": {
        "name": "Stable Diffusion (A1111)",
        "description": "Text-to-image generation via AUTOMATIC1111 WebUI. Supports SD1.5, SDXL, ControlNet. "
                       "Generation style presets: style: realistic | general | stylized.",
        "type": "image", "category": "image",
        "port": 7860, "endpoint": "http://localhost:7860",
        "homepage": "http://localhost:7860",
        "install": "docker compose up -d  # or launch A1111 webui.sh",
    },
    "comfyui": {
        "name": "ComfyUI",
        "description": "Node-based image/video pipeline. Supports FLUX.1, SDXL, SD3, ControlNet, LoRA, Wan2.1.",
        "type": "image", "category": "image",
        "port": 8188, "endpoint": "http://localhost:8188",
        "homepage": "http://localhost:8188",
        "install": "docker run -p 8188:8188 ghcr.io/ai-dock/comfyui",
    },
    "fooocus": {
        "name": "Fooocus",
        "description": "Simplified SDXL/FLUX UI. Midjourney-like quality with zero configuration.",
        "type": "image", "category": "image",
        "port": 7865, "endpoint": "http://localhost:7865",
        "homepage": "http://localhost:7865",
        "install": "git clone https://github.com/lllyasviel/Fooocus && python launch.py",
    },
    "realesrgan": {
        "name": "Real-ESRGAN",
        "description": "AI image upscaling (2×/4×). Works on photos, illustrations, and video frames.",
        "type": "image", "category": "image",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_realesrgan.py"),
        "install": "pip install realesrgan basicsr",
    },
    "rembg": {
        "name": "rembg",
        "description": "Background removal using U2-Net. Instant results with no GPU required.",
        "type": "image", "category": "image",
        "port": None,
        "install": "pip install rembg[gpu] onnxruntime-gpu",
    },
    # ── Audio ────────────────────────────────────────────────────────────────
    "tortoise_tts": {
        "name": "Tortoise TTS",
        "description": "High-quality multi-voice TTS. Slow but very natural-sounding.",
        "type": "audio", "category": "audio",
        "port": 5003, "endpoint": "http://localhost:5003",
        "install": "docker compose up -d  # tortoise service",
    },
    "alltalk_tts": {
        "name": "AllTalk TTS",
        "description": "Web UI wrapping XTTSv2 and Kokoro. Supports voice cloning from a 3s clip.",
        "type": "audio", "category": "audio",
        "port": 7851, "endpoint": "http://localhost:7851",
        "homepage": "http://localhost:7851",
        "install": "git clone https://github.com/erew123/alltalk_tts && pip install -r requirements.txt",
    },
    "kokoro_tts": {
        "name": "Kokoro TTS",
        "description": "Ultra-fast 82M-param TTS. Apache 2.0. Near-instant synthesis, runs on CPU or GPU.",
        "type": "audio", "category": "audio",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_kokoro.py"),
        "install": "pip install kokoro soundfile",
    },
    "f5_tts": {
        "name": "F5-TTS",
        "description": "Zero-shot voice cloning from a 3-second reference clip. State-of-the-art (2024).",
        "type": "audio", "category": "audio",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_f5tts.py"),
        "install": "pip install f5-tts",
    },
    "musicgen": {
        "name": "MusicGen (AudioCraft)",
        "description": "Meta's text-to-music model. Generate background music from a text description.",
        "type": "audio", "category": "audio",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_musicgen.py"),
        "install": "pip install audiocraft",
    },
    "whisper": {
        "name": "Whisper STT",
        "description": "OpenAI Whisper speech-to-text. Accurate transcription for any audio/video.",
        "type": "audio", "category": "audio",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_whisper.py"),
        "install": f"{external_paths.WHISPER_VENV}/bin/pip install -U openai-whisper",
    },
    # ── Video ────────────────────────────────────────────────────────────────
    "sadtalker": {
        "name": "SadTalker",
        "description": "Talking-head video from a portrait image + audio file.",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_sadtalker.py"),
        "install": f"# Checkout + checkpoints at {external_paths.SADTALKER_DIR}, conda env 'sadtalker'",
    },
    "musetalk": {
        "name": "MuseTalk",
        "description": "Real-time talking head synthesis. Faster than SadTalker, same portrait+audio workflow.",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_musetalk.py"),
        "install": "git clone https://github.com/TMElyralab/MuseTalk && pip install -r requirements.txt",
    },
    "wan2": {
        "name": "Wan2.1 Video",
        "description": "Alibaba's open text-to-video model (T2V-1.3B). Runs in Video Studio (/video) — "
                        "weights auto-download from HuggingFace on first run, fits comfortably in 12GB VRAM.",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_wan2.py"),
        "install": "pip install -U diffusers 'transformers<5' sentencepiece accelerate imageio imageio-ffmpeg  "
                   "# already satisfied in the main project venv; weights pull from "
                   "Wan-AI/Wan2.1-T2V-1.3B-Diffusers on first job. transformers>=5 has a tokenizer-conversion "
                   "bug (github.com/huggingface/transformers, confirmed broken on 5.13.0/5.13.1) that breaks "
                   "any T5/UMT5 sentencepiece tokenizer without a prebuilt tokenizer.json, which both "
                   "Wan2.1 and LTX-Video need — stay on the 4.x line until upstream fixes it.",
    },
    "animatediff": {
        "name": "AnimateDiff",
        "description": "Animate any SD1.5 model. Text→looping animation.",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_anim.py"),
        "install": f"cd {external_paths.ANIMATEDIFF_DIR} && python3.11 -m venv venv && "
                   "venv/bin/pip install -r requirements.txt  # needs 3.11, not 3.12 — tokenizers==0.13.3 has "
                   "no cp312 wheel and fails to build from source. Motion module + SD1.5 base auto-download on first run.",
    },
    # ── AI Infrastructure ────────────────────────────────────────────────────
    "localai": {
        "name": "LocalAI",
        "description": "OpenAI-compatible API for GGUF/GPTQ models, Whisper, SD, and TTS — all in one Docker container.",
        "type": "llm", "category": "ai",
        "port": 8080, "endpoint": "http://localhost:8080",
        "homepage": "http://localhost:8080",
        "install": "docker run -p 8080:8080 quay.io/go-skynet/local-ai:latest",
    },
    "open_webui": {
        "name": "Open WebUI",
        "description": "Full-featured Ollama chat UI with RAG, document upload, image gen, multi-user support.",
        "type": "llm", "category": "ai",
        "port": 3000, "endpoint": "http://localhost:3000",
        "homepage": "http://localhost:3000",
        "install": "docker run -p 3000:8080 ghcr.io/open-webui/open-webui",
    },
    "tabby": {
        "name": "Tabby",
        "description": "Self-hosted AI code completion server. OpenAI-compatible. Works with VS Code and JetBrains.",
        "type": "code", "category": "ai",
        "port": 11029, "endpoint": "http://localhost:11029",
        "homepage": "http://localhost:11029",
        "install": "docker run -p 11029:11029 tabbyml/tabby serve --model StarCoder-1B",
    },
    # ── 3D ───────────────────────────────────────────────────────────────────
    "triposr": {
        "name": "TripoSR",
        "description": "Image → 3D mesh in seconds. Exports .obj/.glb for Blender or OrcaSlicer. Needs ~3GB VRAM.",
        "type": "3d", "category": "3d",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_triposr.py"),
        "install": "pip install tsr  # github.com/VAST-AI-Research/TripoSR",
        "vram_gb": 3,
    },
    "instantmesh": {
        "name": "InstantMesh",
        "description": "High-quality image → 3D mesh via multi-view diffusion. Better geometry than TripoSR. ~8GB VRAM.",
        "type": "3d", "category": "3d",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_instantmesh.py"),
        "install": "git clone https://github.com/TencentARC/InstantMesh && pip install -r requirements.txt",
        "vram_gb": 8,
    },
    "shap_e": {
        "name": "Shap-E",
        "description": "Text or image → 3D (OpenAI, MIT). Generates .ply / .obj point clouds and meshes.",
        "type": "3d", "category": "3d",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_shape.py"),
        "install": "pip install shap-e",
        "vram_gb": 4,
    },
    "depth_anything": {
        "name": "Depth Anything V2",
        "description": "Monocular depth estimation from any image. Feeds 3D reconstruction and video pipelines. ~1GB VRAM.",
        "type": "image", "category": "3d",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_depth.py"),
        "install": "pip install depth-anything-v2  # or via transformers",
        "vram_gb": 1,
    },
    # ── Vision ────────────────────────────────────────────────────────────────
    "florence2": {
        "name": "Florence-2",
        "description": "Microsoft vision model (MIT). OCR, image captioning, object detection, grounding — all in one. ~1.5GB VRAM.",
        "type": "image", "category": "image",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_florence2.py"),
        "install": "pip install transformers timm einops",
        "vram_gb": 2,
    },
    # ── More Video ────────────────────────────────────────────────────────────
    "ltx_video": {
        "name": "LTX-Video",
        "description": "Lightricks' open video model (Apache 2.0), 2B-param line built for consumer GPUs. "
                       "Image-to-video and text-to-video. Uses whole-submodule CPU offload, comfortably "
                       "fits this 12GB card. Weights auto-download from Hugging Face on first run (~4-5GB).",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_ltxvideo.py"),
        "install": f"{_PIP} install -U diffusers 'transformers<5' sentencepiece accelerate imageio imageio-ffmpeg"
                   " # transformers>=5 breaks this tokenizer, see wan2's install note",
        "vram_gb": 6,
    },
    "cogvideox": {
        "name": "CogVideoX-2B",
        "description": "SAP/THUDM text-to-video (Apache 2.0). High quality 6s clips. 2B param model fits in 7-8GB VRAM.",
        "type": "video", "category": "video",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_cogvideo.py"),
        "install": "pip install diffusers transformers accelerate",
        "vram_gb": 8,
    },
    # ── More Audio ────────────────────────────────────────────────────────────
    "rvc": {
        "name": "RVC (Voice Conversion)",
        "description": "Retrieval-based Voice Conversion. Clone any voice from a short clip. Real-time capable on GPU.",
        "type": "audio", "category": "audio",
        "port": 7865,
        "endpoint": "http://localhost:7865",
        "homepage": "http://localhost:7865",
        "install": "git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI && pip install -r requirements.txt",
        "vram_gb": 2,
    },
    "chatterbox": {
        "name": "Chatterbox TTS",
        "description": "Resemble AI zero-shot TTS (Apache 2.0, 2025). Clones voice from 5-10s reference. State-of-the-art quality.",
        "type": "audio", "category": "audio",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_chatterbox.py"),
        "install": "# Needs its own venv, not the main one — chatterbox-tts pins torch==2.6.0 and "
                   "transformers==5.2.0, which would downgrade the main venv's torch 2.12 and break the "
                   "transformers<5 pin Wan2.1/LTX-Video need. One-time setup: "
                   f"python3 -m venv {external_paths.CHATTERBOX_VENV} && "
                   f"{external_paths.CHATTERBOX_VENV}/bin/pip install chatterbox-tts",
        "vram_gb": 2,
    },
    # ── Agents & RAG ─────────────────────────────────────────────────────────
    "anythingllm": {
        "name": "AnythingLLM",
        "description": "All-in-one RAG hub. Document Q&A, agents, multi-user, works with Ollama. Best local RAG solution.",
        "type": "llm", "category": "ai",
        "port": 3001, "endpoint": "http://localhost:3001",
        "homepage": "http://localhost:3001",
        "install": "docker run -p 3001:3001 mintplexlabs/anythingllm",
    },
    "flowise": {
        "name": "Flowise",
        "description": "Visual LangChain flow builder (Apache 2.0). Build RAG pipelines, chatbots, and agents graphically.",
        "type": "llm", "category": "ai",
        "port": 3000, "endpoint": "http://localhost:3000",
        "homepage": "http://localhost:3000",
        "install": "docker run -p 3000:3000 flowiseai/flowise",
    },
    "aider": {
        "name": "Aider",
        "description": "AI pair programmer in your terminal (Apache 2.0). Works with local Ollama. Edit real codebases with AI.",
        "type": "code", "category": "ai",
        "port": None,
        "script": os.path.join(APP_DIR, "scripts", "run_aider.py"),
        "install": "pip install aider-chat  # then: aider --model ollama/qwen2.5-coder:14b",
    },
    # ── Local HTML Tools ─────────────────────────────────────────────────────
    "design_center": {
        "name": "Design Center",
        "description": "Canva-style graphic design tool with layers, gradients, SVG shapes, AI image generation, text effects, snap guides, and template gallery.",
        "type": "creative", "category": "creative",
        "port": None,
        "script": os.path.join(APP_DIR, "static", "html-tools", "design-center.html"),
        "homepage": "http://localhost:8010/html-tools/design-center.html",
    },
    "terminal_hub": {
        "name": "Terminal — Linux Hub",
        "description": "Linux command reference and terminal interface for the Arynwood system.",
        "type": "code", "category": "code",
        "port": None,
        "script": os.path.join(APP_DIR, "static", "html-tools", "terminal.html"),
        "homepage": "http://localhost:8010/html-tools/terminal.html",
    },
    "client_intake": {
        "name": "Client Intake / Website Generator",
        "description": "Client intake form and website generator tool for onboarding and project scoping.",
        "type": "code", "category": "code",
        "port": None,
        "script": os.path.join(APP_DIR, "static", "html-tools", "client-intake.html"),
        "homepage": "http://localhost:8010/html-tools/client-intake.html",
    },
    "flowchart": {
        "name": "Arynwood Flowchart",
        "description": "Visual workflow designer for building and visualizing process flows and diagrams.",
        "type": "code", "category": "code",
        "port": None,
        "script": os.path.join(APP_DIR, "static", "html-tools", "flowchart.html"),
        "homepage": "http://localhost:8010/html-tools/flowchart.html",
    },
    # ── Scraping ─────────────────────────────────────────────────────────────
    "scrapling": {
        "name": "Scrapling",
        "description": "Adaptive web scraper with Cloudflare bypass and JS rendering. CSS/XPath extraction, stealthy fetch, full browser automation.",
        "type": "scraping", "category": "scraping",
        "port": None,
        "install": 'pip install "scrapling[fetchers]" && scrapling install',
    },
    # ── Search & Data ────────────────────────────────────────────────────────
    "searxng": {
        "name": "SearXNG",
        "description": "Privacy-first metasearch engine. Used by AI agents (Perplexica, Open-WebUI) for live web search.",
        "type": "search", "category": "search",
        "port": 8888, "endpoint": "http://localhost:8888",
        "homepage": "http://localhost:8888",
        "install": "docker run -p 8888:8080 searxng/searxng",
    },
    "qdrant": {
        "name": "Qdrant",
        "description": "Local vector database for RAG workflows. Store and search embeddings from Ollama or LocalAI.",
        "type": "vector", "category": "data",
        "port": 6333, "endpoint": "http://localhost:6333",
        "install": "docker run -p 6333:6333 qdrant/qdrant",
    },
    "perplexica": {
        "name": "Perplexica",
        "description": "Local Perplexity alternative. AI-powered search combining SearXNG + Ollama.",
        "type": "search", "category": "search",
        "port": 3001, "endpoint": "http://localhost:3001",
        "homepage": "http://localhost:3001",
        "install": "git clone https://github.com/ItzCrazyKns/Perplexica && docker compose up -d",
    },
}


# ── Status checker ─────────────────────────────────────────────────────────────

async def check_tool_status(tool_key: str, info: dict) -> str:
    """Probe a tool's endpoint or check its script/package; returns 'online', 'available', or 'unavailable'."""
    endpoint = info.get("endpoint")
    if endpoint:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(endpoint, timeout=2.0)
                return "online" if 200 <= r.status_code < 500 else "error"
        except Exception:
            return "offline"
    # Script-based tool: check if script exists OR package importable
    script = info.get("script")
    if script and os.path.exists(script):
        return "available"
    # Check for rembg specially (importable package)
    if tool_key == "rembg":
        try:
            import rembg  # noqa
            return "available"
        except ImportError:
            return "unavailable"
    if tool_key == "kokoro_tts":
        try:
            import kokoro  # noqa
            return "available"
        except ImportError:
            return "unavailable"
    if tool_key == "scrapling":
        try:
            import scrapling  # noqa
            return "available"
        except ImportError:
            return "unavailable"
    return "unavailable"


# ── List / get tools ───────────────────────────────────────────────────────────

@router.get("")
async def list_tools():
    """GET /tools — list all registered tools with their live status."""
    statuses = await asyncio.gather(
        *[check_tool_status(k, v) for k, v in TOOLS.items()],
        return_exceptions=True,
    )
    return [
        {
            "id": key,
            "name": info["name"],
            "description": info["description"],
            "type": info["type"],
            "category": info["category"],
            "port": info.get("port"),
            "homepage": info.get("homepage"),
            "install": info.get("install"),
            "vram_gb": info.get("vram_gb"),
            "local_html": str(info.get("script", "")).endswith(".html"),
            "status": status if isinstance(status, str) else "error",
        }
        for (key, info), status in zip(TOOLS.items(), statuses)
    ]


# ── Open / Install actions ──────────────────────────────────────────────────────

@router.post("/{tool_id}/open")
async def open_tool(tool_id: str):
    """Open a tool in the system browser or file manager."""
    if tool_id not in TOOLS:
        raise HTTPException(404, "Tool not found")
    info = TOOLS[tool_id]
    script = str(info.get("script", ""))
    url = info.get("homepage") or info.get("endpoint")
    target = script if script.endswith(".html") and os.path.exists(script) else url
    if not target:
        raise HTTPException(400, "Nothing to open for this tool")
    await asyncio.create_subprocess_exec("xdg-open", target)
    return {"opened": target}


@router.get("/{tool_id}/install/stream")
async def install_tool_stream(tool_id: str):
    """Run a tool's install command and stream stdout+stderr as plain text."""
    if tool_id not in TOOLS:
        raise HTTPException(404, "Tool not found")
    info = TOOLS[tool_id]
    cmd = (info.get("install") or "").strip()
    if not cmd or cmd.startswith("#") or cmd.startswith("xdg-open"):
        raise HTTPException(400, "No runnable install command for this tool")

    from fastapi.responses import StreamingResponse as SR

    async def _stream():
        """Async generator that streams shell output lines from the install command."""
        # Replace bare 'pip' with the venv pip so installs land in the right environment
        _venv_bin = os.path.join(APP_DIR, "venv", "bin")
        resolved_cmd = cmd.replace("pip install", f"{_PIP} install").replace("pip3 install", f"{_PIP} install")
        # Prepend venv/bin to PATH so venv-installed scripts (e.g. scrapling) are found
        env = {**os.environ, "PATH": f"{_venv_bin}:{os.environ.get('PATH', '')}"}
        proc = await asyncio.create_subprocess_shell(
            resolved_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=APP_DIR,
            env=env,
        )
        async for line in proc.stdout:
            yield line
        code = await proc.wait()
        yield (f"\n{'✓ Done' if code == 0 else f'✗ Failed (exit {code})'}\n").encode()

    return SR(_stream(), media_type="text/plain")


@router.get("/jobs")
async def list_jobs():
    """GET /jobs — every tracked job (this process's lifetime only - _jobs is
    in-memory, not persisted, so a backend restart clears history). Each entry
    is annotated with its gpu_queue position (0 = running/next up, None = not
    currently queued there) so a dashboard can show queue depth without a
    second round-trip.

    Must be declared before GET /{tool_id} below - that's a one-segment
    catch-all and would otherwise intercept /jobs (also one segment) first,
    treating "jobs" as a tool_id and 404ing before this route is ever reached.

    First real slice of task #13 (observability dashboard) - this is the raw
    data endpoint; a UI to visualize it is the natural follow-up, not done here.
    """
    return {
        "jobs": [
            {"id": job_id, **job, "queue_position": gpu_queue.queue_position(job_id)}
            for job_id, job in _jobs.items()
        ],
        "gpu_queue_depth": gpu_queue.queue_depth(),
    }


@router.get("/{tool_id}")
async def get_tool(tool_id: str):
    """GET /tools/{id} — return metadata and live status for a single tool."""
    if tool_id not in TOOLS:
        raise HTTPException(404, "Tool not found")
    info = TOOLS[tool_id]
    return {**info, "id": tool_id, "status": await check_tool_status(tool_id, info)}


# ── Stable Diffusion (A1111) ───────────────────────────────────────────────────

class SDRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    width: Optional[int] = None
    height: Optional[int] = None
    cfg_scale: float = 7.0
    style: str = DEFAULT_STYLE


@router.post("/stable_diffusion/generate")
async def sd_generate(req: SDRequest):
    """POST /stable_diffusion/generate — run txt2img on the local A1111 instance.

    `req.style` selects a checkpoint + its tuned sampler/steps/cfg/hires-fix defaults from
    SD_CHECKPOINTS (falls back to DEFAULT_STYLE for an unrecognized style string). Width/height
    fall back to that style's default size (512 for legacy SD1.5, 1024 for the SDXL styles)
    when the caller doesn't pass them explicitly.

    Runs through `gpu_queue` (priority=True - a single interactive generate shouldn't wait
    behind a multi-hour LoRA training run) so it can never land mid-checkpoint-swap while
    another GPU job has A1111 unloaded via `_free_sd_vram_for_job` - that race is what
    corrupts A1111's internal model reference (see A1111_CONTAINER / sd_proxy_restart above).
    """
    await _validate_sd_checkpoints()
    default_w, default_h = _style_default_size(req.style)
    job_id = f"sd_generate:{uuid.uuid4().hex}"
    async with gpu_queue.acquire(job_id, priority=True):
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                r = await client.post(f"{SD_BASE}/sdapi/v1/txt2img", json={
                    "prompt": req.prompt, "negative_prompt": req.negative_prompt,
                    "width": req.width if req.width is not None else default_w,
                    "height": req.height if req.height is not None else default_h,
                    **_style_txt2img_params(req.style),
                    "alwayson_scripts": {
                        "ADetailer": {
                            "args": [
                                True,
                                {
                                    "ad_model": "face_yolov8n.pt",
                                    "ad_confidence": 0.3
                                }
                            ]
                        }
                    }
                })
                r.raise_for_status()
                data = r.json()
                return {"images": data.get("images", []), "info": data.get("info", "")}
            except Exception as e:
                raise HTTPException(502, f"SD error: {e}")


# ── Tortoise TTS ───────────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    voice: str = "random"


@router.post("/tortoise_tts/generate")
async def tts_generate(req: TTSRequest):
    """POST /tortoise_tts/generate — synthesize speech via the Tortoise TTS Docker container."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post("http://localhost:5003/generate", json={"text": req.text, "voice": req.voice})
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(502, f"TTS error: {e}")


# ── AllTalk TTS ────────────────────────────────────────────────────────────────

class AllTalkRequest(BaseModel):
    text: str
    voice: str = "default"
    language: str = "en"


@router.post("/alltalk_tts/generate")
async def alltalk_generate(req: AllTalkRequest):
    """POST /alltalk_tts/generate — synthesize speech via the AllTalk TTS API."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post("http://localhost:7851/api/tts-generate", json={
                "text_input": req.text,
                "character_voice_gen": req.voice,
                "language": req.language,
                "output_file_name": "output",
            })
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(502, f"AllTalk error: {e}")


# ── Kokoro TTS ─────────────────────────────────────────────────────────────────

class KokoroRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@router.post("/kokoro/generate")
async def kokoro_generate(req: KokoroRequest):
    """POST /kokoro/generate — synthesize speech locally with the Kokoro TTS model; returns base64 WAV."""
    try:
        from kokoro import KPipeline
        import soundfile as sf
        import numpy as np
        import tempfile

        pipeline = KPipeline(lang_code="a")
        audio_chunks = []
        for _, _, audio in pipeline(req.text, voice=req.voice, speed=req.speed, split_pattern=r"\n+"):
            audio_chunks.append(audio)

        if not audio_chunks:
            raise HTTPException(500, "No audio generated")

        combined = np.concatenate(audio_chunks)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            sf.write(f.name, combined, 24000)
            with open(f.name, "rb") as audio_f:
                audio_b64 = base64.b64encode(audio_f.read()).decode()
        os.unlink(f.name)
        return {"audio_base64": audio_b64, "sample_rate": 24000, "format": "wav"}
    except ImportError:
        raise HTTPException(503, "Kokoro not installed. Run: pip install kokoro soundfile")
    except Exception as e:
        raise HTTPException(500, f"Kokoro error: {e}")


# ── rembg background removal ───────────────────────────────────────────────────

@router.post("/rembg/remove")
async def rembg_remove(image: UploadFile = File(...)):
    """POST /rembg/remove — remove the background from an uploaded image; returns base64 PNG."""
    try:
        from rembg import remove as rembg_remove_fn
        from PIL import Image as PILImage
    except ImportError:
        raise HTTPException(503, "rembg not installed. Run: pip install rembg[gpu] onnxruntime-gpu")
    try:
        img_bytes = await image.read()
        input_img = PILImage.open(io.BytesIO(img_bytes)).convert("RGBA")
        output_img = rembg_remove_fn(input_img)
        buf = io.BytesIO()
        output_img.save(buf, format="PNG")
        result_b64 = base64.b64encode(buf.getvalue()).decode()
        return {"image_base64": result_b64, "format": "png"}
    except Exception as e:
        raise HTTPException(500, f"rembg error: {e}")


# ── Real-ESRGAN upscaling ──────────────────────────────────────────────────────

@router.post("/realesrgan/upscale")
async def realesrgan_upscale(
    image: UploadFile = File(...),
    scale: int = Form(4),
):
    """POST /realesrgan/upscale — upscale an image via the Real-ESRGAN script; returns base64 PNG."""
    script = TOOLS["realesrgan"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "Real-ESRGAN script not found. Create scripts/run_realesrgan.py")
    try:
        import tempfile, shutil, uuid
        tmp = tempfile.mkdtemp()
        in_path = os.path.join(tmp, f"input_{uuid.uuid4().hex}.png")
        out_path = os.path.join(tmp, f"output.png")
        img_bytes = await image.read()
        with open(in_path, "wb") as f:
            f.write(img_bytes)
        proc = await asyncio.create_subprocess_exec(
            "python3", script, in_path, out_path, "--scale", str(scale),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        if proc.returncode != 0:
            raise HTTPException(500, f"Real-ESRGAN error: {stderr.decode()[:400]}")
        with open(out_path, "rb") as f:
            result_b64 = base64.b64encode(f.read()).decode()
        shutil.rmtree(tmp, ignore_errors=True)
        return {"image_base64": result_b64, "format": "png", "scale": scale}
    except asyncio.TimeoutError:
        raise HTTPException(504, "Real-ESRGAN timed out")
    except Exception as e:
        raise HTTPException(500, f"Upscale error: {e}")


# ── SearXNG search proxy ───────────────────────────────────────────────────────

@router.get("/searxng/search")
async def searxng_search(
    q: str = Query(...),
    engines: str = Query(""),
    pageno: int = Query(1),
):
    """GET /searxng/search — proxy a search query to the local SearXNG instance."""
    params = {"q": q, "format": "json", "pageno": pageno}
    if engines:
        params["engines"] = engines
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            r = await client.get("http://localhost:8888/search", params=params)
            r.raise_for_status()
            data = r.json()
            return {
                "query": q,
                "results": data.get("results", [])[:10],
                "suggestions": data.get("suggestions", []),
                "answers": data.get("answers", []),
            }
        except httpx.ConnectError:
            raise HTTPException(503, "SearXNG is not running. Start it with: docker run -p 8888:8080 searxng/searxng")
        except Exception as e:
            raise HTTPException(502, f"SearXNG error: {e}")


# ── Qdrant collections ─────────────────────────────────────────────────────────

@router.get("/qdrant/collections")
async def qdrant_collections():
    """GET /qdrant/collections — list Qdrant vector collections (knowledge base namespaces)."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get("http://localhost:6333/collections")
            r.raise_for_status()
            return r.json()
        except httpx.ConnectError:
            raise HTTPException(503, "Qdrant is not running. Start it with: docker run -p 6333:6333 qdrant/qdrant")
        except Exception as e:
            raise HTTPException(502, f"Qdrant error: {e}")


# ── SadTalker ─────────────────────────────────────────────────────────────────

FLORENCE2_TASK_MAP = {
    "caption": "<CAPTION>",
    "detailed_caption": "<DETAILED_CAPTION>",
    "more_detailed_caption": "<MORE_DETAILED_CAPTION>",
    "ocr": "<OCR>",
    "detect": "<OD>",
}


def run_florence2(img: "PILImage.Image", task: str = "caption"):
    """Core Florence-2 inference, split out from the /florence2/caption endpoint
    below (roadmap 4.3) so lora.py's dataset-captioning flow can call it directly
    against a PIL Image already loaded from disk, instead of round-tripping through
    an HTTP upload to itself. Loads the model fresh on every call — same as the
    endpoint below always has — so this is fine for one-off/one-image use but not
    something to call in a tight per-frame loop without caching the model first.
    """
    from transformers import AutoProcessor, AutoModelForCausalLM
    import torch
    prompt = FLORENCE2_TASK_MAP.get(task, "<CAPTION>")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/Florence-2-base", trust_remote_code=True, torch_dtype=torch.float16
    ).to(device)
    processor = AutoProcessor.from_pretrained("microsoft/Florence-2-base", trust_remote_code=True)
    inputs = processor(text=prompt, images=img, return_tensors="pt").to(device, torch.float16)
    generated_ids = model.generate(
        input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"],
        max_new_tokens=512, num_beams=3,
    )
    result = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    return processor.post_process_generation(result, task=prompt, image_size=(img.width, img.height))


@router.post("/florence2/caption")
async def florence2_caption(image: UploadFile = File(...), task: str = Form("caption")):
    """Run Florence-2 on an image. task: caption | detailed_caption | ocr | detect"""
    try:
        from PIL import Image as PILImage
        img_bytes = await image.read()
        img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
        parsed = run_florence2(img, task)
        return {"task": task, "result": parsed}
    except ImportError:
        raise HTTPException(503, "Florence-2 requires: pip install transformers timm einops")
    except Exception as e:
        raise HTTPException(500, f"Florence-2 error: {e}")


# Chatterbox job endpoints live near the end of this file, alongside the other
# GPU tool jobs (SadTalker/AnimateDiff/Whisper/LTX-Video) — see chatterbox_start_job.


# ── Scrapling ──────────────────────────────────────────────────────────────────

class ScraplingRequest(BaseModel):
    url: str
    selector: str = ""
    fetcher: str = "basic"   # basic | stealthy | dynamic
    output: str = "text"     # text | html


@router.post("/scrapling/fetch")
async def scrapling_fetch(req: ScraplingRequest):
    """POST /scrapling/fetch — scrape a URL with optional CSS/XPath selector; supports basic, stealthy, and dynamic fetchers."""
    try:
        import scrapling as _scrapling  # noqa — verify installed
    except ImportError:
        raise HTTPException(503, 'Scrapling not installed. Run: pip install "scrapling[fetchers]" && scrapling install')

    def _run():
        """Synchronous scrape body run in a thread via asyncio.to_thread."""
        if req.fetcher == "stealthy":
            from scrapling.fetchers import StealthyFetcher
            page = StealthyFetcher.fetch(req.url)
        elif req.fetcher == "dynamic":
            from scrapling.fetchers import DynamicFetcher
            page = DynamicFetcher.fetch(req.url)
        else:
            from scrapling.fetchers import Fetcher
            page = Fetcher().get(req.url)

        if req.selector:
            is_xpath = req.selector.startswith("//") or req.selector.startswith("(//")
            elements = page.xpath(req.selector) if is_xpath else page.css(req.selector)
            results = []
            for el in elements:
                try:
                    results.append({"text": (el.text or "").strip(), "html": el.html_content or ""})
                except Exception:
                    results.append({"text": str(el), "html": ""})
        else:
            raw_html = page.html_content or ""
            if req.output == "html":
                results = [{"text": "", "html": raw_html[:15000]}]
            else:
                # Strip tags for plain text preview
                import re
                text = re.sub(r"<[^>]+>", " ", raw_html)
                text = re.sub(r"\s+", " ", text).strip()
                results = [{"text": text[:8000], "html": ""}]

        return results

    try:
        results = await asyncio.to_thread(_run)
        return {
            "url": req.url,
            "selector": req.selector,
            "fetcher": req.fetcher,
            "count": len(results),
            "results": results,
        }
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Scrapling error: {e}")

# ── Stable Diffusion proxy ──────────────────────────────────────────────────
# Proxies SD API calls through the backend to avoid CORS issues from the browser.

@router.get("/sd/status")
async def sd_proxy_status():
    """Check if Stable Diffusion (A1111) is running."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{SD_BASE}/sdapi/v1/samplers")
            return {"running": r.status_code == 200}
    except Exception:
        return {"running": False}

@router.get("/sd/checkpoints")
async def sd_proxy_checkpoints():
    """List the checkpoint-selection styles (realistic/general/stylized/legacy) for a UI picker.

    Single source of truth for the frontend so it doesn't hardcode a second copy of each
    style's label/description/default resolution/steps/cfg.
    """
    return {
        style: {
            "label": cfg["label"],
            "description": cfg["description"],
            "default_width": cfg["default_width"],
            "default_height": cfg["default_height"],
            "default_steps": cfg["steps"],
            "default_cfg_scale": cfg["cfg_scale"],
        }
        for style, cfg in SD_CHECKPOINTS.items()
    }

@router.get("/sd/memory")
async def sd_proxy_memory():
    """VRAM currently held by A1111's loaded checkpoint, plus whether one is loaded at all.

    A1111 has no explicit "is a checkpoint loaded" flag, so this is inferred from
    cuda.active.current in /sdapi/v1/memory — confirmed empirically to drop from
    several GB to under ~100MB immediately after /unload-checkpoint.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{SD_BASE}/sdapi/v1/memory")
        r.raise_for_status()
        data = r.json()
        cuda = data.get("cuda", {})
        active_bytes = cuda.get("active", {}).get("current", 0)
        return {
            "loaded": active_bytes > 500 * 1024 * 1024,
            "active_bytes": active_bytes,
            "system_used_bytes": cuda.get("system", {}).get("used", 0),
            "system_total_bytes": cuda.get("system", {}).get("total", 0),
        }
    except httpx.ConnectError:
        raise HTTPException(503, "Stable Diffusion (A1111) is not running.")
    except Exception as e:
        raise HTTPException(500, f"Could not read SD memory stats: {e}")


@router.post("/sd/checkpoint/unload")
async def sd_proxy_unload_checkpoint():
    """Unload the current checkpoint from VRAM, freeing it for other GPU tools, while
    leaving the A1111 process itself running (near-instant to reload later)."""
    try:
        await _sd_unload_checkpoint()
        return {"status": "unloaded"}
    except httpx.ConnectError:
        raise HTTPException(503, "Stable Diffusion (A1111) is not running.")
    except Exception as e:
        raise HTTPException(500, f"Could not unload SD checkpoint: {e}")


@router.post("/sd/checkpoint/reload")
async def sd_proxy_reload_checkpoint():
    """Reload the checkpoint back into VRAM after an unload."""
    try:
        await _sd_reload_checkpoint()
        return {"status": "loaded"}
    except httpx.ConnectError:
        raise HTTPException(503, "Stable Diffusion (A1111) is not running.")
    except Exception as e:
        raise HTTPException(500, f"Could not reload SD checkpoint: {e}")


@router.post("/sd/restart")
async def sd_proxy_restart():
    """Restart the A1111 container and wait for it to come back up.

    Recovery for when A1111's internal model reference gets corrupted (seen after
    unload/reload-checkpoint cycles) badly enough that even reload-checkpoint itself
    starts throwing — at that point nothing short of a process restart clears it.
    """
    proc = await asyncio.create_subprocess_exec(
        "docker", "restart", A1111_CONTAINER,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(500, f"docker restart failed: {stderr.decode(errors='replace')[:300]}")

    deadline = time.time() + 90
    async with httpx.AsyncClient(timeout=3.0) as client:
        while time.time() < deadline:
            await asyncio.sleep(2)
            try:
                r = await client.get(f"{SD_BASE}/sdapi/v1/samplers")
                if r.status_code == 200:
                    return {"status": "restarted"}
            except Exception:
                continue
    raise HTTPException(504, "A1111 didn't come back within 90s — check `docker logs a1111`.")


@router.post("/sd/generate")
async def sd_proxy_generate(payload: dict):
    """Proxy text-to-image request to Stable Diffusion.

    Accepts an optional "style" key (realistic | general | stylized | legacy, default
    DEFAULT_STYLE) to select a checkpoint + its tuned generation defaults from
    SD_CHECKPOINTS, including a default width/height sized for that checkpoint. Any other
    key the caller passes explicitly (including width/height) overrides that style's defaults.
    """
    await _validate_sd_checkpoints()
    try:
        style = payload.pop("style", DEFAULT_STYLE)
        default_w, default_h = _style_default_size(style)
        defaults = {
            "width": default_w,
            "height": default_h,
            **_style_txt2img_params(style),
            "alwayson_scripts": {
                "ADetailer": {
                    "args": [
                        True,
                        {
                            "ad_model": "face_yolov8n.pt",
                            "ad_confidence": 0.3
                        }
                    ]
                }
            }
        }
        payload = {**defaults, **payload}
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(f"{SD_BASE}/sdapi/v1/txt2img", json=payload)
            if r.status_code != 200:
                raise HTTPException(r.status_code, f"SD returned {r.status_code}: {r.text[:500]}")
            data = r.json()
            return {"images": data.get("images", []), "info": data.get("info", "")}
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(503, "Stable Diffusion not reachable — is A1111 running on port 7860?")
    except httpx.TimeoutException:
        raise HTTPException(504, "Stable Diffusion timed out — try fewer steps or smaller size.")
    except Exception as e:
        raise HTTPException(500, f"SD error: {e}")

@router.post("/sd/img2img")
async def sd_proxy_img2img(payload: dict):
    """Proxy image-to-image request to Stable Diffusion."""
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(f"{SD_BASE}/sdapi/v1/img2img", json=payload)
            if r.status_code != 200:
                raise HTTPException(r.status_code, f"SD returned {r.status_code}: {r.text[:500]}")
            data = r.json()
            return {"images": data.get("images", []), "info": data.get("info", "")}
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(503, "Stable Diffusion not reachable — is A1111 running on port 7860?")
    except httpx.TimeoutException:
        raise HTTPException(504, "Stable Diffusion timed out — try fewer steps or smaller size.")
    except Exception as e:
        raise HTTPException(500, f"SD img2img error: {e}")

@router.get("/sd/models")
async def sd_proxy_models():
    """List available SD models/checkpoints."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{SD_BASE}/sdapi/v1/sd-models")
            return r.json()
    except Exception:
        return []


# ── Video tool jobs ───────────────────────────────────────────────────────────
# GPU video tools (SadTalker, AnimateDiff, LTX-2, Wan2.1) and Whisper transcription
# can take minutes — far too long for a single blocking HTTP request. Each one runs
# as a background asyncio task tracked in _jobs (backend/services/gpu_jobs.py,
# shared with backend/routers/video.py); the caller polls GET /jobs/{id} until
# status is "done" or "error", then fetches the file via GET /jobs/{id}/file
# (video tools) or reads result_text directly (whisper).

@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """GET /jobs/{id} — poll a running tool job's status/result."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"id": job_id, **job}


def _job_file_response(job_id: str, filename: str | None = None) -> FileResponse:
    job = _jobs.get(job_id)
    if not job or job["status"] != "done" or not job.get("result_path"):
        raise HTTPException(404, "Result not available")
    return FileResponse(job["result_path"], filename=filename)


@router.get("/jobs/{job_id}/file")
async def get_job_file(job_id: str):
    """GET /jobs/{id}/file — stream a completed job's result file (video/image),
    used for inline <video>/<img> previews."""
    return _job_file_response(job_id)


@router.get("/jobs/{job_id}/download/{filename}")
async def download_job_file(job_id: str, filename: str):
    """GET /jobs/{id}/download/{filename} — same file as /jobs/{id}/file, but
    with a real filename (with extension) as the URL's own last path segment.
    The desktop (Tauri) build's native download handler names saved files
    after the URL's last path segment, not the HTML anchor's `download`
    attribute — WebKitGTK/WebView2 don't expose that attribute to native code
    at all. Without this, every job download in the desktop app was landing
    in ~/Downloads as a single extensionless file literally named "file"
    (the last segment of /jobs/{id}/file), overwritten on every click."""
    return _job_file_response(job_id, filename)


@router.get("/spreadsheets/{filename}")
async def download_spreadsheet(filename: str):
    """GET /spreadsheets/{filename} — download a spreadsheet built by the
    generate_spreadsheet native tool (backend/services/spreadsheet_gen.py). No
    job/id indirection needed here (generation is synchronous, not GPU-queued) —
    filename itself is the UUID-suffixed identifier, sandboxed by
    resolve_download_path to that module's own output directory. Real filename as
    the URL's last path segment for the same reason as download_job_file above:
    the desktop build's native download handler names the file from that, not
    from an anchor's `download` attribute."""
    from backend.services.spreadsheet_gen import SpreadsheetError, resolve_download_path
    try:
        path = resolve_download_path(filename)
    except SpreadsheetError:
        raise HTTPException(404, "Spreadsheet not found")
    return FileResponse(
        path, filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ── SadTalker ──────────────────────────────────────────────────────────────────

@router.post("/sadtalker/jobs")
async def sadtalker_start_job(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    pose_style: int = Form(0),
    expression_scale: float = Form(1.0),
):
    """POST /sadtalker/jobs — start a talking-head render from a portrait + audio clip."""
    script = TOOLS["sadtalker"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "SadTalker script not found. Check scripts/run_sadtalker.py")

    tmp = tempfile.mkdtemp()
    img_ext = os.path.splitext(image.filename or "")[1] or ".jpg"
    aud_ext = os.path.splitext(audio.filename or "")[1] or ".wav"
    img_path = os.path.join(tmp, f"input_{uuid.uuid4().hex}{img_ext}")
    aud_path = os.path.join(tmp, f"audio_{uuid.uuid4().hex}{aud_ext}")
    with open(img_path, "wb") as f:
        shutil.copyfileobj(image.file, f)
    with open(aud_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    output_dir = TOOLS["sadtalker"].get(
        "output_dir", os.path.join(DATA_DIR, "triggers", "gpu_watch", "sadtalker_output"))
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("sadtalker")
    started_at = time.time()

    async def _run():
        try:
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "python3", script, img_path, aud_path,
                        "--output_dir", output_dir,
                        f"--pose_style={pose_style}",
                        f"--expression_scale={expression_scale}",
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    )
                    out, _ = await proc.communicate()
                finally:
                    await _restore_sd_vram_after_job()
            if proc.returncode != 0:
                # Tail, not head: tqdm progress bars dominate the start of the log
                # and can push the actual traceback past a few hundred characters.
                log = out.decode(errors="replace")
                if "can not detect the landmark" in log.lower():
                    # SadTalker's own face detector (0.97 confidence threshold)
                    # found no face at all — near-certainly a source-image
                    # problem, not a code/environment bug. Give the actual
                    # actionable reason instead of a 2000-char traceback dump.
                    _jobs[job_id].update(
                        status="error",
                        error="No face was detected in that photo. Try a clear, "
                              "front-facing, well-lit portrait — SadTalker's face "
                              "detector needs a real face plainly visible in the frame.")
                    return
                _jobs[job_id].update(status="error", error=log[-2000:])
                return
            result = _newest_file(output_dir, (".mp4",), started_at)
            if not result:
                _jobs[job_id].update(status="error", error="SadTalker finished but produced no video.")
                return
            _jobs[job_id].update(status="done", result_path=result)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── AnimateDiff ────────────────────────────────────────────────────────────────

_ANIMATEDIFF_DIR = external_paths.ANIMATEDIFF_DIR
_ANIMATEDIFF_PYTHON = os.path.join(_ANIMATEDIFF_DIR, "venv", "bin", "python")


@router.post("/animatediff/jobs")
async def animatediff_start_job(
    prompt: str = Form(...),
    negative_prompt: str = Form(""),
    steps: int = Form(25),
    frames: int = Form(16),
    width: int = Form(512),
    height: int = Form(512),
    seed: int = Form(-1),
):
    """POST /animatediff/jobs — start a text-prompt SD1.5 motion animation render."""
    script = TOOLS["animatediff"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "AnimateDiff wrapper script not found. Check scripts/run_anim.py")
    if not os.path.exists(_ANIMATEDIFF_PYTHON):
        raise HTTPException(
            404, f"AnimateDiff env not set up — expected {_ANIMATEDIFF_PYTHON}. "
                 f"Run: {TOOLS['animatediff']['install']}")

    output_dir = os.path.join(DATA_DIR, "triggers", "gpu_watch", "animatediff_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("animatediff")

    async def _run():
        try:
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "python3", script,
                        "--prompt", prompt,
                        "--negative_prompt", negative_prompt,
                        "--steps", str(steps),
                        "--frames", str(frames),
                        "--width", str(width),
                        "--height", str(height),
                        "--seed", str(seed),
                        "--output_dir", output_dir,
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    )
                    out, _ = await proc.communicate()
                finally:
                    await _restore_sd_vram_after_job()
            log = out.decode(errors="replace")
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=log[-2000:])
                return
            result_line = next((l for l in log.splitlines() if l.startswith("RESULT_PATH=")), None)
            result = result_line.split("=", 1)[1] if result_line else None
            if not result or not os.path.exists(result):
                _jobs[job_id].update(status="error", error="AnimateDiff finished but produced no output file.")
                return
            _jobs[job_id].update(status="done", result_path=result)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── Whisper ────────────────────────────────────────────────────────────────────

_WHISPER_PYTHON = external_paths.venv_python(external_paths.WHISPER_VENV)


@router.post("/whisper/jobs")
async def whisper_start_job(
    audio: UploadFile = File(...),
    model: str = Form("base"),
):
    """POST /whisper/jobs — transcribe an uploaded audio/video file."""
    script = TOOLS["whisper"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "Whisper wrapper script not found. Check scripts/run_whisper.py")
    if not os.path.exists(_WHISPER_PYTHON):
        raise HTTPException(
            404, f"Whisper env not set up — expected {_WHISPER_PYTHON}. "
                 f"Run: {TOOLS['whisper']['install']}")

    tmp = tempfile.mkdtemp()
    aud_ext = os.path.splitext(audio.filename or "")[1] or ".wav"
    aud_path = os.path.join(tmp, f"audio_{uuid.uuid4().hex}{aud_ext}")
    with open(aud_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    job_id = _new_job("whisper")

    async def _run():
        try:
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                proc = await asyncio.create_subprocess_exec(
                    "python3", script, aud_path,
                    "--model", model,
                    "--output_dir", tmp,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
            log = out.decode(errors="replace")
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=log[-2000:])
                return
            result_line = next((l for l in log.splitlines() if l.startswith("RESULT_PATH=")), None)
            result_path = result_line.split("=", 1)[1] if result_line else None
            if not result_path or not os.path.exists(result_path):
                _jobs[job_id].update(status="error", error="Whisper finished but produced no transcript.")
                return
            import json as _json
            with open(result_path) as f:
                data = _json.load(f)
            _jobs[job_id].update(status="done", result_text=data.get("text", "").strip())
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── LTX-2 (image/text → video) ──────────────────────────────────────────────────

@router.post("/ltx_video/jobs")
async def ltx_video_start_job(
    prompt: str = Form(...),
    negative_prompt: str = Form(""),
    image: Optional[UploadFile] = File(None),
    num_frames: int = Form(121),
    fps: float = Form(24.0),
    width: int = Form(768),
    height: int = Form(512),
    guidance_scale: Optional[float] = Form(None),
    guidance_rescale: Optional[float] = Form(None),
    num_inference_steps: Optional[int] = Form(None),
):
    """POST /ltx_video/jobs — start an LTX-2 text-to-video or image-to-video render.
    `guidance_scale` is optional (omit for diffusers' own default of 3.0) —
    image-to-video callers wanting more visible motion against the
    conditioning frame can push it higher, at the cost of more fine-detail
    flicker/warping; `guidance_rescale` (also optional, diffusers default
    0.0) tames that artifacting at a given guidance_scale.
    `num_inference_steps` (optional, diffusers default 50) trades render
    time for temporal smoothness."""
    script = TOOLS["ltx_video"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "LTX-2 wrapper script not found. Check scripts/run_ltxvideo.py")

    tmp = tempfile.mkdtemp()
    img_path = None
    if image is not None:
        img_ext = os.path.splitext(image.filename or "")[1] or ".jpg"
        img_path = os.path.join(tmp, f"input_{uuid.uuid4().hex}{img_ext}")
        with open(img_path, "wb") as f:
            shutil.copyfileobj(image.file, f)

    output_dir = os.path.join(DATA_DIR, "triggers", "gpu_watch", "ltx_video_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("ltx_video")
    started_at = time.time()

    async def _run():
        try:
            cmd = [
                sys.executable, script,
                "--prompt", prompt,
                "--negative_prompt", negative_prompt,
                "--num_frames", str(num_frames),
                "--fps", str(fps),
                "--width", str(width),
                "--height", str(height),
                "--output_dir", output_dir,
            ]
            if img_path:
                cmd += ["--image", img_path]
            if guidance_scale is not None:
                cmd += ["--guidance_scale", str(guidance_scale)]
            if guidance_rescale is not None:
                cmd += ["--guidance_rescale", str(guidance_rescale)]
            if num_inference_steps is not None:
                cmd += ["--num_inference_steps", str(num_inference_steps)]
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    proc = await asyncio.create_subprocess_exec(
                        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    )
                    out, _ = await proc.communicate()
                finally:
                    await _restore_sd_vram_after_job()
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                return
            result = _newest_file(output_dir, (".mp4",), started_at)
            if not result:
                _jobs[job_id].update(status="error", error="LTX-2 finished but produced no video.")
                return
            _jobs[job_id].update(status="done", result_path=result)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── Chatterbox (zero-shot voice cloning) ────────────────────────────────────────
# Runs in its own venv, not the main project one — see the "chatterbox" TOOLS
# entry's install string for why (torch/transformers version conflict with
# Wan2.1/LTX-Video's transformers<5 pin).
_CHATTERBOX_PYTHON = external_paths.venv_python(external_paths.CHATTERBOX_VENV)

# Named reference-clip library so a voice can be picked from a dropdown instead
# of re-uploading a file every time — one .wav per saved character voice.
VOICE_LIBRARY_DIR = os.path.join(DATA_DIR, "triggers", "gpu_watch", "chatterbox_voices")


def _voice_slug(name: str) -> str:
    """Sanitize a user-supplied voice name into a safe filename stem (no path traversal)."""
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-")
    if not slug:
        raise HTTPException(400, "Voice name can't be empty once sanitized to letters, numbers, - and _.")
    return slug


def _voice_path(name: str) -> str:
    return os.path.join(VOICE_LIBRARY_DIR, f"{_voice_slug(name)}.wav")


@router.get("/chatterbox/voices")
async def list_chatterbox_voices():
    """GET /chatterbox/voices — list saved reference-clip voices for the dropdown."""
    os.makedirs(VOICE_LIBRARY_DIR, exist_ok=True)
    voices = sorted(
        os.path.splitext(f)[0] for f in os.listdir(VOICE_LIBRARY_DIR) if f.endswith(".wav")
    )
    return {"voices": voices}


@router.post("/chatterbox/voices")
async def save_chatterbox_voice(
    name: str = Form(...),
    audio: UploadFile = File(...),
):
    """POST /chatterbox/voices — save a reference clip under a name so it shows up
    in the voice dropdown from then on. Overwrites any existing clip with the same name."""
    os.makedirs(VOICE_LIBRARY_DIR, exist_ok=True)
    path = _voice_path(name)
    with open(path, "wb") as f:
        shutil.copyfileobj(audio.file, f)
    return {"name": _voice_slug(name), "status": "saved"}


@router.delete("/chatterbox/voices/{name}")
async def delete_chatterbox_voice(name: str):
    """DELETE /chatterbox/voices/{name} — remove a saved voice from the library."""
    path = _voice_path(name)
    if not os.path.exists(path):
        raise HTTPException(404, f"No saved voice named '{name}'.")
    os.remove(path)
    return {"status": "deleted"}


@router.post("/chatterbox/jobs")
async def chatterbox_start_job(
    text: str = Form(...),
    reference_audio: Optional[UploadFile] = File(None),
    voice_name: Optional[str] = Form(None),
    exaggeration: float = Form(0.5),
    cfg_weight: float = Form(0.5),
):
    """POST /chatterbox/jobs — synthesize speech with Chatterbox TTS, optionally
    cloning a voice from a short reference clip (upload one directly via
    `reference_audio`, or pick a previously-saved one via `voice_name`)."""
    script = TOOLS["chatterbox"]["script"]
    if not os.path.exists(script):
        raise HTTPException(404, "Chatterbox wrapper script not found. Check scripts/run_chatterbox.py")
    if not os.path.exists(_CHATTERBOX_PYTHON):
        raise HTTPException(
            404, f"Chatterbox env not set up — expected {_CHATTERBOX_PYTHON}. "
                 f"Run: {TOOLS['chatterbox']['install']}")

    tmp = tempfile.mkdtemp()
    text_path = os.path.join(tmp, "script.txt")
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(text)

    ref_path = None
    if reference_audio is not None:
        ref_ext = os.path.splitext(reference_audio.filename or "")[1] or ".wav"
        ref_path = os.path.join(tmp, f"reference_{uuid.uuid4().hex}{ref_ext}")
        with open(ref_path, "wb") as f:
            shutil.copyfileobj(reference_audio.file, f)
    elif voice_name:
        saved_path = _voice_path(voice_name)
        if not os.path.exists(saved_path):
            raise HTTPException(404, f"No saved voice named '{voice_name}'.")
        ref_path = saved_path

    output_dir = os.path.join(DATA_DIR, "triggers", "gpu_watch", "chatterbox_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("chatterbox")

    async def _run():
        try:
            cmd = [
                _CHATTERBOX_PYTHON, script,
                "--text_file", text_path,
                "--exaggeration", str(exaggeration),
                "--cfg_weight", str(cfg_weight),
                "--output_dir", output_dir,
            ]
            if ref_path:
                cmd += ["--reference_audio", ref_path]
            # Chatterbox's autoregressive decoder occasionally samples an
            # out-of-vocab speech token, which crashes CUDA with a device-side
            # assert on the *next* step's embedding lookup — reproduced directly:
            # identical text + reference clip failed once, then succeeded twice
            # in a row with no other change. Each attempt is a fresh subprocess
            # (fresh random sample), so retry a few times on that specific
            # signature before giving up; any other failure fails immediately —
            # retrying it would just waste GPU time on a repeatable error.
            max_attempts = 3
            log, returncode = "", 1
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    for _attempt in range(max_attempts):
                        proc = await asyncio.create_subprocess_exec(
                            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                        )
                        out, _ = await proc.communicate()
                        log, returncode = out.decode(errors="replace"), proc.returncode
                        if returncode == 0 or "device-side assert" not in log:
                            break
                finally:
                    await _restore_sd_vram_after_job()
            if returncode != 0:
                if "device-side assert" in log:
                    _jobs[job_id].update(
                        status="error",
                        error=f"Chatterbox hit a CUDA sampling error {max_attempts} times in a row "
                              f"(a known upstream edge case in its autoregressive decoder — not specific "
                              f"to your text or reference clip). Try again.")
                else:
                    _jobs[job_id].update(status="error", error=log[-2000:])
                return
            result_line = next((l for l in log.splitlines() if l.startswith("RESULT_PATH=")), None)
            result = result_line.split("=", 1)[1] if result_line else None
            if not result or not os.path.exists(result):
                _jobs[job_id].update(status="error", error="Chatterbox finished but produced no audio file.")
                return
            _jobs[job_id].update(status="done", result_path=result)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            # On failure, keep the exact text + reference clip that triggered it
            # instead of deleting them — this crash has turned out to depend on
            # the specific input (not just be a rare random sampling fluke), and
            # the temp dir being wiped immediately made every prior failure
            # unreproducible after the fact.
            if _jobs.get(job_id, {}).get("status") == "error":
                debug_dir = os.path.join(
                    DATA_DIR, "triggers", "gpu_watch", "chatterbox_output", "_failed_inputs", job_id)
                try:
                    os.makedirs(os.path.dirname(debug_dir), exist_ok=True)
                    shutil.move(tmp, debug_dir)
                except Exception:
                    shutil.rmtree(tmp, ignore_errors=True)
            else:
                shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}
