#!/usr/bin/env python3
"""Merge the novelist LoRA adapter into the base model and register it with Ollama.

Task #10 in the improvement backlog, run once train.py has produced a checkpoint.

The merge itself runs on CPU in fp16/bf16 deliberately - loading the 8B base model
unquantized needs ~16GB, more than this machine's 12GB card has on its own, and
merging against a 4-bit-loaded copy isn't supported by peft's merge_and_unload
(dequantization back to a full-precision merge is what's actually wanted here anyway,
since quality/rounding from a 4-bit merge would be worse than doing it in bf16 once).
System RAM (62GB) comfortably fits it instead - slower, but a one-time cost.

Ollama (0.11+) can import directly from a HF-format safetensors directory via a
Modelfile `FROM <dir>` - it does the GGUF conversion/quantization internally, so this
script doesn't shell out to llama.cpp itself. If a future Ollama version drops that
support, the fallback is llama.cpp's convert_hf_to_gguf.py against MERGED_DIR.

Usage:
    source training/novelist/.venv/bin/activate
    python3 training/novelist/merge_and_deploy.py [--tag shai-novelist:v1]
"""
import argparse
import subprocess
from pathlib import Path

CORPUS_DIR = Path.home() / "Desktop" / "arynwood_sound_viedo" / "novelist-training-corpus"
ADAPTER_DIR = CORPUS_DIR / "checkpoints" / "novelist-lora-v1" / "final"
MERGED_DIR = CORPUS_DIR / "checkpoints" / "novelist-lora-v1" / "merged"

BASE_MODEL = "NousResearch/Hermes-3-Llama-3.1-8B"

CHATML_TEMPLATE = """TEMPLATE \"\"\"{{- if .Messages }}
{{- if or .System .Tools }}<|im_start|>system
{{- if .Tools }}
You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags. You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions. Here are the available tools: <tools>
{{- range .Tools }}
{"type": "function", "function": {{ .Function }}}
{{- end }}  </tools> Use the following pydantic model json schema for each tool call you will make: {"properties": {"arguments": {"title": "Arguments", "type": "object"}, "name": {"title": "Name", "type": "string"}}, "required": ["arguments", "name"], "title": "FunctionCall", "type": "object"} For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"arguments": <args-dict>, "name": <function-name>}
</tool_call>
{{- else if .System }}
{{ .System }}
{{- end }}<|im_end|>
{{ end }}
{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 -}}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ if .Content }}{{ .Content }}
{{- else if .ToolCalls }}<tool_call>
{{ range .ToolCalls }}{"name": "{{ .Function.Name }}", "arguments": {{ .Function.Arguments }}}
{{ end }}</tool_call>
{{- end }}{{ if not $last }}<|im_end|>
{{ end }}
{{- else if eq .Role "tool" }}<|im_start|>user
<tool_response>
{{ .Content }}
</tool_response><|im_end|>
{{ end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
{{ end }}
{{- end }}
{{- else }}
{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ end }}{{ .Response }}{{ if .Response }}<|im_end|>{{ end }}\"\"\"
PARAMETER stop <|im_start|>
PARAMETER stop <|im_end|>
PARAMETER num_ctx 16384
PARAMETER num_predict 400
# num_predict caps a single response at roughly 300 words. Tightened from an initial
# 600 (2026-08-12) after live testing showed the model doesn't reliably stop at a
# natural scene end on its own - a "write 150-250 words" scene ran a clean, complete
# paragraph, then kept going past `---` breaks into confused, unrelated continuations
# (the character drifting into being a real-world Discord community organizer rather
# than staying in Terminal Pulse). This is a base-model instruction-following gap, not
# something the style LoRA fixes - the training data was raw continued-pretraining
# text with no length-following signal. A tighter hard cap is a blunt but reliable
# mitigation; the same wellness-blog drift documented in the previous version of this
# comment (2026-08-11, an unbounded Dead Flowers generation) is the same failure mode.
# Chat callers can still ask for more and get a continuation.
"""
# ^ Identical to stock hermes3:8b's own template/stop-params (see `ollama show
# hermes3:8b --modelfile`) - same base tokenizer, so it applies unchanged. This
# matters: Ollama's auto-import from a HF safetensors directory does NOT reliably
# carry over the source model's chat template or stop tokens - importing
# merge_and_deploy's output without this produced a bare `TEMPLATE {{ .Prompt }}`
# with zero stop parameters, so the model never emitted a recognizable stop sequence
# and generation would run past any reasonable length instead of ending (looked like
# a hang - confirmed via nvidia-smi showing real GPU compute the whole time, not an
# actual stall). Always pin the template explicitly rather than trusting the importer.


def modelfile_text(merged_dir: Path) -> str:
    return f"FROM {merged_dir}\n" + CHATML_TEMPLATE


def merge(adapter_dir: Path):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if MERGED_DIR.is_dir() and any(MERGED_DIR.iterdir()):
        print(f"[skip] {MERGED_DIR} already populated - delete it to re-merge.")
        return

    print(f"Loading base model {BASE_MODEL} on CPU in bf16 (this is the slow step)...")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, torch_dtype=torch.bfloat16, device_map="cpu",
    )
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

    print(f"Applying LoRA adapter from {adapter_dir}...")
    merged = PeftModel.from_pretrained(base, str(adapter_dir))
    merged = merged.merge_and_unload()

    MERGED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Saving merged model to {MERGED_DIR}...")
    merged.save_pretrained(str(MERGED_DIR), safe_serialization=True)
    tokenizer.save_pretrained(str(MERGED_DIR))
    _fix_rope_config_schema(MERGED_DIR / "config.json")
    print("Merge complete.")


def _fix_rope_config_schema(config_path: Path):
    """Restore the legacy rope_scaling/rope_theta config.json schema.

    transformers 5.14.1 (this venv) writes RoPE config under a new unified
    `rope_parameters` key instead of the legacy top-level `rope_theta` float +
    `rope_scaling` dict. Ollama's safetensors importer doesn't recognize the new
    key, silently falls back to defaults (wrong theta, no Llama-3 NTK scaling),
    and the resulting model produces garbled, near-random output that gets worse
    as the prompt gets longer - confirmed 2026-08-12 by reproducing it directly
    against Ollama with the app's actual (long) system prompt: coherent on a short
    test prompt, garbage (including a slur) on Shai's real ~3500-token prompt.
    Short-prompt testing during development did not catch this - always test
    with a realistically long prompt before considering a merge trustworthy.
    """
    import json
    config = json.loads(config_path.read_text())
    rp = config.pop("rope_parameters", None)
    if rp is None:
        return
    config["rope_theta"] = rp["rope_theta"]
    config["rope_scaling"] = {
        k: v for k, v in rp.items() if k != "rope_theta"
    }
    config_path.write_text(json.dumps(config, indent=2))
    print(f"Patched {config_path}: rope_parameters -> legacy rope_scaling/rope_theta schema.")


def ollama_create(tag: str, quantize: str):
    modelfile_path = MERGED_DIR / "Modelfile"
    modelfile_path.write_text(modelfile_text(MERGED_DIR))
    print(f"Wrote {modelfile_path}")

    cmd = ["ollama", "create", tag, "-f", str(modelfile_path)]
    if quantize:
        cmd += ["-q", quantize]
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)
        raise RuntimeError(f"ollama create failed (exit {result.returncode})")
    print(f"\nDone. Registered with Ollama as '{tag}'.")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tag", default="shai-novelist:v1")
    ap.add_argument("--adapter-dir", type=Path, default=ADAPTER_DIR,
                     help="Which checkpoint to merge - defaults to final/, but the best "
                          "epoch per eval_checkpoints.py isn't always the last one (e.g. "
                          "pass .../checkpoints/novelist-lora-v1/checkpoint-30).")
    ap.add_argument("--quantize", default="q4_K_M",
                     help="Quantization level (matches stock hermes3:8b's footprint "
                          "so it fits this machine's 12GB card without CPU offload). "
                          "Pass '' to keep full F16.")
    args = ap.parse_args()

    merge(args.adapter_dir)
    ollama_create(args.tag, args.quantize)


if __name__ == "__main__":
    main()
