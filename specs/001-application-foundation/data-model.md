# Data Model: Application Foundation

This feature introduces no persisted data and no business entities — it establishes the
structural seams later features (AP-002+) will populate with real domain models
(`ApiModel`, `TestModel`, etc.). The entities below are the conceptual building blocks
from the spec's Key Entities section, expressed as the first concrete types.

## Frontend Application

- **Represents**: The browser-based UI shell.
- **Key attributes**: No persisted state; holds transient UI/connection state only.
- **Relationships**: Calls the Backend Service over HTTP; imports types from the Shared
  Domain Package.

## Backend Service

- **Represents**: The stateless HTTP API layer.
- **Key attributes**: No persisted state; exposes routes (starting with health status).
- **Relationships**: Serves the Frontend Application; imports types from the Shared
  Domain Package.

## Shared Domain Package (`packages/shared-domain`)

- **Represents**: Reusable, framework-agnostic types/logic consumed by both frontend and
  backend.
- **First concrete type — `HealthStatus`**:
  | Field | Type | Notes |
  |-------|------|-------|
  | `status` | `"ok"` | Literal union; a future revision may add `"degraded"` / `"down"` if a real dependency check is introduced |
  | `timestamp` | `string` (ISO-8601) | Time the status was produced, set by the backend |
- **Validation rules**: `status` MUST be one of the defined literal values; `timestamp`
  MUST be a valid ISO-8601 string. No other fields are permitted (keeps the contract
  minimal and explicit).
- **State transitions**: N/A — `HealthStatus` is a point-in-time value object, not a
  stateful entity.
- **Relationships**: Produced by the Backend Service, consumed by the Frontend
  Application; both import the same type definition from this package (no duplicated
  interface).

## Development Environment Configuration

- **Represents**: Local scripts/conventions (not a runtime data entity) — root
  `package.json` workspace scripts, `tsconfig.base.json`, and environment variables (e.g.,
  backend port, frontend dev-server proxy target).
- **Key attributes**: `BACKEND_PORT` (default local port), `FRONTEND_DEV_PORT` (default
  local port). No secrets are stored (constitution XVIII).
- **Relationships**: Read by both `backend/` and `frontend/` at startup.
