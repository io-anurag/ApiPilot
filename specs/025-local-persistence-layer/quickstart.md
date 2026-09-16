# Quickstart: Validating the Local Persistence Layer

Prerequisites: repo dependencies installed (`npm install` at the repo root, which installs
`better-sqlite3` into `backend/node_modules` once added — see tasks.md), backend built or run
via `npm run dev -w backend`.

## 1. First run creates the DB with no manual setup (SC-004)

```powershell
Remove-Item -ErrorAction SilentlyContinue "$env:USERPROFILE\.apipilot\apipilot.db"
npm run dev -w backend
```

Expected: backend starts normally; `%USERPROFILE%\.apipilot\apipilot.db` now exists (and its
sibling `db.key`, research.md D7). No error, no manual migration step.

## 2. Environments survive a restart (User Story 1, SC-001)

1. With the backend and frontend running, open the app in a browser and create an environment
   (base URL + a variable value that looks like a credential, e.g. `token=abc123`).
2. Stop the backend process (Ctrl+C) without closing the browser tab.
3. Restart the backend (`npm run dev -w backend`).
4. Reload the page (same browser tab, so the same `sessionId` cookie is presented).

Expected: the environment is still listed with the same base URL and variable value, with no
re-entry required.

## 3. Execution run history survives a restart (User Story 2, SC-002)

1. In the same session, execute an approved collection against the environment from step 2 and
   let it complete.
2. Restart the backend.
3. Reload the page and open run history.

Expected: the completed run is still listed with its original status, summary counts, and
per-request results.

## 4. An in-progress run is marked interrupted, not silently lost (FR-008, Edge Cases)

1. Start an execution run against a collection with several requests.
2. While it is still `in-progress`, stop the backend process immediately (before it completes).
3. Restart the backend and reload the page.

Expected: the run appears in history with status `cancelled` (not `completed`, not missing),
and its already-settled results are unchanged.

## 5. AI readiness/benchmark history is visible without re-running anything (User Story 3, SC-003)

1. Let the backend load its local AI model at least once (or intentionally misconfigure
   `AI_MODEL_ID` to observe an `unavailable` transition).
2. Restart the backend.
3. `GET http://localhost:4000/api/ai/status` before the model finishes its next load attempt.

Expected: `lastKnownReadiness` reflects the previous run's final state/reason; `state` itself
still starts fresh (`not-loaded` or `loading`) — it is never resumed from history (research.md
D5).

For benchmark history: run `npm run ai:benchmark -w backend` once, then `GET
/api/ai/status` again. Expected: `latestBenchmarkRun` reflects that run's `selectedModelId`
and `selectionRationale`, and `specs/004-ai-provider-local-inference/benchmark-results.json`
is still written exactly as before (unchanged artifact).

## 6. Corrupted DB file fails startup explicitly (Edge Cases, FR-007/D9)

```powershell
Stop-Process -Name node -ErrorAction SilentlyContinue
"not a sqlite file" | Out-File -Encoding ascii "$env:USERPROFILE\.apipilot\apipilot.db"
npm run dev -w backend
```

Expected: the process exits with a non-zero code and a clear, human-readable error identifying
the DB path — never a raw stack trace, and the corrupted file is left untouched (not deleted
or silently recreated).

## 7. Tests never touch the real DB file (FR-011)

```powershell
npm test -w backend
```

Expected: passes with no dependency on `%USERPROFILE%\.apipilot\apipilot.db` — delete that
file first and confirm the suite still passes unaffected, and confirm no new file appears
under `%USERPROFILE%\.apipilot\` as a side effect of running tests.
