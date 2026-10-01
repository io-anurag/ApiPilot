# Implementation Plan: Run a User-Supplied k6 Script

**Branch**: `034-run-user-k6-script` (git branch `AP-034`) | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/034-run-user-k6-script/spec.md` (AP-034)

## Summary

A fourth start-screen entry, **Run k6 Script**, stores k6 scripts the engineer uploads or writes,
checks them, and runs them with the engineer's k6 after an explicit confirmation of their exact
bytes. It needs no specification, guided workflow or plan.

**Check.** The check parses the script with `acorn` and walks the tree. It accepts only:
- imports from the FR-005 allowlist;
- a conservative subset of JavaScript that cannot reach `open()`, `require()`, the global object or
  the function constructor, even indirectly;
- no `handleSummary` export.

The same pass also lists the hosts written in the script and the `__ENV` names it reads
(research R1 to R5). Computed writes, `const` literal lookup tables and the
`hasOwnProperty.call` chain are allowed. Run-time-keyed reads on other objects are refused. A
stored script is checked again at run start (R17).

**AP-029 amendment.** So that a downloaded generated script can be run as the engineer's own,
AP-029's template is amended to pass the check (AP-029 FR-022a, research R23):
- `Map` lookups;
- token entries passed from setup as an array;
- an own-field response walk;
- a literal `VALUE_ENV` table, which also gives the upload its mapping.

Generated runs keep their behaviour, argument list, environment and metrics. Only the script's
bytes and its golden fixture change.

**Storage.** Scripts are stored encrypted in SQLite. A confirmation is bound to the SHA-256 it
displayed and clears on any content change (R7, R8).

**Run.** A run executes a copy of the stored bytes and is refused unless its SHA-256 matches the
confirmed one. It uses a pinned k6 argument list and an allow-listed process environment, which
together:
- keep remote outputs and the backend's own environment away from k6;
- pass the engineer's mapped values only as process environment;
- pass a chosen load profile only as `--stage` options;
- keep the script's `name` and `url` tags so requests can be grouped (R10 to R13).

**Results.** A new aggregate groups the NDJSON metrics by k6 request name, capped at 100 names. A
new self-contained report reuses AP-029's report helpers, with its own fixed findings ruleset
(R14 to R16).

**Reused from AP-029:** the runner, readiness probe, run directory, integrity check, cancellation,
restart recovery and session keep-alive.

**Changed in existing code:**
- The three copies of the "one execution in progress" check become one helper that also covers
  user-script runs (R9).
- Environments open to a session that holds a script (R18).

The editor is a native textarea with a highlighted overlay and a line gutter, and adds no new
frontend dependency (R19).

The feature adds one backend dependency (`acorn`), no AI and no configuration. Two requirements
were sharpened during planning: FR-006 now forbids a `handleSummary` export, and FR-026 now refuses
k6's start-up variable names.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 24 LTS (root `engines: >=24.0.0`) for the backend.
- React with TypeScript for the frontend.
- k6 1.0.0 or later, installed by the engineer (the existing readiness probe).

**Primary Dependencies**:
- Existing: Express (`express.raw` for the upload, R6), `better-sqlite3` and `credentialCipher`
  (AP-025), React, Vite, Tailwind CSS v4.
- New: `acorn` ^8 as a backend runtime dependency (R1). It is MIT-licensed, has no dependencies,
  and is already in the lockfile as a dev transitive dependency.
- `multer` is not used by this feature (R6).

**Storage**:
- New SQLite tables `user_scripts` and `user_script_runs`. Content, derived hosts, run snapshots,
  results and k6 messages are encrypted with AES-256-GCM (R7, R9).
- An in-process check cache keyed by SHA-256.
- Run working copies go in the existing per-run temp directory, removed when the run ends.

**Testing**:
- Vitest unit and integration tests, with Supertest and the fake runner. React Testing Library for
  the frontend.
- A refused corpus of at least 25 scripts and an accepted corpus.
- One opt-in real-k6 case in `npm run test:k6-real -w backend` (R21).

**Target Platform**: a local web application, with the browser and the Node backend on one machine
(Windows, macOS or Linux). k6 runs on the backend's machine.

**Project Type**: a web application in the npm-workspaces monorepo: `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- SC-006: start screen to a running test in under 3 minutes.
- SC-009:
  - progress within 5 seconds of the trigger;
  - the report within 10 seconds of the end.
- Checking a 1 MiB script parses and walks it once, which takes well under a second.
- Aggregation memory is bounded by the caps of 100 names, checks, groups and custom metrics, 50
  hosts, and 200 timeline buckets (R14).

**Constraints**:
- **Constitution XVII exception of 2026-09-30 (v2.6.0), every condition designed in:**
  - allowlisted single-file built-ins (R2, R3);
  - confirmation of the exact bytes with the hosts listed (R4, R8);
  - confirmed bytes executed unchanged, with configuration only as options and environment
    (R10, R11, R17);
  - a per-run trigger that names the target and repeats the hosts (R17, R20);
  - the user's k6 with local outputs only (R10);
  - the script kept sensitive, never logged, no AI (R7, R13);
  - user-supplied provenance stated with the SHA-256 (R16).
- The script's console output is never kept, logged or shown (R13).
- No environment value appears in the command line, a response, the database outside the
  encrypted environment table, the report or the logs (R11, R12).
- Generated (AP-029, AP-032) runs keep their behaviour, argument list, environment, metrics and
  report. The generated script's bytes change once, under AP-029 FR-022a (R23), and stay
  deterministic.

**Scale/Scope**:
- Several scripts per session, each up to 1 MiB.
- One run in progress per session, shared with every other run kind.
- Long soak runs, kept to bounded memory by bucket doubling (R14).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.6.0. `specs/constitution.md` is identical,
with the same SHA-256 (`c98859a5…`).

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | N/A | No OpenAPI specification is involved. The report shows only k6's measurements (FR-031) and invents no expected status. |
| II. Deterministic before AI; III to VII, XXII, XXIII, XXIX. AI principles | Pass / N/A | No AI anywhere (FR-037). The check, host listing, name listing, aggregation and findings are deterministic (R3 to R5, R14, R16). |
| VIII. Framework-independent model | Pass | The new shared types describe scripts, checks, mappings and results. k6 command lines and environment handling stay in `performance/k6/`. |
| IX. Separation of concerns | Pass | The check, store, settings and run orchestration live in `performance/userScript/`. Routes stay thin. The generated-script path is untouched apart from shared helpers (contracts/changes-to-existing-apis.md). |
| X. Domain model first | Pass | `shared-domain/src/userScript.ts` (data-model.md). |
| XI. Human in the loop | Pass | Nothing runs without a confirmation of the exact bytes and a per-run trigger (FR-013 to FR-020). |
| XIII. Provenance | Pass | The run and report state that the script was user-supplied, with name and SHA-256, the load used, and the mapped names and their sources (FR-030, R16). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | The check refuses what it cannot prove safe (R3). Missing mapped values are shown before the run (R12). The exit code's meaning is reported (R13). A script that k6 cannot start is a failed run with k6's message (FR-029). |
| XV, XVI. Dependency inference; deterministic artifacts | N/A / Pass | No inference. The bytes executed are the confirmed bytes, checked at run start (R17). The amended AP-029 generator (R23) is still a pure function of the plan, so the same plan gives byte-identical scripts, and the golden fixture is regenerated once and reviewed. |
| XVII. Security and privacy (2026-09-30 exception) | Pass | Each condition is mapped in Constraints above. The other exceptions are untouched, and the generated-script argument list and environment are unchanged. A changed generated script is handled as a user script (spec Edge Cases). |
| XVIII. Secrets not in artifacts | Pass | Credentials are directed to environment values (FR-012). Values reach k6 only as process environment (R11). Every mapped value is treated as secret (R12). A seeded-secret scan covers responses, the database file, the report and the logs (R21). |
| XX. Observability without sensitive logging | Pass | Logs hold ids, counts, rule ids and SHA-256 prefixes only. stderr is filtered and never logged (R13; contract Logging). |
| XXI. Testability | Pass | The check is a pure function. The argument and environment builders are pinned. The runner is injected, and aggregation is fed by fixtures (R21). |
| XXIV. Reproducibility | Pass | The same bytes give the same check, and the same run data gives the same findings and report (FR-008, FR-036). |
| XXV. Incremental delivery | Pass | P1: upload, check, confirm, run, report. P2: mapping, load, thresholds. P3: editor. |
| XXVI. Traceability | Pass | FR, SC and R references run through the contracts, data model and quickstart. The spec's FR-006 and FR-026 additions are marked as planning amendments. |
| XXVII. Simple architecture | Pass | Two tables, one dependency, no queue and no sandbox service. The slot helper replaces three copies rather than adding a fourth (R9). |
| XXVIII. Technology is replaceable | Pass | `acorn` sits behind `checkUserScript()`. The editor's tokenizer sits behind `highlightJavaScript()`. |
| XXX. Explicit trade-offs | Pass | Recorded in research: the conservative JavaScript subset (R3), whole-text host scan (R4), raw-body upload instead of multer (R6), a separate run table (R9), no summary flag (R10), first-appearance name cap (R14), and no editor library (R19). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 9, docs, spec pointers, the version bump and the roadmap update. |
| XXXII. Review at scale | Pass | The confirmation lists every host. The check lists every problem at once, sorted by line. |
| XXXIII. Presentation | Pass | Built from AP-027 components and Tailwind tokens. Confirmation state, refusals and missing values use text as well as colour. Highlighting has text markers in the gutter. |

**Gate result: PASS.** No violations. Running a user's script depends on the 2026-09-30 exception,
and every one of its conditions is designed in.

**Re-check after Phase 1 design: PASS.** The design adds:
- one route family;
- two tables, whose sensitive fields are encrypted;
- one widened access condition, the one FR-024 permits;
- one consolidated slot helper;
- one optional runner input.

The generated-script runner contract is unchanged. No new network destination, stored plaintext
secret or AI is introduced. The two spec amendments narrow what is accepted; neither widens it.

## Project Structure

### Documentation (this feature)

```text
specs/034-run-user-k6-script/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1 to R23
├── data-model.md        # Phase 1: shared types, two tables, in-memory state
├── quickstart.md        # Phase 1: validation scenarios 1 to 9
├── contracts/
│   ├── user-scripts-api.md            # the new route family
│   └── changes-to-existing-apis.md    # environments gate, slot helper, runner, report, frontend
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── userScript.ts                      # NEW: types of data-model.md
└── index.ts                           # + export

backend/src/
├── performance/
│   ├── userScript/                    # NEW
│   │   ├── checkUserScript.ts         # acorn parse + rules R2, R3; hosts R4; names R5 (pure)
│   │   ├── numericGuarantee.ts        # R3 rule 4 scope and expression analysis (pure)
│   │   ├── exampleScript.ts           # fixed starter script (FR-010)
│   │   ├── mappingNames.ts            # FR-026 + reserved start-up names (pure)
│   │   ├── settings.ts                # initial mapping, merge on change, validation (R12)
│   │   ├── userScriptStore.ts         # session-scoped facade, check cache, onExpire
│   │   ├── userScriptRunStore.ts      # session-scoped runs facade, onExpire
│   │   ├── startUserScriptRun.ts      # R17 checks and background run
│   │   ├── exitCodes.ts               # R13 table (pure)
│   │   └── stderrFilter.ts            # R13 JSON log filter (pure)
│   ├── k6/
│   │   ├── renderScript.ts            # AP-029 FR-022a: check-clean runtime, VALUE_ENV (R23)
│   │   ├── runner.ts                  # + buildUserScriptK6Args, buildUserScriptChildEnv,
│   │   │                              #   optional args, stderr callback
│   │   └── metricsStream.ts           # + accept-all option, Metric declarations
│   ├── report/
│   │   ├── userScriptAggregate.ts     # NEW (R14)
│   │   ├── userScriptThresholds.ts    # NEW (R15)
│   │   ├── userScriptFindings.ts      # NEW (R16)
│   │   ├── renderUserScriptReport.ts  # NEW (R16)
│   │   └── renderHtmlReport.ts        # export shared helpers; output unchanged
│   └── startup.ts                     # + user-script run recovery
├── execution/executionSlot.ts         # NEW: findExecutionInProgress() (R9)
├── persistence/
│   ├── connection.ts                  # + user_scripts, user_script_runs
│   ├── userScriptRepository.ts        # NEW
│   └── userScriptRunRepository.ts     # NEW
├── api/
│   ├── userScripts.ts                 # NEW: routes of user-scripts-api.md
│   ├── performanceRuns.ts             # slot helper
│   ├── externalCollections.ts         # slot helper
│   └── testGenerationWorkflow.ts      # slot helper; requireEnvironmentAccess + hasUserScript
├── app.ts                             # + user scripts router
└── server.ts                          # + recovery call

backend/tests/
├── unit/performance/userScript/       # check corpus, determinism, hosts, names, mapping,
│                                      #   settings merge, exit codes, stderr filter, args, env
├── unit/performance/report/           # userScript aggregate, thresholds, findings, report
├── integration/userScripts/           # routes, refusal stores nothing, confirmation races,
│                                      #   run-start order, slot across kinds, restart, expiry,
│                                      #   environment gate, seeded-secret scan
├── integration/performance.k6.real.test.ts   # + one user-script run (opt-in)
├── fixtures/userScripts/              # NEW: accepted/, refused/ + expected.json, ndjson/
└── fixtures/performance/golden/script.js     # regenerated for R23, diff reviewed
backend/package.json                   # + acorn
backend/scripts/perfStubTarget.ts      # + echo of the API key header for quickstart 4

frontend/src/
├── App.tsx                            # + fourth tab and page; mount() generalised
├── components/EntryChooser.tsx        # + "user-script" entry
├── components/userScript/             # NEW
│   ├── ScriptList.tsx
│   ├── ScriptEditor.tsx               # textarea + overlay + gutter (R19)
│   ├── highlightJavaScript.ts         # tokenizer (pure)
│   ├── ScriptProblems.tsx             # reasons by line
│   ├── ScriptConfirmDialog.tsx        # FR-014
│   ├── ValueMappingEditor.tsx         # FR-025, FR-026
│   ├── UserScriptRunTrigger.tsx       # FR-019, FR-023
│   └── UserScriptRunActivity.tsx      # live progress, runs table, report frame
├── components/performance/
│   ├── usePerformanceRuns.ts          # generic over the run type
│   └── ThresholdEditor.tsx            # scope options as a prop
├── pages/UserScriptPage.tsx           # NEW
└── services/userScriptClient.ts       # NEW
frontend/tests/unit/                   # entry, list, editor, confirm, mapping, trigger, runs

docs/USER_MANUAL.md (new section 6), docs/architecture.md, README.md (feature list),
specs/ROADMAP.md, specs/031-k6-performance-testing/spec.md (FR-026 pointer),
specs/032-quick-performance-test/spec.md (FR-018 pointer),
specs/031-k6-performance-testing/contracts/performance-api.md (pointer),
package.json ×4 + package-lock.json (19.14.0 → 19.15.0, `npm run version:bump -- feature`)
```

**Structure Decision**: This uses the existing web-application layout.
- The feature is a new backend sub-module, `performance/userScript/`, beside `performance/quick/`.
  It has its own route family and its own frontend page.
- Reused from AP-029 without copying: the runner, probe, run directory, integrity check,
  cancellation, report helpers and runs hook.
- Changed elsewhere:
  - three in-progress checks are merged into one helper;
  - the environments gate gains one condition;
  - the runner gains an optional argument list and a stderr callback;
  - two frontend components take one more prop.

## Complexity Tracking

No constitution violations to justify.

Running a user-supplied script is covered by the constitution's 2026-09-30 exception (v2.6.0), and
every condition of it is designed in. The one new dependency, `acorn`, is justified in research R1.
The existing `multer` 1.x deprecation (R6, R22) is recorded for a separate bugfix and not changed
here.
