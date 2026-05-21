from __future__ import annotations

import base64
import hashlib
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("KB_DATA_DIR", APP_ROOT / "data"))
SECRET_PREFIX = "kortex1:"
PASSWORD_PREFIX = "kortexpw1:"
SESSION_PREFIX = "kortexsess1:"


def _normalize_fernet_key(raw: str) -> bytes:
    candidate = raw.strip().encode("utf-8")
    try:
        Fernet(candidate)
        return candidate
    except Exception:
        digest = hashlib.sha256(candidate).digest()
        return base64.urlsafe_b64encode(digest)


def _load_key() -> bytes:
    configured = os.getenv("KORTEX_SECRET_KEY", "").strip()
    if configured:
        return _normalize_fernet_key(configured)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key_path = DATA_DIR / ".kortex_secret_key"
    if key_path.exists():
        return _normalize_fernet_key(key_path.read_text(encoding="utf-8").strip())

    key = Fernet.generate_key()
    key_path.write_text(key.decode("utf-8"), encoding="utf-8")
    return key


def _fernet() -> Fernet:
    return Fernet(_load_key())


def is_encrypted_secret(value: str | None) -> bool:
    return bool(value and value.startswith(SECRET_PREFIX))


def encrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    if is_encrypted_secret(value):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{SECRET_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    if not is_encrypted_secret(value):
        return value
    token = value.removeprefix(SECRET_PREFIX)
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"{PASSWORD_PREFIX}{base64.urlsafe_b64encode(salt).decode('utf-8')}:{base64.urlsafe_b64encode(digest).decode('utf-8')}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith(PASSWORD_PREFIX):
        return False
    try:
        payload = stored.removeprefix(PASSWORD_PREFIX)
        salt_raw, digest_raw = payload.split(":", 1)
        salt = base64.urlsafe_b64decode(salt_raw.encode("utf-8"))
        expected = base64.urlsafe_b64decode(digest_raw.encode("utf-8"))
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return secrets.compare_digest(actual, expected)


def create_session_token() -> str:
    return f"{SESSION_PREFIX}{secrets.token_urlsafe(32)}"


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
