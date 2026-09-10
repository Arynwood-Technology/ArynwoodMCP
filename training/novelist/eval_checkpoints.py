#!/usr/bin/env python3
"""Generate comparison samples from every per-epoch checkpoint train.py saved.

train.py's save_strategy="epoch" already writes a checkpoint-{step} directory per
epoch under OUTPUT_DIR - this script is the "check the loss curve manually before
assuming the final epoch is best" step train.py's own docstring calls for, but as
actual generated samples rather than just loss numbers (loss alone doesn't reveal
overfitting symptoms like verbatim manuscript regurgitation or repetition loops on a
dataset this small).

Loads the 4-bit base model once, then swaps the LoRA adapter in per checkpoint - much
faster than round-tripping each candidate through merge/GGUF/ollama create, which is
only worth doing once, for whichever checkpoint this script says looks best.

Usage:
    source training/novelist/.venv/bin/activate
    python3 training/novelist/eval_checkpoints.py
"""
import re
from pathlib import Path

CORPUS_DIR = Path.home() / "Desktop" / "arynwood_sound_viedo" / "novelist-training-corpus"
OUTPUT_DIR = CORPUS_DIR / "checkpoints" / "novelist-lora-v1"
BASE_MODEL = "NousResearch/Hermes-3-Llama-3.1-8B"

PROMPTS = {
    "terminal_pulse": "Write a short scene (150-250 words): Neon is alone in her apartment at 3am, unable to sleep, aware of W1z's absence even though they've never met in person.",
    "dead_flowers": "Write a short piece of image-driven, line-broken prose-poetry (150-250 words) about grief, using flowers as the central image.",
}
SYS = "You are a fiction writer helping draft prose for the author's own manuscript."


def find_checkpoints() -> list[Path]:
    if not OUTPUT_DIR.is_dir():
        raise FileNotFoundError(f"{OUTPUT_DIR} not found - run train.py first.")
    checkpoints = [
        p for p in OUTPUT_DIR.iterdir()
        if p.is_dir() and re.match(r"checkpoint-\d+", p.name)
    ]
    return sorted(checkpoints, key=lambda p: int(p.name.split("-")[1]))


def main():
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    checkpoints = find_checkpoints()
    print(f"Found {len(checkpoints)} checkpoints: {[c.name for c in checkpoints]}\n")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    print(f"Loading base model {BASE_MODEL} in 4-bit (once, adapters swap in after)...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb_config, device_map="auto",
    )

    for ckpt in checkpoints:
        epoch_num = checkpoints.index(ckpt) + 1
        print(f"\n{'=' * 70}\nEPOCH {epoch_num} ({ckpt.name})\n{'=' * 70}")
        model = PeftModel.from_pretrained(base, str(ckpt))
        model.eval()

        for label, prompt in PROMPTS.items():
            messages = [
                {"role": "system", "content": SYS},
                {"role": "user", "content": prompt},
            ]
            prompt_text = tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, tokenize=False
            )
            inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
            with torch.no_grad():
                out = model.generate(
                    **inputs,
                    max_new_tokens=500,  # long enough to expose register drift on longer runs
                    do_sample=True,
                    temperature=0.8,
                    top_p=0.9,
                    pad_token_id=tokenizer.pad_token_id,
                )
            text = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
            print(f"\n--- {label} ---\n{text}")

        model.unload()  # detach this checkpoint's adapter, base stays loaded for the next one


if __name__ == "__main__":
    main()
