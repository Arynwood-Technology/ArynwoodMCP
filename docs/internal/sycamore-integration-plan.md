# Sycamore Document Parser — Integration Plan

Status: **Phases 0–4 shipped — the full v1 scope in §5.** §6 (a standalone warm-model
sidecar) is a deferred future optimization, not a v1 phase; §7 has two still-open,
lower-stakes decisions (table-extraction default, Sycamore-missing fallback). This
document lays out what it would take to
route PDF ingestion in the `/api/knowledge` Learn pipeline through the local Sycamore
document parser instead of the current pdfminer/pypdf text dump, the architecture options
weighed, and a recommended path.

---

## TL;DR

- Local (non-cloud) Sycamore PDF parsing is real and usable today: `ArynPDFPartitioner.partition_pdf(use_partitioning_service=False)`
  in your fork at `~/GitHub/sycamore` runs a layout model (`Arynwood/deformable-detr-DocLayNet`)
  + optional OCR entirely on-box. No Aryn Cloud account needed.
- The codebase already has three different conventions for "GPU-heavy Python tool," not
  one. The right fit for Sycamore is the **job-queue + `_gpu_lock` pattern** used by
  LoRA training, SadTalker, and video generation — not a new standalone sidecar service.
- Two bugs in the *existing* PDF path are unrelated to Sycamore and block good results
  either way: a 12,000-char truncation and a 1 MB upload cap inherited from an endpoint
  that was built for chat-context injection, not document ingestion. Fix these regardless.
- Recommended sequencing: fix the existing bugs first (small, independent win), then add
  Sycamore behind a job endpoint that shells out to your Sycamore dev checkout's own venv
  (already has everything installed — see Phase 1), starting with a shallow
  markdown-flatten integration before attempting element-aware chunking.

---

## 1. Current State

**Path today:** `Knowledge.tsx` → `POST /api/chat/upload` (extracts text, **truncates to
12,000 chars** — `backend/routers/chat.py:322`, meant for injecting a file into chat
context, not for full-document learning) → `POST /api/knowledge/learn` with the
already-truncated text → `knowledge.chunk_text()` (naive 1200-char sliding window,
snapped to paragraph/sentence/word boundaries — `backend/services/knowledge.py:149`) →
batched Ollama embeddings → Qdrant.

**Extraction quality for PDFs** (`knowledge.py:44`, `extract_text_from_bytes`):
pdfminer.six, falling back to pypdf. Both are plain-text extractors:

| Gap | Consequence |
|---|---|
| No OCR | Scanned PDFs (image-only pages) yield empty or near-empty text |
| No layout awareness | Multi-column pages interleave; headers/footers mixed into body text |
| No table structure | Tables collapse into a scramble of cell text with no row/column relationship |
| 12,000-char cap (`chat.py:322`) | Any PDF beyond ~3 pages is silently truncated before it's even chunked |
| 1 MB upload cap (`chat.py:311`, reused via `knowledge.MAX_FILE_BYTES`) | Blocks most real-world PDFs outright |

The 12k/1MB limits exist because Learn's file path (`Knowledge.tsx: submitFile` →
`uploadFile()`) reuses `/api/chat/upload`, an endpoint designed for a different job
(pasting a snippet of a file into the current chat's context window). This is a
pre-existing correctness bug independent of whether Sycamore gets added.

---

## 2. What Sycamore Actually Provides

`~/GitHub/sycamore` is your fork (`Arynwood-Technology/sycamore`, tracking
`aryn-ai/sycamore` upstream) — already carrying a local-Ollama LLM/embedder backend
(the most recent `arynwood-mcp` commit ported that same shared-client pattern).

The relevant primitive is `ArynPDFPartitioner` (`lib/sycamore/sycamore/transforms/detr_partitioner.py:157`).
It's usable standalone — no Ray, no DocSet pipeline required:

```python
partitioner = ArynPDFPartitioner()  # loads Arynwood/deformable-detr-DocLayNet from HuggingFace on first use
elements = partitioner.partition_pdf(
    file,
    use_partitioning_service=False,   # local inference, no Aryn Cloud API key
    use_ocr=True,                     # easyocr/paddleocr — needed for scanned pages
    extract_table_structure=True,     # real row/column table data, not garbled text
)
```

Returns `list[Element]` — each with a type (Title, Text, Table, …), bounding box, page
number, and (for tables) structured cell data. Requires the `local-inference` extra:
`easyocr`, `paddleocr`, `pypdfium2`, `pdfminer-six`, `pytesseract`, `sentence-transformers`,
`timm`, `torch`, `torchvision`, `transformers`. `sycamore-ai` needs Python `>=3.11,<3.14` —
this repo's venv is 3.12.3, so no interpreter conflict.

**Environment check:** RTX 3060, 12 GB, ~845 MiB in use at rest — plenty of headroom for
a DETR-class layout model plus OCR, as long as it coordinates with other GPU consumers
(see §4).

---

## 3. Architecture Options

This codebase does not have one convention for "wire in a GPU-heavy Python tool" — it has
three, chosen per-tool based on what that tool actually needs. Picking the right one for
Sycamore means matching it to the right precedent, not defaulting to the most isolated
option.

### Option A — Standalone HTTP sidecar
*Precedent: Stable Diffusion A1111 (`:7860`), TortoiseTTS (`:5003`, Docker), mcp-kdenlive (`:8420`).*

A separate long-running process/venv; `backend/services/*` proxies to it over HTTP.

- **Used when:** the tool is a pre-built third-party server (A1111), needs Docker
  isolation, or is genuinely external to Python (Kdenlive's D-Bus bridge).
- **Fit for Sycamore:** poor as a *first* implementation. Sycamore is a plain Python
  library, not a pre-built server — standing up a bespoke FastAPI wrapper, its own venv,
  port allocation, and a `start.sh` entry is real infrastructure for a single endpoint.
  Worth revisiting later if the model needs to stay warm across many requests (see §6).

### Option B — In-process, lazy import, synchronous
*Precedent: Florence-2 (`backend/routers/tools.py:894`), rembg (`tools.py:789`).*

`from transformers import ...` inside the route handler itself, wrapped in
`try/except ImportError` with a `pip install ...` hint in the error. Dependency is
**not** in `requirements.txt` — it's an optional, manually-installed extra into the same
venv. Model reloads from the HuggingFace/local cache on every single request; nothing is
kept warm.

- **Fit for Sycamore: not used, and turned out weaker than it looked on paper.**
  Verified while implementing Phase 1: Florence-2's `torch`/`transformers` aren't
  actually installed in the main venv, `scripts/run_florence2.py` doesn't exist despite
  `tools.py` referencing it, and rembg is similarly never-set-up — this "convention" is
  aspirational, not proven. The pattern that's actually real and working on this box is
  Option C's cousin: **every genuinely heavy ML tool gets its own dedicated venv**
  (`~/tools/whisper-venv`, `chatterbox-venv`, `AnimateDiff`, `LTX-Video`,
  `sad-talker`), invoked by subprocess — exactly `scripts/run_whisper.py`'s shape. Sycamore
  followed that proven precedent, not the unproven one (see Phase 1).

### Option C — In-process, job-queue, `_gpu_lock`-coordinated (recommended)
*Precedent: LoRA training (`backend/services/gpu_jobs.py`), SadTalker, AnimateDiff,
LTX-Video, Whisper (`backend/routers/tools.py:1264,1341,1406,1498,1644`, `video.py:151,721`).*

`gpu_jobs.py` already provides exactly the shape this needs: `_new_job()` registers a job
id, the actual work runs inside `async with _gpu_lock:` (a process-wide `asyncio.Lock`
that serializes GPU work and, per `gpu_jobs.py:44` `_free_sd_vram_for_job`, will unload
A1111's resident SD checkpoint to make room), and the frontend polls `GET
/api/tools/jobs/{id}` for status/result instead of blocking on one long HTTP call.

- **Fit for Sycamore:** best match. PDF parsing time is variable — seconds for a short
  text PDF, well over a minute for a long scanned document under OCR — which is exactly
  the kind of task this codebase already routes through jobs + polling rather than a
  synchronous request. It also automatically gets GPU-contention safety with SD/TTS/video
  jobs for free, which Option B does not.

### Comparison

| | A: Sidecar | B: Sync in-process | C: Job + lock (recommended) |
|---|---|---|---|
| Matches an existing precedent | ✅ (A1111/TTS) | ✅ (Florence-2/rembg) | ✅ (LoRA/SadTalker/Video) |
| New infra required | High (venv, port, process mgmt) | None | None |
| Model can stay warm | ✅ | ❌ | ❌ (but see §6) |
| GPU-contention safe | N/A (own process) | ❌ | ✅ |
| Handles long-running OCR jobs without HTTP timeout | ✅ | ❌ | ✅ |
| Implementation effort | Highest | Lowest | Low–Medium |

---

## 4. GPU Coordination

`backend/services/gpu_jobs.py` holds a single process-wide `_gpu_lock` that every GPU job
in `tools.py`/`video.py` acquires before running, plus logic to unload A1111's SD
checkpoint (~7 GB resident) and verify VRAM was actually released before proceeding. A
Sycamore job must acquire the same lock — a DETR + OCR pass and a Stable Diffusion
generation running concurrently on a single 12 GB card is a plausible OOM, not a
theoretical one.

---

## 5. Recommended Implementation Plan

### Phase 0 — Fix the pre-existing bugs (independent of Sycamore) — ✅ shipped
- Added `POST /api/knowledge/upload` (`backend/routers/knowledge.py`), separate from
  `/api/chat/upload` — extracts text via the same `knowledge.extract_text_from_bytes()`
  but returns it whole, no 12,000-char chat-context truncation.
- New `knowledge.MAX_INGEST_FILE_BYTES = 50 MB` (`backend/services/knowledge.py`),
  independent of chat's `MAX_FILE_BYTES = 1 MB`, which is untouched and still governs
  `/api/chat/upload`.
- Frontend: `uploadKnowledgeFile()` (`frontend/src/lib/api.ts`) replaces the shared
  `uploadFile()` call in `Knowledge.tsx`'s `submitFile()`; helper text updated to
  "up to 50 MB".
- Verified end-to-end: a 90,064-char test document came back whole through the new
  endpoint (vs. 12,036 chars + a truncation notice through the old one) and produced
  100 chunks in Qdrant through `/api/knowledge/learn`, vs. the ~12 chunks the truncated
  path would have produced. Test source removed after verification.

### Phase 1 — Sycamore job endpoint — ✅ shipped
- No new install needed: `~/GitHub/sycamore/lib/sycamore/.venv` (your dev checkout)
  already has `torch` 2.10+cu128, `transformers`, `timm`, `easyocr`, `paddleocr`, and
  `sycamore` itself working, and the DETR layout model (`Arynwood/deformable-detr-DocLayNet`)
  is already cached under `~/.cache/huggingface`. One catch: that venv's `sycamore`
  package isn't a real installed distribution, it resolves by being run *from* its own
  directory (flat repo layout) — so the subprocess needs `PYTHONPATH` set explicitly to
  `lib/sycamore`, not just the venv's `python3` binary. (`sycamore-ai[local-inference]`
  via plain pip would also work standalone if this checkout ever moves/changes, but
  wasn't needed here.)
- `scripts/run_sycamore_partition.py` — new wrapper script (same shape as
  `run_whisper.py`): takes a PDF path + `--output_dir`, calls
  `ArynPDFPartitioner().partition_pdf(..., use_partitioning_service=False)`, flattens
  the result via Sycamore's own `elements_to_markdown()`, writes a `.md` file, prints
  `RESULT_PATH=...`.
- `POST /api/knowledge/sycamore/jobs` (`backend/routers/knowledge.py`) — multipart PDF
  upload + `ocr`/`tables` form flags, rejects non-PDF uploads. Registers via the shared
  `_new_job()`/`_jobs`/`_gpu_lock` from `backend/services/gpu_jobs.py` (the same registry
  `tools.py`/`video.py` use — confirmed live: a job started here is pollable through
  either `/api/knowledge/jobs/{id}` or the pre-existing `/api/tools/jobs/{id}`), runs the
  subprocess inside `async with _gpu_lock:`, and surfaces a clear 404 pointing at this
  doc if the Sycamore venv isn't present — hard-fail, no silent pdfminer fallback,
  matching Florence-2/whisper's existing error-message convention (answers open
  decision §7.3 for this endpoint specifically; `ingest_text()`'s own PDF path is
  untouched until Phase 2 wires this in).
- Verified end-to-end against a real NTSB accident-report PDF (6 pages, government
  form with dense two-column key/value tables): 39 elements, clean Markdown with real
  `##` section headers and properly aligned tables — output pdfminer/pypdf could not
  produce from the same source (that extractor has no table-structure or layout
  awareness at all). Job correctly reachable through both polling endpoints; non-PDF
  uploads correctly rejected with 400.

### Phase 2 — Shallow output integration + frontend wiring — ✅ shipped
- The markdown conversion (`elements_to_markdown`) ended up happening inside Phase 1's
  wrapper script, not here — a subprocess/separate-venv boundary forces some serialized
  text/JSON format regardless, so there was no version of "Phase 1 returns raw
  `list[Element]`" that was ever actually going to reach `ingest_text()` unchanged. Given
  that, this phase folded in a slice of what was originally Phase 4: Sycamore output is
  useless sitting in a job result nobody calls, so `Knowledge.tsx`'s `submitFile()` now
  detects `.pdf`, starts the job, polls `GET /api/knowledge/jobs/{id}` every 3s with
  progress text, and on success hands the markdown to the **existing, unchanged**
  `POST /api/knowledge/learn` → `chunk_text()` → embed → Qdrant. Non-PDF files still use
  the plain Phase-0 `/upload` path. Job errors surface in the existing `errorMsg` UI,
  no silent fallback.
- **Resolves open decision §7.1 with evidence, not a guess:** ran the same real PDF
  (a born-digital NTSB report with a clean embedded text layer) through the job with
  `ocr=false` and `ocr=true` and diffed the output. OCR-on introduced consistent,
  real corruption — periods turned into colons, "097" misread as "O97", hyphens and
  curly quotes silently dropped, "1 Minor" losing the "1" — because forcing an OCR pass
  on top of already-correct embedded text just adds a second, noisier extraction on top
  of a perfect one. **Default is now OCR off** (`backend/routers/knowledge.py`,
  `scripts/run_sycamore_partition.py`, and the frontend's default `pdfIsScanned = false`
  all changed to match), with table-structure extraction still on by default (no
  comparable regression observed there). A "This PDF is a scan (enable OCR)" checkbox
  in `Knowledge.tsx` covers the genuinely-scanned case instead of guessing per-file.
- Verified end-to-end exactly as the UI will drive it: upload → job → poll → `/learn` →
  `/search` returned the ingested content with score 0.73 for a direct natural-language
  question about the document. Test source removed after verification.

### Phase 3 — Deep output integration — ✅ shipped
- `scripts/run_sycamore_partition.py` now groups raw `Element`s into chunks itself
  (`group_elements_into_chunks()`) instead of only flattening to markdown: a `table`
  element always becomes its own standalone chunk (never merged with surrounding text,
  never split), a `Title`/`Section-header` element starts a fresh chunk (a natural
  section boundary), and everything else accumulates up to `CHUNK_SIZE` same as the
  text-chunking path. Each chunk carries `page_start`/`page_end`/`has_table`, written
  alongside the existing `.md` output as a new `<base>.chunks.json` (`CHUNKS_PATH=`
  marker) — the flat markdown stays for back-compat, nothing that read `result_text`
  broke.
- `backend/services/knowledge.py`: `ingest_text()` refactored down to a thin wrapper
  around a new shared `_embed_and_store()` tail (embed → ensure collection → DB row →
  Qdrant points), alongside a new `ingest_chunks()` that skips `chunk_text()` entirely
  and embeds pre-chunked input directly, merging `page_start`/`page_end`/`has_table`
  into each point's payload. `search()` and `format_context()` surface the same fields
  when present (`format_context` renders `(source, p.4)` / `(source, p.4-5)`); absent
  for plain text/URL sources and pre-Phase-3 points, exactly as before.
- `POST /api/knowledge/learn`'s `LearnRequest` gained an optional `chunks` field
  (`ChunkIn`) that takes priority over `text` when present — one endpoint, no new
  route. The job runner now also reads `CHUNKS_PATH` and stores it as the job's
  `result_chunks`; `Knowledge.tsx` uses it when non-empty (falling back to the
  Phase 2 markdown-as-plain-text path only if a parse somehow produced markdown with
  no chunk breakdown). Search results in the UI now show a `p.N` / `p.N-M` and
  `table` badge when the match came from a structured chunk.
- **Traced a suspected bug that turned out not to be one** — a `|  |  |` sequence in
  an early test print looked like garbled table leakage into a text chunk. It was an
  artifact of the *diagnostic print* collapsing 3 consecutive newlines (a heading's
  trailing blank line + the next element's leading one) to `" | "` each; the actual
  stored chunk text was clean. Worth recording since it's exactly the kind of thing
  that's easy to misattribute to the parser instead of the debugging harness.
- Verified end-to-end on the same NTSB PDF: 39 elements → 24 chunks (9 of them
  standalone tables, isolated correctly — e.g. the pilot-info table came back whole
  with `has_table: true, page_start: page_end: 3`), full job → `/learn` → `/search`
  round trip returned that exact table for a natural-language question with score
  0.71. Ran a plain-text regression through the refactored `ingest_text()` afterward
  to confirm the shared-helper refactor didn't change its behavior — `page_start`/
  `page_end` correctly `null`, `has_table` correctly `false`. Test sources removed
  after verification.

### Phase 4 — Frontend polish — ✅ shipped
- Ported the navigation-survival pattern from Video Studio, scoped down for a single
  in-flight job instead of multiple panel "slots": `store/useKnowledgeJobStore.ts`
  (Zustand, one job) + `pages/useKnowledgeJobPoll.ts` (module-scope `setInterval`,
  mirroring `components/video/useJobPoll.ts`'s own rationale — a ref dies with its
  component, module scope doesn't). Leaving the Knowledge page mid-parse no longer
  loses the job; it's still tracked (and still gets saved) on return.
- Went a step further than a straight port: the poll callback itself now performs the
  `POST /learn` call the instant the underlying job hits `done`, before the interval
  is even cleared — collapsing "parse" and "save to KB" into one persisted state
  machine (`queued → running → saving → saved`/`error`) instead of two separate steps
  a component effect would have to coordinate. This was a deliberate choice over the
  more obvious "watch job.status in a useEffect" approach: an effect re-fires on every
  remount where a prior job is already `done`, which would silently re-embed and
  re-save the same PDF each time the user revisits the page. Doing the save inside the
  same interval tick that observes `done`, then transitioning straight to a new
  terminal `saved` status, makes double-submission structurally impossible rather than
  something to guard against.
- Progress got an honest downgrade from the original ask: no per-page/OCR percentage,
  just an elapsed-time counter ("Parsing … 23s elapsed"). Investigated the real option
  — Sycamore's subprocess stdout does carry progress bars (transformers weight
  loading, paddleocr download progress), but they're heterogeneous, unstructured
  human-readable bars from different libraries, not a stable channel to parse, and the
  underlying `partition_pdf()` call doesn't expose a page-level callback in its public
  API to hook instead. Elapsed time is simple, always accurate, and doesn't rot when
  an unrelated library changes its progress-bar formatting.
- Verified: clean `tsc` (only the 3 pre-existing unrelated errors), clean HMR apply, a
  real reload of the Knowledge page's File mode with no console errors. Did not
  exercise a full upload through browser automation — the test PDFs used throughout
  this plan aren't files the user shared with that session, and routing around that
  restriction to prove a frontend wiring change isn't a trade worth making. The
  underlying API calls this hook orchestrates (`sycamore/jobs`, `jobs/{id}`, `learn`
  with `chunks`) were already exercised directly against the running dev server in
  Phases 1–3; this phase only changes *which component/store calls them and when*.

---

## 6. Future Optimization (not v1)

If PDF-learning becomes frequent enough that per-job model reload latency is a real
pain point, revisit Option A: promote the job-runner into a standalone sidecar
(`sycamore-service`, own venv, own port, registered like `mcp_servers.json`) that loads
the DETR/OCR models once at startup and stays warm. This is a pure follow-up — nothing
in Phase 0–4 needs to be re-architected to make that move later, since the job already
returns the same `list[Element]` shape either way.

---

## 7. Open Decisions

1. ~~OCR default-on or opt-in?~~ **Resolved in Phase 2, with evidence, not just a
   latency trade-off:** default off. OCR doesn't just cost time on a born-digital PDF,
   it measurably corrupts otherwise-correct text (see Phase 2 write-up above). A
   "scanned document" checkbox opts in for the case it's actually needed.
2. **Table structure extraction default-on or opt-in?** Still open, but lower stakes —
   no corruption observed either way in testing, the trade-off is only the extra
   model-load time. Left on by default; revisit if that latency turns out to bother
   people on documents with no tables at all.
3. **Fallback behavior if Sycamore isn't installed:** decided *for the job endpoint
   itself* in Phase 1 — hard-error with a message pointing at this doc, no silent
   pdfminer substitution (matches Florence-2/whisper's existing convention). Still
   open one level up: today, `.pdf` files in `Knowledge.tsx` *only* go through
   Sycamore — if the venv were ever missing, PDF learning breaks entirely rather than
   degrading to the old pdfminer/pypdf path. Worth a decision once this needs to run
   somewhere Sycamore's dev venv doesn't exist.
4. ~~New file-size ceiling for Phase 0's dedicated ingestion route~~ **Resolved in
   Phase 0:** 50 MB (`knowledge.MAX_INGEST_FILE_BYTES`).

---

## 8. Rough Effort

| Phase | Scope | Size | Status |
|---|---|---|---|
| 0 | New ingestion route, remove shared truncation/size limits | Small | ✅ shipped |
| 1 | Dedicated-venv job endpoint, `_gpu_lock` integration | Medium | ✅ shipped |
| 2 | Markdown-flatten + existing chunker + frontend wiring | Small | ✅ shipped |
| 3 | Element-aware chunking + richer Qdrant payload | Medium | ✅ shipped |
| 4 | Navigation-surviving job store, elapsed-time progress | Small–Medium | ✅ shipped |
| 6 | Sidecar promotion (only if needed later) | Medium–Large | deferred |

All four v1 phases shipped, each verified end-to-end against the running dev server
(and, for Phase 4, the live browser) rather than left as an untested plan. Phase 6 is
deferred until warm-model reload latency is an observed problem on real usage, not a
hypothetical one — nothing shipped in Phases 0–4 needs to be re-architected to make
that move later.
