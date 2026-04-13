from __future__ import annotations

import mimetypes
import uuid

from botocore.config import Config as BotoConfig

from .config import settings


def _is_configured() -> bool:
    return all(
        [
            settings.r2_endpoint_url,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket_name,
        ]
    )


_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not _is_configured():
        return None
    import boto3

    _client = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 3},
        ),
    )
    return _client


def generate_key(filename: str, prefix: str = "tracks") -> str:
    ext = ""
    if "." in filename:
        ext = filename[filename.rfind(".") :]
    return f"{prefix}/{uuid.uuid4().hex}{ext}"


def upload_bytes(key: str, data: bytes, content_type: str | None = None) -> str:
    client = _get_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")
    if content_type is None:
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def upload_fileobj(key: str, fileobj, content_type: str | None = None) -> str:
    client = _get_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")
    if content_type is None:
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    client.upload_fileobj(
        Fileobj=fileobj,
        Bucket=settings.r2_bucket_name,
        Key=key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def get_presigned_url(key: str, expires: int = 3600) -> str | None:
    if settings.r2_public_url:
        return f"{settings.r2_public_url.rstrip('/')}/{key}"
    client = _get_client()
    if client is None:
        return None
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key},
        ExpiresIn=expires,
    )


def delete_object(key: str) -> None:
    client = _get_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")
    client.delete_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
    )


def is_configured() -> bool:
    return _is_configured()
