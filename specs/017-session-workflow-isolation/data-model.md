# Phase 1 Data Model: Session-Scoped Concurrent Workflow Isolation

## `SessionRegistryEntry` (new, backend-internal — `backend/src/session/sessionRegistry.ts`)

Not a `packages/shared-domain` type: this is transport-level session bookkeeping, never
serialized to the frontend beyond the one derived `sessionExpired` boolean (see
`WorkflowOrNoneResult` below). See plan.md's Constitution Check (X. Domain Model First).

| Field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | The `Map` key itself (not a struct field) — a `crypto.randomUUID()` value, unguessable per FR-004a. |
| `lastActivityAt` | `number` (epoch ms) | Updated on every request the session middleware handles for this session (FR-007). |
| `expired` | `boolean` | `false` for a live session. Set `true` by the idle-eviction sweep (research.md D4); the entry is retained as a tombstone rather than deleted, so a later request from the same session id can be told "expired" (FR-007a) instead of looking like a brand-new session. |

**Lifecycle**:

```text
(no entry)
   │ first request from an unrecognized/absent sessionId cookie
   ▼
{ lastActivityAt: now, expired: false }
   │ every subsequent request from the same session          │ 60+ minutes with no request
   │ (lastActivityAt refreshed, expired stays false)           ▼
   └───────────────────────────────────◄──────────  { lastActivityAt: (unchanged), expired: true }
                                                                │ a request eventually arrives from this session id
                                                                ▼
                                                   surfaced as sessionExpired: true (FR-007a),
                                                   then either:
                                                    - no further action → entry stays a tombstone, or
                                                    - session starts a new workflow → entry becomes
                                                      { lastActivityAt: now, expired: false } again
```

A tombstoned entry (`expired: true`) is never evicted from the registry `Map` itself in this
feature's scope (research.md D4) — only the corresponding `workflowStore` entry (the actual
workflow payload) is discarded when eviction happens, which is what bounds memory growth per
SC-003; the tombstone left behind is two small fields, not the workflow payload.

## `workflowStore`'s internal index (modified — `backend/src/testGenerationWorkflow/workflowStore.ts`)

Today: two bare module-level variables, `currentWorkflow: TestGenerationWorkflow | undefined`
and `nextWorkflowSequence: number`, both process-wide.

After this feature: `Map<string /* sessionId */, { currentWorkflow: TestGenerationWorkflow |
undefined; nextWorkflowSequence: number }>`, with every exported function first resolving the
current session's entry (creating one on first use) via the `sessionId` read from
`AsyncLocalStorage` (research.md D1), then operating on it exactly as today's implementation
operates on the bare variables. No exported function's signature, parameters, or return type
changes.

**`TestGenerationWorkflow` itself** (`packages/shared-domain/src/testGenerationWorkflow.ts`,
existing): **unchanged**. This feature changes how many instances may exist at once and which
session's requests may reach a given instance — never the shape of the workflow itself.

## `WorkflowOrNoneResult` (modified — `frontend/src/services/testGenerationWorkflowClient.ts`)

```ts
export type WorkflowOrNoneResult =
  | { ok: true; workflow: TestGenerationWorkflow | null; sessionExpired?: boolean }
  | { ok: false; error: string; message: string };
```

`sessionExpired` is present and `true` only for the new case in research.md D5 (the caller's
prior session was idle-evicted); absent (or `false`) in every case that exists today, so no
existing caller needs to change beyond the one new UI branch in
`frontend/src/pages/TestGenerationWorkflowPage.tsx` (FR-007a).

## Relationships

```text
Browser (one cookie jar)
   │ sessionId cookie (httpOnly, unguessable — FR-004a)
   ▼
SessionRegistryEntry (backend/src/session/sessionRegistry.ts)
   │ same sessionId, looked up via AsyncLocalStorage (research.md D1)
   ▼
workflowStore's per-session entry { currentWorkflow, nextWorkflowSequence }
   │ currentWorkflow
   ▼
TestGenerationWorkflow (packages/shared-domain, unchanged shape)
```
