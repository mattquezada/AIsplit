"""S3/MinIO storage helpers — presigned URLs + direct worker access.

Two clients exist deliberately:
  * `_internal_client` talks to the in-network endpoint (e.g. http://minio:9000),
    used by the worker to read/write objects.
  * `_public_client` signs URLs against the browser-facing endpoint
    (e.g. http://localhost:9000) so presigned upload/download links resolve
    from the user's machine.
"""
from __future__ import annotations

import boto3
from botocore.client import Config

from app.config import settings

# Path-style addressing works for both MinIO and Supabase Storage's S3 endpoint
# (https://<ref>.storage.supabase.co/storage/v1/s3), which is not virtual-host capable.
_common = dict(
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    region_name=settings.s3_region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

_internal_client = boto3.client("s3", endpoint_url=settings.s3_endpoint_url, **_common)
_public_client = boto3.client("s3", endpoint_url=settings.s3_public_endpoint_url, **_common)

BUCKET = settings.s3_bucket


def ensure_bucket() -> None:
    """Create the bucket if it does not yet exist (idempotent)."""
    try:
        _internal_client.head_bucket(Bucket=BUCKET)
    except Exception:
        _internal_client.create_bucket(Bucket=BUCKET)


def presigned_put_url(key: str, expires: int = 3600) -> str:
    return _public_client.generate_presigned_url(
        "put_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=expires
    )


def presigned_get_url(key: str, expires: int = 3600, download_name: str | None = None) -> str:
    params = {"Bucket": BUCKET, "Key": key}
    if download_name:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
    return _public_client.generate_presigned_url(
        "get_object", Params=params, ExpiresIn=expires
    )


def object_exists(key: str) -> bool:
    try:
        _internal_client.head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception:
        return False


def download_to_file(key: str, dest_path: str) -> None:
    _internal_client.download_file(BUCKET, key, dest_path)


def upload_file(src_path: str, key: str, content_type: str = "audio/wav") -> None:
    _internal_client.upload_file(
        src_path, BUCKET, key, ExtraArgs={"ContentType": content_type}
    )


def delete_prefix(prefix: str) -> None:
    """Delete every object under a prefix (used when a song is removed)."""
    paginator = _internal_client.get_paginator("list_objects_v2")
    to_delete: list[dict] = []
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            to_delete.append({"Key": obj["Key"]})
            if len(to_delete) == 1000:
                _internal_client.delete_objects(Bucket=BUCKET, Delete={"Objects": to_delete})
                to_delete = []
    if to_delete:
        _internal_client.delete_objects(Bucket=BUCKET, Delete={"Objects": to_delete})
