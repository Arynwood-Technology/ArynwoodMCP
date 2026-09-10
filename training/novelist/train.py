#!/usr/bin/env python3
"""QLoRA fine-tune for the novelist persona's voice, on the dataset from prepare_dataset.py.

NOT wired to run automatically - this is deliberately a standalone script the user (or a
backend job endpoint, later) invokes explicitly. A training run monopolizes the only GPU
on this machine for an extended period and will contend with Stable Diffusion / other GPU
tools, so kicking it off is a decision left to whoever calls this, not something this file
does on import.

Base model: NousResearch/Hermes-3-Llama-3.1-8B
  https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B
Chosen over a bare-abliterated checkpoint (the original pick here) because Terminal
Pulse is an explicitly "high-heat" romance (see the author's own style_guide_base.md)
and the priority is craft, not just permission. Abliteration alone only removes
refusals - it adds nothing. Hermes 3 is an actual fine-tune curated toward permissive,
creative, roleplay-capable behavior (strong voice differentiation, reads as a
collaborator rather than a chat bot, few arbitrary refusals) - a better foundation to
then LoRA-tune on the manuscript corpus for voice. Uses ChatML at inference time;
irrelevant to this training pass since the dataset is raw continued-pretraining text,
not chat-formatted turns.

Usage (once you're ready to actually run it):
    source training/novelist/.venv/bin/activate
    python3 training/novelist/train.py

Unloads A1111's checkpoint before training and reloads it after (see
_free_a1111_vram/_restore_a1111 below) - A1111 sits resident at ~7.5GB even
idle, which is most of this 12GB card's headroom, and this script is meant to
be kicked off and walked away from (e.g. overnight), so it can't rely on a
human noticing an OOM and manually freeing VRAM the way an interactive SD
generate can. Self-contained rather than importing gpu_queue's version from
the main app, since this runs in its own dedicated venv (training/novelist/.venv,
separate from the main app's venv) specifically so the heavy ML deps here don't
bloat/conflict with it - see requirements.txt.
"""
import json
import time
from pathlib import Path

import httpx

CORPUS_DIR = Path.home() / "Desktop" / "arynwood_sound_viedo" / "novelist-training-corpus"
DATASET_PATH = CORPUS_DIR / "dataset.jsonl"
OUTPUT_DIR = CORPUS_DIR / "checkpoints" / "novelist-lora-v1"

BASE_MODEL = "NousResearch/Hermes-3-Llama-3.1-8B"

SD_BASE = "http://localhost:7860"


def _free_a1111_vram():
    """Unload A1111's checkpoint and verify the VRAM was actually released.

    Mirrors backend/services/gpu_jobs.py's _free_sd_vram_for_job - duplicated
    rather than imported since that lives in the main app's venv, not this one.
    """
    try:
        with httpx.Client(timeout=30.0) as client:
            client.post(f"{SD_BASE}/sdapi/v1/unload-checkpoint").raise_for_status()
    except httpx.ConnectError:
        print("A1111 not reachable - nothing to free, proceeding.")
        return
    except Exception as exc:
        raise RuntimeError(f"Could not unload Stable Diffusion before training: {exc}") from exc

    time.sleep(1)
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{SD_BASE}/sdapi/v1/memory")
            r.raise_for_status()
        active_bytes = int(r.json().get("cuda", {}).get("active", {}).get("current", 0))
    except Exception as exc:
        raise RuntimeError(f"A1111 unloaded but GPU memory could not be verified: {exc}") from exc
    if active_bytes > 1_000_000_000:
        raise RuntimeError(
            f"A1111 is still holding {active_bytes / 1024**3:.1f} GB of VRAM after unload. "
            "Restart it (docker restart a1111) before running training."
        )
    print("A1111 VRAM freed - clear to train.")


def _restore_a1111():
    try:
        with httpx.Client(timeout=60.0) as client:
            client.post(f"{SD_BASE}/sdapi/v1/reload-checkpoint").raise_for_status()
        print("A1111 checkpoint reloaded.")
    except Exception as exc:
        print(f"Note: could not reload A1111's checkpoint automatically ({exc}). "
              "It'll reload on its own next request, or restart the container if it doesn't.")

# Rank 32 (bumped 2026-08-09 from an initial rank-16 pass, see git history) - the
# rank-16/3-epoch pass produced real but modest signal (clean line-broken verse
# transfer on Dead Flowers, subtler tightening on Terminal Pulse prose). More
# capacity plus more epochs should pull harder on the same 43 examples without
# necessarily overfitting, but there's no validation set to prove that automatically -
# save_strategy="epoch" below means every epoch gets its own checkpoint, and
# eval_checkpoints.py generates samples from each one so the actual training loop's
# output gets compared and picked from, rather than blindly trusting the final epoch.
LORA_CONFIG = dict(
    r=32,
    lora_alpha=64,
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    bias="none",
    task_type="CAUSAL_LM",
)

TRAINING_CONFIG = dict(
    num_train_epochs=7,   # bumped from 5 (2026-08-11) - loss/accuracy were still improving
                           # cleanly at epoch 5 (no plateau, no overfitting symptoms in
                           # generated samples), so there was room to keep pulling on the
                           # same 43 examples rather than stopping early
    per_device_train_batch_size=1,
    gradient_accumulation_steps=8,   # effective batch size 8, within 12GB via 4-bit + grad checkpointing
    learning_rate=2e-4,
    warmup_ratio=0.05,
    logging_steps=1,
    save_strategy="epoch",
    bf16=True,
    gradient_checkpointing=True,
    optim="paged_adamw_8bit",       # keeps optimizer states off the GPU under memory pressure
    report_to="none",
)


def load_dataset_examples() -> list[dict]:
    if not DATASET_PATH.is_file():
        raise FileNotFoundError(
            f"{DATASET_PATH} not found - run prepare_dataset.py first "
            "(see training/novelist/prepare_dataset.py)."
        )
    with open(DATASET_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def train():
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    examples = load_dataset_examples()
    print(f"Loaded {len(examples)} training examples from {DATASET_PATH}")
    dataset = Dataset.from_list(examples)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    print(f"Loading base model {BASE_MODEL} in 4-bit...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb_config, device_map="auto",
    )
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, LoraConfig(**LORA_CONFIG))
    model.print_trainable_parameters()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sft_config = SFTConfig(
        output_dir=str(OUTPUT_DIR),
        dataset_text_field="text",
        max_length=2560,  # ~1800-word chunks + overlap comfortably fit
        **TRAINING_CONFIG,
    )
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=sft_config,
        processing_class=tokenizer,
    )

    print("Starting training...")
    trainer.train()

    final_path = OUTPUT_DIR / "final"
    trainer.save_model(str(final_path))
    tokenizer.save_pretrained(str(final_path))
    print(f"\nDone. LoRA adapter saved to {final_path}")
    print("Next: merge + convert to GGUF and `ollama create` it (task #10).")


if __name__ == "__main__":
    _free_a1111_vram()
    try:
        train()
    finally:
        _restore_a1111()

# ── GPU queue integration (for task #10's backend wiring, not used standalone) ─────────
#
# When this is triggered from the backend instead of run directly, it must go through
# gpu_queue exactly like image LoRA training does in routers/lora.py:
#
#   from backend.services.gpu_jobs import gpu_queue, _free_sd_vram_for_job, _restore_sd_vram_after_job
#   async with gpu_queue.acquire(job_id):
#       await _free_sd_vram_for_job()   # unloads A1111's checkpoint first
#       try:
#           await asyncio.get_event_loop().run_in_executor(None, train)  # train() is sync/blocking
#       finally:
#           await _restore_sd_vram_after_job()
#
# This is what actually prevents the OOM/checkpoint-corruption class of bug from task #3
# during a training run - without it, a concurrent SD request could land while the base
# model has already claimed most of the card's 12GB.
