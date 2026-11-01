# ADR-0006: S3-compatible object storage behind an interface

- Status: Accepted (2026-11-01)

## Decision

Use the AWS SDK v3 S3 client against MinIO locally and S3 in AWS. A `BlobStorage` interface (`put/get/stream/delete/signUpload/signDownload`) is introduced with the first feature that stores blobs (PR 4); PR 1 only uses the client for readiness and bucket bootstrap.

Note: MinIO stopped publishing images to Docker Hub; compose pins a `quay.io/minio/minio` release and allows `MINIO_IMAGE` override. Any S3-compatible store works.
