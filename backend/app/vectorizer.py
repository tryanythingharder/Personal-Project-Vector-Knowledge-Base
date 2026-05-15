from __future__ import annotations

import hashlib
import json
import math
import re


VECTOR_DIM = 384
LATIN_WORD_RE = re.compile(r"[a-zA-Z0-9_+#.-]{2,}")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _hash_token(token: str) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=False)


def tokenize(text: str) -> list[str]:
    normalized = text.lower()
    tokens = LATIN_WORD_RE.findall(normalized)
    cjk_chars = CJK_RE.findall(normalized)

    tokens.extend(cjk_chars)
    for size in (2, 3, 4):
        if len(cjk_chars) >= size:
            tokens.extend("".join(cjk_chars[i : i + size]) for i in range(len(cjk_chars) - size + 1))

    compact = re.sub(r"\s+", "", normalized)
    if len(compact) > 8:
        tokens.extend(compact[i : i + 5] for i in range(0, len(compact) - 4, 3))

    return tokens[:8000]


def embed(text: str) -> list[float]:
    vector = [0.0] * VECTOR_DIM
    for token in tokenize(text):
        hashed = _hash_token(token)
        index = hashed % VECTOR_DIM
        sign = 1.0 if ((hashed >> 12) & 1) else -1.0
        weight = 1.0 + min(len(token), 10) * 0.03
        vector[index] += sign * weight

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [round(value / norm, 6) for value in vector]


def dumps_vector(vector: list[float]) -> str:
    return json.dumps(vector, separators=(",", ":"))


def loads_vector(value: str) -> list[float]:
    return json.loads(value)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    return sum(a * b for a, b in zip(left, right))
