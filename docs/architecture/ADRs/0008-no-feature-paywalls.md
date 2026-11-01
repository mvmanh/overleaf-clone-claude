# ADR-0008: No feature paywalls; resource quotas instead

- Status: Accepted (2026-11-01)

All features are available to all users. "Unlimited features" ≠ unlimited resources: compile time, storage and concurrency are bounded by configurable quotas (`SandboxLimits`, later per-user/per-project quotas).
