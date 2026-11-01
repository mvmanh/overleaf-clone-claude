# ADR-0009: AWS ECS before EKS

- Status: Accepted (2026-11-01), implementation Phase 4

Stateless `web`/`api`/`collab` map to ECS services; Postgres → RDS, Redis → ElastiCache, MinIO → S3. Compile sandboxes run on a dedicated EC2 pool with gVisor (or equivalent proven isolation) — a long-lived shared Fargate task is **not** per-job isolation. Revisit EKS only when sandbox scheduling needs justify it.
