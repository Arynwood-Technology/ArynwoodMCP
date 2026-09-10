#!/usr/bin/env python3
"""Chunk the novelist training corpus into a JSONL dataset for causal-LM fine-tuning.

Style/voice LoRA fine-tunes on a personal corpus this size (~65k words total) work
best as continued-pretraining-style raw text chunks (one {"text": ...} example per
chunk, plain next-token prediction) rather than synthesized instruction/completion
pairs - there's no natural "prompt" half to a novel manuscript, and synthesizing one
would inject a second model's voice into the training signal.

Source corpus lives OUTSIDE this repo (~/Desktop/novelist-training-corpus/) and stays
there deliberately - these are unpublished manuscripts and this repo has a real GitHub
remote. Only this script is version-controlled; the corpus and its dataset.jsonl output
are not.
"""
import argparse
import json
import re
from pathlib import Path

DEFAULT_CORPUS_DIR = Path.home() / "Desktop" / "arynwood_sound_viedo" / "novelist-training-corpus"

# Rough words-per-token estimate for English prose (~0.75 tokens/word); chunk size
# is expressed in words for simplicity since no tokenizer is chosen yet (task #8).
CHUNK_WORDS = 1800   # ~2400 tokens - comfortably inside any modern base model's context
OVERLAP_WORDS = 150  # keeps scene transitions from being split with zero shared context


def chunk_manuscript(text: str, chunk_words: int = CHUNK_WORDS, overlap_words: int = OVERLAP_WORDS) -> list[str]:
    """Split on blank-line paragraph boundaries, then greedily pack paragraphs into chunks."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_words = 0

    for para in paragraphs:
        para_words = len(para.split())
        if current and current_words + para_words > chunk_words:
            chunks.append("\n\n".join(current))
            # carry the tail of the previous chunk forward for continuity
            overlap: list[str] = []
            overlap_count = 0
            for p in reversed(current):
                overlap_count += len(p.split())
                overlap.insert(0, p)
                if overlap_count >= overlap_words:
                    break
            current = overlap
            current_words = overlap_count
        current.append(para)
        current_words += para_words

    if current:
        chunks.append("\n\n".join(current))
    return chunks


def build_dataset(corpus_dir: Path) -> list[dict]:
    examples: list[dict] = []
    manuscripts = {
        "terminal_pulse": corpus_dir / "terminal_pulse" / "manuscript.txt",
        "dead_flowers": corpus_dir / "dead_flowers" / "manuscript.txt",
    }
    for source, path in manuscripts.items():
        if not path.is_file():
            print(f"[skip] {path} not found")
            continue
        text = path.read_text(encoding="utf-8")
        chunks = chunk_manuscript(text)
        for i, chunk in enumerate(chunks):
            examples.append({"text": chunk, "source": source, "chunk": i})
        print(f"[ok] {source}: {len(chunks)} chunks from {len(text.split())} words")
    return examples


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    ap.add_argument("--out", type=Path, default=None,
                     help="Defaults to <corpus-dir>/dataset.jsonl")
    args = ap.parse_args()
    out_path = args.out or (args.corpus_dir / "dataset.jsonl")

    examples = build_dataset(args.corpus_dir)
    with open(out_path, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    total_words = sum(len(ex["text"].split()) for ex in examples)
    print(f"\nWrote {len(examples)} examples ({total_words} words) -> {out_path}")


if __name__ == "__main__":
    main()
