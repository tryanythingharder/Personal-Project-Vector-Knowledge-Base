from __future__ import annotations

import json
import math
import re
from typing import Any

from .database import get_conn, rows_to_dicts
from .vectorizer import cosine_similarity, embed, loads_vector, tokenize
from .vector_store import qdrant_enabled, search_qdrant


def _metadata_matches(row: dict[str, Any], metadata_filter: dict[str, Any] | None) -> bool:
    if not metadata_filter:
        return True
    document_meta = {}
    chunk_meta = {}
    try:
        document_meta = json.loads(row.get("document_metadata_json") or "{}")
    except (TypeError, ValueError):
        document_meta = {}
    try:
        chunk_meta = json.loads(row.get("metadata_json") or "{}")
    except (TypeError, ValueError):
        chunk_meta = {}
    merged = {**document_meta, **chunk_meta}
    for key, expected in metadata_filter.items():
        if expected in (None, "", []):
            continue
        actual = merged.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif str(actual or "").lower() != str(expected).lower():
            return False
    return True


def _keyword_score(query: str, content: str, filename: str = "") -> float:
    query_tokens = tokenize(query)
    if not query_tokens:
        return 0.0
    content_tokens = tokenize(f"{filename}\n{content}")
    if not content_tokens:
        return 0.0

    content_counts: dict[str, int] = {}
    for token in content_tokens:
        content_counts[token] = content_counts.get(token, 0) + 1

    matched = 0.0
    for token in set(query_tokens):
        # Longer tokens carry more signal for project names, APIs, and filenames.
        if token in content_counts:
            matched += 1.0 + min(len(token), 16) / 16 + math.log1p(content_counts[token]) * 0.2

    return round(min(matched / max(len(set(query_tokens)), 1), 1.0), 4)


def _bm25_scores(query: str, rows: list[dict[str, Any]]) -> dict[int, float]:
    query_tokens = set(tokenize(query))
    if not query_tokens or not rows:
        return {}

    docs = []
    doc_freq: dict[str, int] = {}
    for row in rows:
        tokens = tokenize(f"{row.get('filename', '')}\n{row.get('content', '')}")
        counts: dict[str, int] = {}
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1
        docs.append((row["id"], counts, len(tokens)))
        for token in query_tokens:
            if token in counts:
                doc_freq[token] = doc_freq.get(token, 0) + 1

    avg_len = sum(length for _, _, length in docs) / max(len(docs), 1)
    k1 = 1.5
    b = 0.75
    raw_scores: dict[int, float] = {}
    for row_id, counts, length in docs:
        score = 0.0
        for token in query_tokens:
            tf = counts.get(token, 0)
            if tf <= 0:
                continue
            idf = math.log(1 + (len(docs) - doc_freq.get(token, 0) + 0.5) / (doc_freq.get(token, 0) + 0.5))
            score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / max(avg_len, 1)))
        raw_scores[row_id] = score
    max_score = max(raw_scores.values() or [0])
    if max_score <= 0:
        return {row_id: 0.0 for row_id in raw_scores}
    return {row_id: round(score / max_score, 4) for row_id, score in raw_scores.items()}


def retrieve_context(
    query: str,
    project_id: int | None,
    allowed_project_ids: list[int] | None = None,
    top_k: int = 5,
    mode: str = "hybrid",
    similarity_threshold: float = 0.0,
    query_vector: list[float] | None = None,
    metadata_filter: dict[str, Any] | None = None,
    scope: str = "focused",
    full_context_limit: int = 20,
) -> list[dict[str, Any]]:
    active_query_vector = query_vector or embed(query)
    params: tuple[Any, ...]
    if project_id:
        sql = """
            SELECT chunks.*, documents.title AS document_title, documents.filename AS filename,
                   projects.name AS project_name,
                   documents.metadata_json AS document_metadata_json
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            JOIN projects ON projects.id = chunks.project_id
            WHERE chunks.project_id = ? AND documents.status = 'ready'
        """
        params = (project_id,)
    elif allowed_project_ids is not None:
        if not allowed_project_ids:
            return []
        placeholders = ",".join("?" for _ in allowed_project_ids)
        sql = f"""
            SELECT chunks.*, documents.title AS document_title, documents.filename AS filename,
                   projects.name AS project_name,
                   documents.metadata_json AS document_metadata_json
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            JOIN projects ON projects.id = chunks.project_id
            WHERE documents.status = 'ready' AND chunks.project_id IN ({placeholders})
        """
        params = tuple(allowed_project_ids)
    else:
        sql = """
            SELECT chunks.*, documents.title AS document_title, documents.filename AS filename,
                   projects.name AS project_name,
                   documents.metadata_json AS document_metadata_json
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            JOIN projects ON projects.id = chunks.project_id
            WHERE documents.status = 'ready'
        """
        params = ()

    qdrant_scores: dict[int, float] = {}
    if qdrant_enabled() and mode != "keyword" and allowed_project_ids is None:
        try:
            qdrant_hits = search_qdrant(
                active_query_vector,
                project_id,
                max(top_k * 8, full_context_limit * 4, 50),
                len(active_query_vector),
            )
            qdrant_scores = {int(item["id"]): float(item.get("score") or 0) for item in qdrant_hits if item.get("id") is not None}
        except Exception:
            qdrant_scores = {}

    if qdrant_scores:
        placeholders = ",".join("?" for _ in qdrant_scores)
        sql = f"{sql} AND chunks.id IN ({placeholders})"
        params = (*params, *qdrant_scores.keys())

    with get_conn() as conn:
        rows = rows_to_dicts(conn.execute(sql, params).fetchall())
    rows = [row for row in rows if _metadata_matches(row, metadata_filter)]

    scored = []
    retrieval_mode = mode if mode in {"vector", "keyword", "hybrid"} else "hybrid"
    bm25 = _bm25_scores(query, rows)
    for row in rows:
        vector_score = qdrant_scores.get(row["id"])
        if vector_score is None:
            vector_score = cosine_similarity(active_query_vector, loads_vector(row["vector_json"]))
        keyword_score = bm25.get(row["id"], 0.0) or _keyword_score(query, row["content"], row.get("filename", ""))
        if retrieval_mode == "vector":
            score = vector_score
        elif retrieval_mode == "keyword":
            score = keyword_score
        else:
            score = vector_score * 0.68 + keyword_score * 0.32

        if score >= similarity_threshold and score > 0:
            row["score"] = round(score, 4)
            row["vector_score"] = round(vector_score, 4)
            row["keyword_score"] = round(keyword_score, 4)
            row["retrieval_mode"] = retrieval_mode
            scored.append(row)

    scored.sort(key=lambda item: item["score"], reverse=True)
    focused = scored[: max(1, min(top_k, 24))]
    if scope != "full_context" or not focused:
        return focused

    document_ids = {item["document_id"] for item in focused}
    full_rows = [row for row in rows if row["document_id"] in document_ids]
    full_rows.sort(key=lambda item: (item.get("filename", ""), item.get("chunk_index", 0)))
    score_by_id = {item["id"]: item for item in scored}
    expanded: list[dict[str, Any]] = []
    for row in full_rows[: max(top_k, min(full_context_limit, 80))]:
        source = score_by_id.get(row["id"])
        if source:
            expanded.append(source)
        else:
            row["score"] = 0
            row["vector_score"] = 0
            row["keyword_score"] = 0
            row["retrieval_mode"] = retrieval_mode
            expanded.append(row)
    return expanded


def build_citations(contexts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations = []
    for index, item in enumerate(contexts, 1):
        snippet = re.sub(r"\s+", " ", item["content"]).strip()[:280]
        citations.append(
            {
                "rank": index,
                "document_id": item["document_id"],
                "document_title": item["document_title"],
                "project_name": item.get("project_name"),
                "filename": item["filename"],
                "chunk_id": item["id"],
                "chunk_index": item.get("chunk_index", 0),
                "section_path": item.get("section_path", ""),
                "score": item["score"],
                "vector_score": item.get("vector_score", 0),
                "keyword_score": item.get("keyword_score", 0),
                "rerank_score": item.get("rerank_score", 0),
                "snippet": snippet,
            }
        )
    return citations


def build_llm_messages(question: str, contexts: list[dict[str, Any]]) -> list[dict[str, str]]:
    context_text = "\n\n".join(
        f"[{index}] 来源：{item['document_title']} / {item['filename']}\n{item['content']}"
        for index, item in enumerate(contexts, 1)
    )
    system = (
        "你是一个私有项目知识库 Agent。只根据给定知识库片段回答；"
        "如果资料不足，明确说明缺少什么。回答要结构清晰，并在关键结论后标注引用编号，例如 [1]。"
    )
    user = f"知识库片段：\n{context_text or '未检索到相关片段'}\n\n用户问题：{question}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def local_answer(question: str, contexts: list[dict[str, Any]]) -> str:
    if not contexts:
        return (
            "我还没有在知识库里找到足够相关的内容。你可以先上传项目文档、README、需求说明、交付记录或代码说明，"
            "再针对项目背景、技术方案、功能模块继续提问。"
        )

    question_tokens = set(tokenize(question))
    bullets: list[str] = []
    for index, item in enumerate(contexts[:4], 1):
        sentences = [part.strip() for part in re.split(r"(?<=[。！？；?.\n])", item["content"]) if part.strip()]
        ranked = []
        for sentence in sentences or [item["content"]]:
            sentence_tokens = set(tokenize(sentence))
            overlap = len(question_tokens & sentence_tokens)
            ranked.append((overlap, sentence))
        ranked.sort(key=lambda pair: (pair[0], len(pair[1])), reverse=True)
        excerpt = ranked[0][1] if ranked else item["content"]
        excerpt = re.sub(r"\s+", " ", excerpt).strip()
        if len(excerpt) > 180:
            excerpt = excerpt[:180].rstrip() + "..."
        bullets.append(f"{index}. {excerpt} [{index}]")

    return (
        "根据当前知识库，我找到这些相关依据：\n\n"
        + "\n".join(bullets)
        + "\n\n如果要形成更完整的结论，可以继续追问“总结方案”“列出功能模块”“生成项目复盘”或“按时间线整理”。"
    )


def citations_to_json(citations: list[dict[str, Any]]) -> str:
    return json.dumps(citations, ensure_ascii=False)
