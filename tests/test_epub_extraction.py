"""EPUB text extraction (backend/services/knowledge.py's _extract_epub_text) is
hand-rolled — stdlib zipfile/ElementTree + the bs4 already used elsewhere in that
file — rather than via the ebooklib package, which is AGPLv3+ and was in tension
with this app's own license for a distributed build (see
docs/third-party-notices.md). Custom logic that replaced a well-tested library
deserves its own coverage the library no longer provides for free."""
import io
import zipfile

from backend.services.knowledge import extract_text_from_bytes

_CONTAINER_XML = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""


def _build_epub(manifest_items: list[tuple[str, str]], spine_idrefs: list[str], contents: dict[str, str]) -> bytes:
    """manifest_items: [(id, href), ...] in manifest declaration order (may differ
    from spine order — that's the point of the reading-order test below).
    spine_idrefs: ids in intended reading order.
    contents: href -> xhtml body content.
    """
    manifest_xml = "\n".join(
        f'<item id="{i}" href="{h}" media-type="application/xhtml+xml"/>' for i, h in manifest_items
    )
    spine_xml = "\n".join(f'<itemref idref="{i}"/>' for i in spine_idrefs)
    opf = f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata/>
  <manifest>{manifest_xml}</manifest>
  <spine>{spine_xml}</spine>
</package>"""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", _CONTAINER_XML)
        zf.writestr("OEBPS/content.opf", opf)
        for href, body in contents.items():
            zf.writestr(f"OEBPS/{href}", f"<html><body>{body}</body></html>")
    return buf.getvalue()


def test_extracts_text_in_spine_order_not_manifest_order():
    # Manifest lists chapter 2 before chapter 1 — output must still follow the
    # spine (reading order), not manifest declaration order.
    data = _build_epub(
        manifest_items=[("ch2", "chap2.xhtml"), ("ch1", "chap1.xhtml")],
        spine_idrefs=["ch1", "ch2"],
        contents={
            "chap1.xhtml": "<h1>Chapter One</h1><p>First chapter text.</p>",
            "chap2.xhtml": "<h1>Chapter Two</h1><p>Second chapter text.</p>",
        },
    )
    text = extract_text_from_bytes("book.epub", data)
    assert "Chapter One" in text
    assert "Chapter Two" in text
    assert text.index("Chapter One") < text.index("Chapter Two")


def test_strips_script_style_and_nav_tags():
    data = _build_epub(
        manifest_items=[("ch1", "chap1.xhtml")],
        spine_idrefs=["ch1"],
        contents={
            "chap1.xhtml": (
                "<script>alert('evil')</script>"
                "<style>.x{color:red}</style>"
                "<nav>Table of Contents</nav>"
                "<p>Real chapter content.</p>"
            ),
        },
    )
    text = extract_text_from_bytes("book.epub", data)
    assert "Real chapter content." in text
    assert "evil" not in text
    assert "color:red" not in text
    assert "Table of Contents" not in text


def test_skips_manifest_items_not_in_spine():
    # e.g. a nav.xhtml / cover page present in the manifest but not the spine
    # (or present in the spine as non-linear front matter) shouldn't appear.
    data = _build_epub(
        manifest_items=[("ch1", "chap1.xhtml"), ("nav", "nav.xhtml")],
        spine_idrefs=["ch1"],
        contents={
            "chap1.xhtml": "<p>Chapter content.</p>",
            "nav.xhtml": "<p>Navigation document, not real content.</p>",
        },
    )
    text = extract_text_from_bytes("book.epub", data)
    assert "Chapter content." in text
    assert "Navigation document" not in text
