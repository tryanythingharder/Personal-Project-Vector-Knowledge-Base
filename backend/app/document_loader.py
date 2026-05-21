from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from docx import Document as DocxDocument
from pypdf import PdfReader


TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".css",
    ".dart",
    ".env",
    ".html",
    ".htm",
    ".xml",
    ".log",
    ".mdx",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".java",
    ".go",
    ".rs",
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".h",
    ".hpp",
    ".kt",
    ".php",
    ".rb",
    ".scss",
    ".sh",
    ".swift",
    ".vue",
    ".svelte",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".sql",
}


def extract_text(file_path: Path, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(file_path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()

    if suffix == ".docx":
        doc = DocxDocument(str(file_path))
        return "\n".join(paragraph.text for paragraph in doc.paragraphs).strip()

    if suffix in TEXT_EXTENSIONS or not suffix:
        return file_path.read_text(encoding="utf-8", errors="ignore").strip()

    return file_path.read_text(encoding="utf-8", errors="ignore").strip()


def split_text(text: str, max_chars: int = 1200, overlap: int = 160) -> list[str]:
    cleaned = re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()
    if not cleaned:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", cleaned) if part.strip()]
    chunks: list[str] = []
    current = ""

    def push_current() -> None:
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
        current = ""

    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            push_current()
            start = 0
            while start < len(paragraph):
                piece = paragraph[start : start + max_chars].strip()
                if piece:
                    chunks.append(piece)
                start += max_chars - overlap
            continue

        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= max_chars:
            current = candidate
        else:
            push_current()
            current = paragraph

    push_current()
    return chunks


def infer_metadata(filename: str, content_type: str = "") -> dict[str, Any]:
    path = Path(filename)
    parts = [part for part in filename.replace("\\", "/").split("/") if part]
    return {
        "extension": path.suffix.lower(),
        "content_type": content_type,
        "folder": "/".join(parts[:-1]),
        "filename": parts[-1] if parts else filename,
    }


def split_text_detailed(text: str, max_chars: int = 1200, overlap: int = 160) -> list[dict[str, Any]]:
    cleaned = re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()
    if not cleaned:
        return []

    chunks = split_text(cleaned, max_chars=max_chars, overlap=overlap)
    detailed: list[dict[str, Any]] = []
    cursor = 0
    current_section = ""
    headings: list[tuple[int, str]] = []
    for match in re.finditer(r"(?m)^(#{1,6})\s+(.+)$", cleaned):
        headings.append((match.start(), match.group(2).strip()[:160]))

    for index, chunk in enumerate(chunks):
        start = cleaned.find(chunk[: min(80, len(chunk))], cursor)
        if start < 0:
            start = cursor
        end = min(len(cleaned), start + len(chunk))
        for position, title in headings:
            if position <= start:
                current_section = title
            else:
                break
        detailed.append(
            {
                "chunk_index": index,
                "content": chunk,
                "char_count": len(chunk),
                "section_path": current_section,
                "start_char": start,
                "end_char": end,
            }
        )
        cursor = max(start + 1, end - overlap)
    return detailed
