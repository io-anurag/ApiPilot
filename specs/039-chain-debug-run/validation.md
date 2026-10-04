# Validation: Chain Debug Run

**Date**: 2026-10-04 | **Version**: 19.23.0 | **Spec**: [spec.md](spec.md)

## Commands run

| Command | Result |
|---|---|
| `npm test` | 322 files passed, 3 skipped; **2,625 tests passed, 10 skipped**, exit 0. 139 of the tests are new for this feature (91 backend in the Debug run suites, 40 for `DebugRunOutput` and `ChainDebugPanel`, 7 for the client, 1 for the editor entry point). |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 (frontend, backend, shared-domain) |

## End-to-end check against the real backend

Run on 2026-10-04 with `tsx src/server.ts` (`AI_PROVIDER_MODE=mock`, port 4010) and a local stub target on port 4655, using the real fetch sender (no fake). The scenario is the one that motivated the feature:

| Step | Observed |
|---|---|
| Plan with `issueToken` (extractor `token` from `access_token`) then `listCustomers` using `Bearer {{token}}`; target answers `{"token": "...", "note": ...}` | `POST .../debug-runs` returned 200, outcome `stopped-early` |
| First step | sent, HTTP 200, extractor `token` failed with `path-not-found` |
| Response body as shown | `{"token":"[M]","note":"wrong field name on purpose"}`: the real field name is visible, its value is masked |
| Request body as shown | `client_secret=[M]` |
| Second step | `not-sent`, stopped by `issueToken`, reason `extractor-failed` |
| The stub received | `POST /auth/token` only |
| Secret value and token in the response text | neither present |
| Extractor path corrected to `token`, run again | outcome `completed`, `listCustomers` returned 200 |
| `Authorization` shown | masked; the stub received `Bearer <token>` |
| Reveal of the masked Authorization value | returned `Bearer <token>` |
| Runs of the plan | 0 listed |
| Reveal after `DELETE` | 404 |

SC-005: a 10-step plan (five GET, five POST, one check each) against a responsive local target returned its full output in **52 ms** (limit 15 s).

## Success criteria

| Criterion | Evidence |
|---|---|
| SC-001 | The end-to-end run above: the field name and cause are visible from the output alone. The 2-minute usability measure was not timed with a person. |
| SC-002 | `chainDebugRun.test.ts` "keeps every sentinel out of every table, log line and later response": sentinels for a secret environment value, a secret data cell, a token and response content are absent from every SQLite table, captured console output and later responses, and no `performance_runs` row exists. The request marker is found only in the plan's own table. |
| SC-003 | `masker.test.ts`: Authorization, Proxy-Authorization, Cookie, Set-Cookie, X-Api-Key and api-key headers; secret environment and data values in URL, header and body positions; credential-named JSON fields, query parameters and form fields; extracted credentials. A body with held values substituted back is byte-identical to the original. |
| SC-004 | `chainDebugRun.test.ts` and `debugParity.test.ts`: every cause (stopped by extractor, unexpected status, setup failed, missing value, missing extracted value, host not allowed, run cancelled, time limit) shows on the step. |
| SC-005 | 52 ms, above. |
| SC-006 | `CHAIN_RUNTIME` is unchanged (hash guard in `debugParity.test.ts` passes against the hash recorded before any change), so the generated scripts and their golden fixtures are unchanged, and the report modules were not touched; the existing report and golden tests pass in the full run. |

## Requirements spot checks

- FR-008 (same stop rules as the load run): 15 parity cases run each plan through the generated script in the sandbox and through the executor, including all 48 dynamic variables in setup and in the iteration.
- FR-015b: a secret environment value or data column never appears in a result, is never held, and its masked pieces have `revealable: false`; the reveal route answers 404 for it.
- FR-019: a `{{baseUrl}}@evil...` URL is reported as not sent and nothing is requested; a redirect to a host that is not allowed is not followed (sender and integration tests).
- FR-023 / FR-025: second Debug run of a plan refused with 409; a cancelled run aborts the in-flight request and marks the rest not reached; the run is cut off at 120 s on an injected clock.

## Not verified

- **Browser walkthrough** of `quickstart.md`: not performed. The screens were exercised in jsdom with React Testing Library only.
- **T044**: keyboard order, visible focus, narrow-width layout and dark-mode contrast were designed for (semantic tables, labelled buttons, text outcomes, scrolling inside code blocks, existing tokens) and the accessible names are tested, but none was checked in a browser.
- **SC-001** with a person, and the outcome when a real target is slow or very large (the 30 s per-request and 120 s run limits, the 2 MiB read cap and 64 KiB display cap were tested with local servers and an injected clock, not against a real slow target).
- **Windows-only run.** All commands ran on Windows 11.

## Notes

- Two findings of the planning analysis changed the design and are recorded in `research.md`: the executor mirrors the runtime's stop rules rather than the first draft of the spec, and extractors have no content-type rule.
- A body on a GET or HEAD request cannot be sent with `fetch`, so a Debug run reports it as `unsupported-request` rather than dropping the body.
