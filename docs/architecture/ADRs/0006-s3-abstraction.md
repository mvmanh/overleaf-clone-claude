# ADR-0006: S3-compatible object storage behind an interface

- Status: Accepted (2026-11-01)

## Decision

Use the AWS SDK v3 S3 client against an S3-compatible store locally and S3 in AWS. A `BlobStorage` interface (`put/get/stream/delete/signUpload/signDownload`) is introduced with the first feature that stores blobs (PR 4); PR 1 only uses the client for readiness and bucket bootstrap.

Local store (updated 2026-11-01): MinIO's public images (Docker Hub, then quay.io) are no longer available, so the compose stack uses **SeaweedFS** (Apache-2.0, `chrislusf/seaweedfs`, pinned version, amd64 + arm64) with S3 identities generated from `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`. `infra/compose/storage-minio.yml` swaps in MinIO for anyone with an image. Application code depends only on the S3 API.
