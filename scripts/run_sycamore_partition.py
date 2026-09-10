"""
Runs Sycamore's local PDF partitioner (DETR layout model + optional OCR/table
extraction, no Aryn Cloud account needed) and writes the result two ways:

  - <base>.md    flattened Markdown (sycamore.utils.markdown.elements_to_markdown),
                 kept for simple preview/back-compat use.
  - <base>.chunks.json
                 the same content grouped into page/table-aware chunks instead of
                 blindly re-cut by character count downstream — each chunk never
                 splits a table, and starts fresh at each Title/Section-header,
                 carrying page_start/page_end/has_table for the Qdrant payload.

Executed by the Sycamore dev checkout's own venv
(~/GitHub/sycamore/lib/sycamore/.venv/bin/python3), not the main project venv —
Sycamore's local-inference path pulls in its own torch/transformers/timm/easyocr/
paddleocr stack, same reasoning as scripts/run_whisper.py's separate whisper-venv.
"""

import argparse
import json
import os
import sys

CHUNK_SIZE = 1200  # matches backend/services/knowledge.py's CHUNK_SIZE for parity with the text-chunking path

HEADING_TYPES = {"title", "section-header"}


def group_elements_into_chunks(elements, chunk_size: int = CHUNK_SIZE) -> list[dict]:
    from sycamore.utils.markdown import elements_to_markdown

    chunks: list[dict] = []
    group: list = []
    group_chars = 0

    def flush():
        nonlocal group, group_chars
        if not group:
            return
        text = elements_to_markdown(group).strip()
        if text:
            pages = sorted({
                p for e in group
                if (p := e.properties.get("page_number")) is not None
            })
            chunks.append({
                "text": text,
                "page_start": pages[0] if pages else None,
                "page_end": pages[-1] if pages else None,
                "has_table": any(e.type == "table" for e in group),
            })
        group = []
        group_chars = 0

    for el in elements:
        el_type = (el.type or "").lower()
        el_text = el.text_representation or ""

        if el_type == "table":
            flush()  # tables never merge with surrounding text, or with each other
            group = [el]
            flush()
            continue

        if el_type in HEADING_TYPES and group:
            flush()  # a new heading starts a new chunk — natural section boundary

        if group and group_chars + len(el_text) > chunk_size:
            flush()

        group.append(el)
        group_chars += len(el_text)

    flush()
    return chunks


def run_partition(pdf_path: str, out_dir: str, use_ocr: bool, extract_tables: bool) -> tuple[str, str]:
    from sycamore.transforms.detr_partitioner import ArynPDFPartitioner
    from sycamore.utils.markdown import elements_to_markdown

    os.makedirs(out_dir, exist_ok=True)
    partitioner = ArynPDFPartitioner()
    with open(pdf_path, "rb") as f:
        elements = partitioner.partition_pdf(
            f,
            use_partitioning_service=False,
            use_ocr=use_ocr,
            extract_table_structure=extract_tables,
        )

    base = os.path.splitext(os.path.basename(pdf_path))[0]

    markdown = elements_to_markdown(elements)
    md_path = os.path.join(out_dir, f"{base}.md")
    with open(md_path, "w") as f:
        f.write(markdown)

    chunks = group_elements_into_chunks(elements)
    chunks_path = os.path.join(out_dir, f"{base}.chunks.json")
    with open(chunks_path, "w") as f:
        json.dump(chunks, f)

    page_numbers = [e.properties.get("page_number") for e in elements if e.properties.get("page_number")]
    print(f"ELEMENT_COUNT={len(elements)}", file=sys.stderr)
    print(f"CHUNK_COUNT={len(chunks)}", file=sys.stderr)
    print(f"PAGE_COUNT={max(page_numbers) if page_numbers else 0}", file=sys.stderr)
    return md_path, chunks_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--output_dir", required=True)
    # Defaults off: OCR measurably degrades output on documents that already have a
    # clean embedded text layer (see backend/routers/knowledge.py's sycamore/jobs
    # docstring) — only pass --ocr for genuinely scanned/image-only PDFs.
    parser.add_argument("--ocr", dest="ocr", action="store_true", default=False)
    parser.add_argument("--no-ocr", dest="ocr", action="store_false")
    parser.add_argument("--tables", dest="tables", action="store_true", default=True)
    parser.add_argument("--no-tables", dest="tables", action="store_false")
    args = parser.parse_args()

    result_path, chunks_path = run_partition(args.pdf, args.output_dir, args.ocr, args.tables)
    print(f"RESULT_PATH={result_path}")
    print(f"CHUNKS_PATH={chunks_path}")
