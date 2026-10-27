"""Optional ML-DSA-65 adapter for ZERONYTH.

This module deliberately refuses to silently downgrade to classical crypto.
It is an off-chain demonstration boundary: the EVM transaction path in this
starter kit does not verify ML-DSA signatures.
"""
from __future__ import annotations

import hashlib
from typing import Any

ALGORITHM = "ML-DSA-65"


def _oqs() -> Any:
    try:
        import oqs  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Open Quantum Safe bindings are not installed. Install a current "
            "liboqs + liboqs-python release; do not substitute ECDSA if PQC "
            "properties are required."
        ) from exc

    enabled = set(oqs.get_enabled_sig_mechanisms())
    if ALGORITHM not in enabled:
        raise RuntimeError(f"{ALGORITHM} is not enabled by this liboqs build")
    return oqs


def generate_keypair() -> tuple[bytes, bytes]:
    oqs = _oqs()
    with oqs.Signature(ALGORITHM) as signer:
        public_key = signer.generate_keypair()
        secret_key = signer.export_secret_key()
    return public_key, secret_key


def sign(message: bytes, secret_key: bytes) -> bytes:
    if not isinstance(message, bytes) or not isinstance(secret_key, bytes):
        raise TypeError("message and secret_key must be bytes")
    oqs = _oqs()
    with oqs.Signature(ALGORITHM, secret_key) as signer:
        return signer.sign(message)


def verify(message: bytes, signature: bytes, public_key: bytes) -> bool:
    if not all(isinstance(value, bytes) for value in (message, signature, public_key)):
        raise TypeError("message, signature and public_key must be bytes")
    oqs = _oqs()
    with oqs.Signature(ALGORITHM) as verifier:
        return bool(verifier.verify(message, signature, public_key))


def public_key_hash(public_key: bytes) -> str:
    """Return a SHA-256 commitment suitable for storing in bytes32."""
    if not isinstance(public_key, bytes):
        raise TypeError("public_key must be bytes")
    return "0x" + hashlib.sha256(public_key).hexdigest()


def self_test(message: bytes = b"zeronyth-self-test") -> bool:
    public_key, secret_key = generate_keypair()
    signature = sign(message, secret_key)
    return verify(message, signature, public_key)
