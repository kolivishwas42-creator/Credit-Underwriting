"""Documents from S3: an id is `s3://bucket/key` or a key in the configured bucket. Credentials come from the
standard AWS chain (environment, profile or IAM role) -- never from this agent's configuration."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from .base import DocumentNotFound, ResolvedDocument


def split_s3_id(identifier: str, default_bucket: str) -> tuple[str, str]:
    if identifier.startswith("s3://"):
        bucket, _, key = identifier[5:].partition("/")
    else:
        bucket, key = default_bucket, identifier
    if not bucket or not key:
        raise ValueError("S3 document id needs a bucket (ITR_VERIFICATION_S3_BUCKET or s3://bucket/key) and a key")
    return bucket, key


class S3Resolver:
    def __init__(self, bucket: str, region: str = "", temp_dir: str = "", client=None):
        self._bucket, self._temp_dir = bucket, temp_dir or None
        if client is None:
            import boto3

            client = boto3.client("s3", region_name=region or None)
        self._s3 = client

    def resolve(self, identifier: str, side: str) -> ResolvedDocument:
        bucket, key = split_s3_id(identifier, self._bucket)
        fd, name = tempfile.mkstemp(suffix=Path(key).suffix or ".pdf", dir=self._temp_dir)
        os.close(fd)
        try:
            self._s3.download_file(bucket, key, name)
        except Exception as exc:
            Path(name).unlink(missing_ok=True)
            if type(exc).__name__ == "ClientError":
                raise DocumentNotFound(f"Document '{identifier}' not found in the {side} document store") from None
            raise
        return ResolvedDocument(Path(name), temporary=True)


__all__ = ["S3Resolver", "split_s3_id"]
