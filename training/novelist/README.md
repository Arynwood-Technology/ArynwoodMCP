# Novelist persona fine-tuning pipeline

Builds `shai-novelist:v1`, the local Ollama model behind the `shai` persona
(`mcp/config/models.json`) — a LoRA fine-tune of Hermes 3 8B on the author's own
manuscript prose, so the persona's *voice* matches her actual writing, not just its
*knowledge* of the story (that part is handled separately, in the persona's system
prompt — see "System prompt vs. fine-tune" below).

## Pipeline

Run in order, from the repo root, with the dedicated venv active:

```bash
source training/novelist/.venv/bin/activate

python3 training/novelist/prepare_dataset.py      # manuscripts -> dataset.jsonl
python3 training/novelist/train.py                # QLoRA fine-tune, saves a checkpoint per epoch
python3 training/novelist/eval_checkpoints.py      # generates samples from every epoch checkpoint
python3 training/novelist/merge_and_deploy.py \
    --adapter-dir <path/to/best/checkpoint-N>      # merge into base + register with Ollama
```

- **`prepare_dataset.py`** — chunks the manuscripts into `dataset.jsonl` (paragraph-aware,
  ~1800-word chunks, 150-word overlap). Corpus lives outside the repo at
  `~/Desktop/arynwood_sound_viedo/novelist-training-corpus/` (unpublished manuscripts,
  and this repo has a real GitHub remote) — re-run this any time the source manuscripts
  change.
- **`train.py`** — QLoRA fine-tune (rank 32, alpha 64, 7 epochs as of the current config;
  see `LORA_CONFIG`/`TRAINING_CONFIG` at the top of the file). Saves a checkpoint after
  every epoch (`save_strategy="epoch"`) — **do not assume the final epoch is the best
  one**, see "Picking a checkpoint" below.
- **`eval_checkpoints.py`** — loads the 4-bit base once and swaps each epoch's adapter
  in to generate the same test prompts from every checkpoint, so you can actually read
  the output and pick a checkpoint instead of trusting the loss curve alone.
- **`merge_and_deploy.py`** — merges a chosen adapter checkpoint into the base model
  (full precision, on CPU — see "Why CPU" below) and registers it with Ollama as
  `shai-novelist:v1` (`--tag` to change). Handles two non-obvious fixes that a naive
  merge/import misses entirely (see below) — **do not hand-roll a merge without these**.

## System prompt vs. fine-tune — two different jobs

Don't expect the fine-tune to carry story knowledge. It was trained on raw manuscript
text (continued-pretraining style, not instruction-tuned pairs — there's no natural
"prompt" half to a novel), so it absorbs *voice and rhythm*, not facts you can query it
for. Character bible, plot architecture, and craft rules live in the `shai`/`chai`
persona's `system` field in `mcp/config/models.json` instead — pulled directly from
`~/Desktop/arynwood_sound_viedo/novelist-training-corpus/terminal_pulse/style_guide_base.md`
/`style_guide_extended.md` and `terminal_pulse/character_notes/*.md`. If Shai doesn't
know something about the story, that's a system-prompt gap, not a training-data gap —
adding more examples to the corpus won't fix it.

## Picking a checkpoint — don't trust the last epoch blindly

`eval_checkpoints.py` exists because loss going down doesn't mean the output is
getting better on a dataset this small (43 examples). The current deployed model uses
**checkpoint-30 (epoch 5 of 7)**, not the final epoch, based on reading actual
generated samples:

- Epochs 1–2: real repetition-collapse failures (a sentence looping verbatim 5-6x) —
  typical early-training instability on tiny data, self-resolves.
- Epochs 3–5: clean, no red flags, strongest and most complete samples.
- Epoch 6: a stutter/repetition glitch reappeared (3x near-identical sentence before
  self-correcting) — a sign pushing epochs further was starting to cost stability.
- Epoch 7 (final): still high quality but took unpredictable structural risks (an
  unexplained POV shift, an odd mid-scene break).

Read the actual `eval_checkpoints.py` output before choosing — don't just eyeball the
loss numbers, and don't assume higher accuracy is strictly better (a jump from ~0.66 to
~0.81 mean-token-accuracy between the 5-epoch and 7-epoch runs was the signal to look
harder for overfitting, not a reason to celebrate).

## Two merge bugs that will silently break the deployed model

Both of these produce output that looks *plausible* at a glance (or works fine on short
test prompts) and only reveals itself as broken under different conditions. Both are
already fixed in `merge_and_deploy.py` — this section exists so nobody "fixes" them
back out during a future edit.

**1. RoPE config schema mismatch (the serious one).** `transformers` 5.14.1 (this
venv's version) writes the merged model's positional-encoding config under a new
unified `rope_parameters` key instead of the legacy top-level `rope_theta` +
`rope_scaling` that Ollama's safetensors importer expects. Ollama silently falls back
to wrong defaults instead of erroring. The result: **coherent output on short prompts,
garbled/repetitive/incoherent output (including outright toxic tokens, seen in testing)
on longer ones** — this app's actual system prompt is ~3500 tokens, long enough to
trigger it badly, while a quick manual smoke-test with a short prompt will look
completely fine and hide the bug. `merge_and_deploy.py`'s `_fix_rope_config_schema()`
patches `config.json` back to the legacy schema after every merge. **Always test a
merged model against the actual full-length system prompt it'll run with in production
before trusting it** — a short test prompt is not sufficient evidence.

**2. Missing chat template on import.** Ollama's auto-import from a HF safetensors
directory does not reliably carry over the source model's chat template or stop
tokens. An unpatched import produces a bare `TEMPLATE {{ .Prompt }}` with zero stop
parameters, so the model never emits a recognizable stop sequence and generation runs
until it hits `num_predict` instead of ending naturally (looks like a hang; confirmed
via `nvidia-smi` it's genuinely computing the whole time, not stalled).
`merge_and_deploy.py` always pins Hermes 3's actual ChatML template + stop tokens
explicitly (`CHATML_TEMPLATE`, copied from `ollama show hermes3:8b --modelfile` — same
base tokenizer, so it applies unchanged) rather than trusting the importer.

## Known model limitation: doesn't reliably stop at a natural scene end

Even on a clean checkpoint, the model doesn't reliably recognize when a scene is
"done." A "write 150–250 words" prompt produced one complete, on-voice paragraph, then
kept going past `---` breaks into confused, unrelated continuations. This is a
base-model instruction-following gap, not something the style LoRA fixes (the training
data has no length-following signal — it's raw prose, not instruction/response pairs).
Mitigation: `merge_and_deploy.py`'s Modelfile sets `PARAMETER num_predict 400` (~300
words) as a blunt but reliable cap. This doesn't fix the underlying tendency, just
prevents the worst of it; if a scene needs to run longer, ask for a continuation rather
than raising the cap globally.

## Why the merge runs on CPU

Loading the 8B base model unquantized (bf16, required for a clean merge — merging
against a 4-bit-loaded copy isn't supported by `peft`'s `merge_and_unload`, and
quality/rounding from a 4-bit merge would be worse anyway) needs ~16GB, more than this
machine's 12GB card has alone. System RAM (62GB) comfortably fits it instead — slower,
but a one-time cost per checkpoint merged.

## A1111 coordination — read before running anything here

This machine has one 12GB GPU shared with Automatic1111 (Stable Diffusion). Any script
in this pipeline that needs real headroom (`train.py`, `eval_checkpoints.py`,
`merge_and_deploy.py`) should be run with A1111 **fully stopped**, not just
checkpoint-unloaded:

```bash
curl -s http://localhost:7860/sdapi/v1/progress   # confirm no job is running first!
docker stop a1111
# ... run the training/eval/merge script ...
docker start a1111
```

`train.py`'s own `_free_a1111_vram()` only calls A1111's `/sdapi/v1/unload-checkpoint`
endpoint, which still leaves ~1.4GB of baseline VRAM resident (enough to push a rank-32
training run into an OOM that a rank-16 run wouldn't hit) — and that same endpoint (and
`/sdapi/v1/reload-checkpoint`) intermittently 500s with an `AttributeError` if A1111's
gotten into a wedged state (see the repo's own `CLAUDE.md` Known Issues). Fully
stopping the container sidesteps both problems at once, and `_free_a1111_vram()` treats
"A1111 unreachable" as success (prints a note, proceeds) — no code changes needed, just
remember to stop it first. **Always check `/sdapi/v1/progress` for an active job before
stopping the container** — `docker stop` sends SIGKILL if the process doesn't exit
promptly, and will kill a real in-progress generation.

## `chai` — the same persona on stock Hermes

`chai` (`mcp/config/models.json`) shares Shai's exact system prompt (character bible,
craft rules, permissions) but runs plain `hermes3:8b` instead of
`shai-novelist:v1`. It exists because the fine-tune's training data — *Terminal
Pulse*'s own "sexy through restraint, nothing explicit" style — measurably pulls the
model away from fully explicit content even though the system prompt authorizes it.
Stock Hermes 3 has no such bias. If Shai is underdelivering on an explicit scene, that's
expected behavior from the fine-tune, not a bug to chase — reach for `chai` instead.
