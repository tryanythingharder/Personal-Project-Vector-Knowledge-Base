from __future__ import annotations

import json
import re
from typing import Any

from .database import get_conn, rows_to_dicts
from .vectorizer import cosine_similarity, embed, loads_vector, tokenize


def retrieve_context(query: str, project_id: int | None, top_k: int = 5) -> list[dict[str, Any]]:
    query_vector = embed(query)
    params: tuple[Any, ...]
    if project_id:
        sql = """
            SELECT chunks.*, documents.title AS document_title, documents.filename AS filename
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            WHERE chunks.project_id = ?
        """
        params = (project_id,)
    else:
        sql = """
            SELECT chunks.*, documents.title AS document_title, documents.filename AS filename
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
        """
        params = ()

    with get_conn() as conn:
        rows = rows_to_dicts(conn.execute(sql, params).fetchall())

    scored = []
    for row in rows:
        score = cosine_similarity(query_vector, loads_vector(row["vector_json"]))
        if score > 0:
            row["score"] = round(score, 4)
            scored.append(row)

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[: max(1, min(top_k, 12))]


def build_citations(contexts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations = []
    for index, item in enumerate(contexts, 1):
        snippet = re.sub(r"\s+", " ", item["content"]).strip()[:280]
        citations.append(
            {
                "rank": index,
                "document_id": item["document_id"],
                "document_title": item["document_title"],
                "filename": item["filename"],
                "chunk_id": item["id"],
                "score": item["score"],
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
        "如果资料不足，明确说明缺少什么。回答要结构清楚，并在关键结论后标注引用编号如 [1]。"
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
        sentences = [part.strip() for part in re.split(r"(?<=[。！？!?；;.\n])", item["content"]) if part.strip()]
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
