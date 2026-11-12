"""Where documents named by id are read from: local folders, S3 or the DMS -- one interface, chosen by
ITR_VERIFICATION_DOCUMENT_SOURCE."""

from __future__ import annotations

from ..config import StorageSettings
from .base import DocumentNotFound, DocumentResolver, ResolvedDocument


def build_resolver(settings: StorageSettings) -> DocumentResolver:
    source = settings.source
    if source == "local":
        from .local import LocalResolver

        return LocalResolver(settings.local_input_dir, settings.local_output_dir)
    if source == "s3":
        from .s3 import S3Resolver

        return S3Resolver(settings.s3_bucket, settings.s3_region, settings.temp_dir)
    if source == "dms":
        from .dms import DMSResolver

        return DMSResolver(settings.dms_base_url, settings.dms_api_key, settings.dms_timeout_seconds,
                           settings.temp_dir)
    raise ValueError(f"Unknown document source: {source}")


__all__ = ["DocumentNotFound", "DocumentResolver", "ResolvedDocument", "build_resolver"]
