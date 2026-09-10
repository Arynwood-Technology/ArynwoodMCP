import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "training" / "novelist"))
from prepare_dataset import chunk_manuscript  # noqa: E402


def test_short_text_is_a_single_chunk():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = chunk_manuscript(text, chunk_words=1000, overlap_words=50)
    assert chunks == [text]


def test_splits_on_paragraph_boundaries_when_over_budget():
    paragraphs = [(f"Paragraph {i} word " * 20).strip() for i in range(10)]
    text = "\n\n".join(paragraphs)
    chunks = chunk_manuscript(text, chunk_words=50, overlap_words=10)
    assert len(chunks) > 1
    # Every source paragraph survives intact in some chunk - paragraphs are never split mid-string
    for para in paragraphs:
        assert any(para in chunk for chunk in chunks)


def test_consecutive_chunks_share_overlap_for_continuity():
    paragraphs = [f"Paragraph {i}. " * 15 for i in range(8)]
    text = "\n\n".join(paragraphs)
    chunks = chunk_manuscript(text, chunk_words=40, overlap_words=15)
    assert len(chunks) > 1
    # The tail of chunk N should reappear at the head of chunk N+1
    first_para_of_next = chunks[1].split("\n\n")[0]
    assert first_para_of_next in chunks[0]
