# Implementation Plan: Request-Chain Performance Plans

**Branch**: `037-request-chain-performance` (git branch `AP-037`) | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/037-request-chain-performance/spec.md` (AP-037)

## Summary

The engineer gets a performance plan they own outright, as in Postman or JMeter. A **request-chain
plan** is chains of concrete steps. Each step is a method, URL, query rows, headers and a body, with
expected statuses, extractors, checks, think time and a "runs" setting. `{{name}}` may appear in
any step text. A plan is seeded once from the specification, the guided workflow or a stored
collection, or started empty. After seeding it is never re-derived. It is saved locally, can carry
CSV data sets, and runs through ApiPilot's own deterministic k6 script.

**A new model beside the old (R1).**
- **What it is:** `ChainPlan` is a new shared-domain type with its own pure modules, store, route
  family (`/api/chain-plans`), fixed k6 runtime and report.
- **What it is not:** it is not a `PlanEngine` source and never a `PerformancePlan`.
- **Phase one** adds it beside the old plans and leaves their bytes, goldens and **Run again**
  untouched.
- **Phase two** deletes the old derived plan, its overlays and its runtime (R24).

**Editing and analysis.**
- **Saving.** Whole-document saves carry an optimistic revision into an encrypted `chain_plans` row
  (R2).
- **Analysis.** One pure analysis, shared by the editor and the server, walks the run order. It
  lists uses before extraction, setup-step restrictions, hosts from variables, missing expected
  statuses and required values (R3, R6, R7).
- **Credentials.** Literal credentials are moved into secret values of the target environment on
  save. Without a target environment the save is refused (R8).
- **Provenance.** A seed digest per step drives the **Changed** mark (R9).

**Seeding.** The existing builders are reused once to write concrete text:
- **Specification:** `selectPerformanceScenario` and `buildStepRequest`. Credential producers become
  **Once before load** steps, and unique fields become `{{$guid}}` and `{{$randomEmail}}` (R15).
- **Guided workflow:** the approved workflows' variables become extractors and references (R16).
- **Collection:** `readCollectionRequests` and `recognizeScript`. Nothing is run (R17).
- **Report:** everything not carried over is listed in a seeding report that never gates (R18).

**Runtime.** A second fixed interpreter, used only by chain plans (R10 to R13):
- **Scopes.** Iteration-wide values, with the latest write winning.
- **Runs settings.** Every iteration, once per virtual user (retried until it succeeds), or once
  before load.
- **Setup steps.** They run in `setup()`. A failure aborts the run before the load
  (`exec.test.abort`, `setup-step-failed`).
- **Token refresh.** Setup steps that state `expires_in` refresh per virtual user.
- **Checks.** Four check forms, counted separately from unexpected statuses.
- **Data.** The plan's content enters the script only as JSON tables.

**Data sets (R14).**
- **Parsing.** A built-in RFC 4180 parser.
- **Storage.** The uploaded bytes are encrypted at rest.
- **Run time.** A per-run JSON copy is written into the run directory, read with
  `SharedArray(open(fixed name))`, and removed with the directory.
- **Rows.** Taken in order by `exec.vu.idInTest` or `exec.scenario.iterationInTest`, wrapping when
  they run out. Wraps are counted, never valued.

**Runs and reports.**
- **Runs** share `performance_runs`, and so the execution slot, as `plan_source = 'chain'`, with an
  encrypted plan copy for restore (R19, R21).
- **Aggregate.** It reads a neutral `RunLayout`, and the legacy layout reproduces today's inputs.
- **Report.** A new chain report reuses the legacy report's helpers. Legacy reports are untouched
  (R20).

No dependency, no AI and no configuration variable is added. Two tables and three columns are added.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 24 LTS for the backend.
- React with TypeScript for the frontend.
- k6 1.0.0 or later, installed by the engineer. `k6/execution` (`exec.vu.idInTest`,
  `exec.scenario.iterationInTest`, `exec.test.abort`) and `k6/data` (`SharedArray`) are k6
  built-ins.

**Primary Dependencies**: Existing only:
- Express and `multer` (data set upload);
- `postman-collection` and `acorn` (collection seeding, read only);
- the AP-025 SQLite connection and credential cipher (AES-256-GCM, `node:crypto`);
- React, Vite and Tailwind CSS v4.

No CSV library (R14).

**Storage**:
- **New tables:** `chain_plans`, whose document is encrypted, and `chain_plan_data_sets`, whose file
  bytes are encrypted.
- **`performance_runs`:** gains `chain_plan_id`, `plan_document_encrypted` and `plan_document_iv`
  (data-model.md).
- **Ownership:** everything is session-owned and removed with the session.
- **In memory, as today:** generated scripts, keyed by plan id.

**Testing**:
- Vitest unit tests in shared-domain and backend.
- Supertest integration tests with the fake runner.
- `k6Sandbox`, extended with `k6/execution`, `SharedArray` and `open()` stubs.
- A new chain golden script. Legacy goldens are unchanged.
- React Testing Library with `stubFetch`.
- Three opt-in real-k6 cases (R25).
- A leak scan for SC-005.

**Target Platform**: A local web application, with the browser and the Node backend on one machine.
k6 runs on the backend's machine.

**Project Type**: A web application in the npm-workspaces monorepo: `backend/`, `frontend/` and
`packages/shared-domain/`.

**Performance Goals**:
- **Analysis.** `analyzeChainPlan` is linear in steps and references. It runs on every keystroke-level
  edit in the editor, so it must stay under 10 ms for 1,000 steps.
- **Seeding** takes under 5 seconds for 100 operations or 100 requests (AP-036 SC-005 precedent).
- **Script generation** takes under 1 second at the plan limits.
- **Data set upload** parses 5 MiB in under 2 seconds.
- **SC-001:** the seven-step chain can be built in under 10 minutes. The editor is laid out for
  that path (quickstart 1).

**Constraints**:
- **Constitution v2.8.0, XVII, the 2026-09-24 exception as extended on 2026-10-02 for AP-037.** Each
  condition maps to a design decision:

  | Condition | Design |
  |---|---|
  | "Approved" means reviewed at the run trigger: chains and step counts, write steps, hosts, data sets | FR-031, R7, R14, chain-plan-api "Runs", `ChainRunPanel` |
  | Seeding never executes or evaluates scripts and sends nothing; scripts are read as text against enumerated forms | R17 (`recognizeScript` grammar, unchanged) |
  | Step content, statuses, extractors and checks are data for one fixed runtime; no expression, pattern, filter or function; dynamic variables come from ApiPilot's code for a fixed list | R5, R10, R11, chain-script.md |
  | No environment value, data set value or literal credential in the plan, script or template; literals become secret environment values on save | R8, R10, R14, R22 |
  | Extracted values stay in virtual-user memory | R5, R11, chain-script.md "Metrics written" |
  | Data set values are encrypted at rest and reach k6 only at run time via a per-run copy read by a fixed name and removed afterwards; no other file; script bytes independent of content | R14, chain-script.md "Run-time inputs" |
  | Requests only to the base URL and literal hosts, each listed; a host from another variable is refused | R7 |
  | Plan, snapshot and report name the seed source or "added", mark changed steps, state content is the user's and unverified, with no content or value | R9, R19, R20 |
  | Saved plans are local, session-owned, secret-free, never logged, sent to AI or produced by AI | R2, R27, FR-038 |
  | First-list conditions: explicit trigger naming the environment; the exact generated bytes; a user-installed k6; no secrets; local results; load stated as from this machine | Unchanged mechanisms reused: integrity check, readiness probe, local metrics, UI notice |

- **Unchanged in phase one:** the legacy plans' HTTP behaviour, fingerprints, scripts and reports.
  AP-034's check passes for chain scripts without data sets.
- **Limits:**
  - from the spec: 20 chains, 50 steps per chain, 10 extractors, 10 checks, a 256 KiB body, and 5
    data sets of 5 MiB, 100,000 rows and 50 columns;
  - added by this plan: 50 plans per session, an 8 MiB document, 100 rows per list, and 8 KiB per
    value (R26).

**Scale/Scope**:
- Up to 1,000 steps in one plan.
- Several plans per session.
- One run at a time per session, shared with legacy and user-script runs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` **v2.8.0** (Last Amended 2026-10-02).
`specs/constitution.md` is identical (SHA-256 `6f56b617d07a…` for both).

**The spec's governance prerequisite** says that "the exception MUST be amended before
`/speckit-plan` continues". **Status: met.** v2.8.0 extends the 2026-09-24 exception to AP-037 with
its own meaning of "approved" and its own conditions. It is committed as `d0873c3` and contained in
`main`. The spec's Governance section is annotated with this.

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | Seeding takes success statuses and requests only from the specification (R15). After seeding, steps are the engineer's content, and are labelled so in the plan, snapshot and report. Nothing claims they are specification-grounded (FR-026, R9, R20). |
| II to VII, XXII, XXIII, XXIX. AI principles | N/A | No AI anywhere in the feature (FR-038). |
| VIII. Framework-independent model | Pass | `ChainPlan` and the analysis are in shared-domain with no k6 or Postman types. k6 specifics are only in `renderChainScript.ts`, and Postman specifics only in the collection seeder. |
| IX. Separation of concerns | Pass | Pure modules: seeders, CSV, credential mover, renderer, analysis. The routes are thin adapters. The UI calls `requestChainClient` only. |
| X. Domain model first | Pass | data-model.md. Types and analysis come before routes and UI (task order). |
| XI. Human in the loop | Pass | Seeding, every edit, generation and every run are explicit actions. Restore never starts a run (R21). |
| XIII. Provenance | Pass | Each step's seed source and **Changed** mark are in the plan, snapshot and report. The seeding report lists what was not carried over (R9, R18). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | These are listed or refused: use before extraction, setup restrictions, hosts from variables, mixed literal credentials, a missing target environment for a credential, malformed CSV with its line, and setup failure stopping the run. Spec tensions are raised as Open items rather than decided silently. |
| XV. Conservative dependency inference | Pass | Seeding chains only approved workflows (R16) and the collection's own setters (R17). Collection credential classification uses value usage only. ApiPilot creates no extractor outside seeding. |
| XVI. Deterministic artifacts | Pass | Ids come from plan counters. Seeding is pure and ordered. The script is canonical JSON plus fixed text, tested byte-identical ten times and independent of data set content (R10, R22). |
| XVII. Security and privacy (v2.8.0, AP-037) | Pass | Every condition is mapped under Constraints. Plan documents and data set files are encrypted at rest, and run copies are 0600 and removed (R2, R14). |
| XVIII. Secrets not in artifacts | Pass | Literal credentials move to secret environment values on save. Values reach k6 only as `APIPILOT_V_<i>` or the per-run data copy. The leak scan covers the plan row, script, template, snapshot, report and logs (R8, R25). |
| XX. Observability without sensitive logging | Pass | Logs carry ids, counts, sizes and codes only (R27, contract "Logging"). |
| XXI. Testability | Pass | Pure modules, the sandboxed runtime, the fake runner and `:memory:` repositories. Real k6 is opt-in only. |
| XXIV. Reproducibility | Pass | The same plan gives the same script. The same source gives the same seeded plan. Dynamic values derive from the virtual user, iteration, occurrence and run tag. |
| XXV. Incremental delivery | Pass | Phase one, by priority: P1 is US1 and US2; P2 is US3, US4 and US6. Phase two is P3, US5. Each phase ships on its own. |
| XXVI. Traceability | Pass | FR, SC and R references run through research, data model, contracts and quickstart. |
| XXVII. Simple architecture | Pass | One document per plan with whole-document saves. One runs table. No new dependency. A second runtime instead of entangling two models, justified under Complexity Tracking. |
| XXVIII. Technology is replaceable | Pass | Chains, steps, extractors and checks are domain types. k6 rendering and CSV storage are adapters. |
| XXX. Explicit trade-offs | Pass | Recorded in research: whole-document saves (R2), JSON fill mode (R4), latest write wins (R5), refusing a credential without an environment (R8), a second runtime (R10), `open()` against AP-034 (R10), the run plan copy (R21), the added limits (R26). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 10, USER_MANUAL, architecture, README, ROADMAP. Version bump `npm run version:bump -- feature` (19.17.0 → 19.18.0) for phase one; phase two bumps again. |
| XXXII. Review at scale | Pass | 1,000 steps: a collapsible chain tree with counts, an issues panel that jumps to steps, the write summary and hosts at the trigger. |
| XXXIII. Presentation | Pass | AP-027 tokens and existing components. Method badges, monospace for URLs and bodies only. Every state in text. Keyboard combobox. Responsive two-pane layout. |

**Gate result: PASS.**

**Re-check after Phase 1 design: PASS.** The design adds:
- one route family, two tables and three columns;
- one runtime, one report and four seeders' worth of pure modules;
- additive shared types.

It adds no network destination beyond the listed hosts, no stored value outside the encrypted
columns, no new execution path besides the generated script, and no AI.

## Open items for the engineer's confirmation

These change or interpret approved requirement text, so they were surfaced rather than decided
silently (CLAUDE.md §63).
- **Resolved:** items 1 to 4 and 7, confirmed by `/speckit-clarify` on 2026-10-03 (spec
  Clarifications, Session 2026-10-03), each as the plan proposed. The spec is amended accordingly.
- **Still open:** items 5 and 6. They need no spec change unless the engineer objects.

1. **Resolved 2026-10-03 (FR-014 amended). Data set columns in Once before load steps (R6).** FR-014 lists what a setup step may use and
   omits data sets. FR-043 and the Edge Cases say such a step uses the first row.
   - **Plan:** allow data set columns, taking the first row. Amend FR-014 to add "a data set column
     (first row, FR-043)".
2. **Resolved 2026-10-03 (FR-047 amended). AP-029 FR-022a against data sets (R10).** FR-022a requires every generated script to pass
   AP-034's check. A script that reads a data set must call `open()`, which the constitution's
   2026-09-30 exception forbids for user scripts.
   - **Plan:** FR-022a holds for plans without data sets. A plan with data sets downloads with a
     notice that its copy cannot be run as a user script.
   - **Amendment needed:** annotate AP-029 FR-022a and add the notice to FR-047's neighbourhood.
3. **Resolved 2026-10-03 (FR-027 amended). A literal credential with no target environment (R8).** FR-027 says the value moves into the
   target environment "when the step is saved". With none chosen there is nowhere to move it.
   - **Plan:** the save is refused with `credential_needs_environment`. When seeding with no
     environment named, the literal is dropped and listed in the seeding report as a secret value
     to provide.
4. **Resolved 2026-10-03 (FR-035 amended, including the data set SHA-256 condition on Run again). Run again and restore need content the snapshot must not hold (R21).** FR-035 restores chains
   and steps. FR-033 keeps request content out of the snapshot and the report.
   - **Plan:** store an encrypted copy of the plan document with each run, separate from the
     snapshot, read only by restore. It is never rendered or logged.
   - **Also:** **Run again** additionally requires each data set's SHA-256 to match the run's, so it
     repeats the same test. This extends AP-029 FR-024a's conditions.
5. **Basic auth when seeding (R15, R17).** The chain runtime has no auth kinds, so Basic must be a
   plain header.
   - **Plan:** literal user and password are encoded at seeding and moved to a secret value.
     Referenced ones become `Authorization: Basic {{<scheme>_basic}}`, and the seeding report says
     the value must be the Base64 of `user:password`.
6. **Added limits and at-rest encryption (R2, R26).** 50 plans per session, an 8 MiB plan document,
   100 rows per list and 8 KiB per value. Plan documents are encrypted at rest although they hold no
   secret value. Neither is in the spec. Both are bounded-resource and defence-in-depth choices, and
   need no amendment unless the engineer objects.
7. **Resolved 2026-10-03 (SC-006 amended: measure after phase one, agree a revised target if over). SC-006 is at risk.** SC-006 asks that performance plan code and screens be at most half their
   size after phase two.
   - **Baseline (2026-10-03):** 16,110 lines over the measured set below. The original target was
     8,055. Phase one measured 22,357; the target agreed on 2026-10-03 is at most 13,000.
   - **Estimate:** what phase two keeps comes to about 3,500 lines (run panel and hooks, load,
     threshold and environment editors, trimmed `performance.ts`, the seeding builders). The new
     chain code is estimated at about 5,000 lines. That makes the target reachable only if the new
     code stays lean.
   - **Plan:** track the count at the end of phase one. If it is above target, report it before
     phase two rather than cutting behaviour.

**SC-006 measured set** (non-test `.ts`/`.tsx` lines; a counting script,
`scripts/count-performance-lines.mjs`, is added by the tasks):
- **Backend:**
  - `backend/src/performance/{plan,collection,quick,chain}/**`;
  - `backend/src/performance/k6/renderScript.ts` and `renderChainScript.ts`;
  - `backend/src/api/{performanceRoutes,performanceTesting,quickPerformance,collectionPerformance,chainPlans,chainPlanHttp}.ts`.
- **Frontend:**
  - `frontend/src/components/performance/**` and `components/requestChain/**`;
  - `frontend/src/pages/{QuickPerformancePage,CollectionPerformancePage,RequestChainPlansPage}.tsx`;
  - `frontend/src/services/{performanceTestingClient,quickPerformanceClient,collectionPerformanceClient,requestChainClient}.ts`.
- **Shared:** `packages/shared-domain/src/{performance,requestChain}.ts`.

The report, runs routes, run orchestration, persistence and user-script code are outside it. They
are not plan code or screens.

## Project Structure

### Documentation (this feature)

```text
specs/037-request-chain-performance/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1 to R27
├── data-model.md        # Phase 1: shared types, analysis, snapshot, storage, lifecycle
├── quickstart.md        # Phase 1: validation scenarios 1 to 10
├── contracts/
│   ├── chain-plan-api.md            # /api/chain-plans routes, errors, logging
│   ├── chain-script.md              # generated script layout, run-time inputs, metrics, exit
│   └── changes-to-existing-apis.md  # phase one additive changes; phase two removals
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── requestChain.ts                      # NEW: types, parseReferences, analyzeChainPlan,
│                                        #   chainRunOrder, summarizeChainWrites (R3, R5, R6, R7)
├── capturePath.ts                       # MOVED from backend (AP-035 grammar, unchanged)
├── dynamicVariables.ts                  # MOVED: SUPPORTED_DYNAMIC_VARIABLES
├── performance.ts                       # + optional result fields, setup-step-failed
└── index.ts                             # exports

backend/src/
├── performance/
│   ├── chain/                           # NEW, pure except the store
│   │   ├── chainPlanStore.ts            # session-scoped access, onExpire cleanup (R2)
│   │   ├── savePlan.ts                  # validation, limits, changed flags, fingerprint (R2, R9, R22, R26)
│   │   ├── literalCredentials.ts        # R8
│   │   ├── csv.ts                       # R14 parser
│   │   ├── dataSets.ts                  # upload, replace, rename, preview, run copy (R14)
│   │   ├── runSnapshot.ts               # ChainRunSnapshot (R19)
│   │   ├── restore.ts                   # R21
│   │   └── seed/
│   │       ├── toChainStep.ts           # RequestTemplate → ChainStep, unique → dynamic, auth → headers
│   │       ├── seedFromSpecification.ts # R15
│   │       ├── seedFromWorkflow.ts      # R16
│   │       └── seedFromCollection.ts    # R17
│   ├── k6/renderChainScript.ts          # NEW: tables + CHAIN_RUNTIME (R10 to R14)
│   ├── report/
│   │   ├── runLayout.ts                 # NEW: layoutFromPlan, layoutFromChainSnapshot (R19)
│   │   ├── aggregate.ts                 # takes RunLayout; new streams
│   │   ├── findings.ts                  # labels from layout
│   │   └── renderChainReport.ts         # NEW (R20)
│   ├── runPerformanceTest.ts            # either run kind; data copies; setup-step-failed
│   ├── scriptStore.ts                   # + chain scripts keyed by plan id
│   ├── plan/capturePath.ts              # re-exports from shared-domain
│   └── collection/dynamicValues.ts      # re-exports the list from shared-domain
├── persistence/
│   ├── connection.ts                    # chain_plans, chain_plan_data_sets, run columns
│   ├── chainPlanRepository.ts           # NEW
│   ├── chainPlanDataSetRepository.ts    # NEW
│   └── performanceRunRepository.ts      # chain run methods; legacy lists exclude 'chain'
├── api/
│   ├── chainPlans.ts                    # NEW router (contracts/chain-plan-api.md)
│   └── chainPlanHttp.ts                 # NEW error mapping
└── app.ts                               # mount with 8 MiB JSON limit

backend/tests/
├── unit/performance/chain/              # csv, literalCredentials, savePlan, seeders ×3,
│                                        #   renderChainScript (golden, ×10, AP-034 check),
│                                        #   chainRuntime (sandbox), restore, runSnapshot
├── unit/performance/report/             # runLayout, chain aggregate, renderChainReport
├── unit/persistence/                    # chainPlanRepository, chainPlanDataSetRepository
├── integration/performance/chainPlanRoutes.test.ts
├── integration/performance.k6.real.test.ts            # + three opt-in cases (R25)
├── fixtures/chain/                      # weak-spec.yaml, customers.csv, bad CSVs, plans
├── fixtures/performance/k6Sandbox.ts    # + k6/execution, SharedArray, open() stubs
└── fixtures/performance/golden/chain-script.js        # NEW; legacy goldens unchanged
backend/scripts/perfStubTarget.ts        # wrong-id and slow switches (customers-auth mode)

packages/shared-domain/tests/unit/       # requestChain analysis, references, writes

frontend/src/
├── App.tsx                              # Performance plans tab
├── pages/RequestChainPlansPage.tsx      # NEW: list, new, open, duplicate, delete
├── services/requestChainClient.ts       # NEW
├── components/requestChain/             # NEW
│   ├── ChainPlanEditor.tsx              # two-pane tree + step
│   ├── ChainTree.tsx
│   ├── StepEditor.tsx                   # Request / Extract / Checks / Settings
│   ├── KeyValueRows.tsx, BodyEditor.tsx, ExtractorRows.tsx, CheckRows.tsx
│   ├── ReferenceField.tsx               # `{{` combobox (FR-005)
│   ├── PlanIssues.tsx                   # blockers, values, hosts, notices
│   ├── DataSetsPanel.tsx
│   ├── SeedingReportView.tsx
│   ├── SeedPlanDialog.tsx               # used by the three entry points
│   └── ChainRunPanel.tsx                # trigger (chains, writes, hosts, data sets), runs, Run again, restore
├── components/performance/PerformanceTestingStage.tsx  # + Create request-chain plan
├── pages/QuickPerformancePage.tsx                      # + Create request-chain plan
└── components/ExternalCollectionRunPanel.tsx           # + Create request-chain plan
frontend/tests/unit/                     # plans page, editor, combobox, data sets, seed dialog, trigger

scripts/count-performance-lines.mjs      # NEW: SC-006 measurement
docs/USER_MANUAL.md, docs/architecture.md, README.md, specs/ROADMAP.md,
package.json ×4 + package-lock.json (19.17.0 → 19.18.0, `npm run version:bump -- feature`)
```

**Structure Decision**: The feature uses the existing web-application layout.
- **Backend:** the chain plan lives in a new `backend/src/performance/chain/` package of pure
  modules, with one store and one router. It reuses the run pipeline (table, slot, runner,
  integrity check, run directory) through a neutral aggregate layout.
- **Frontend:** a new page and a `requestChain/` component folder, reusing the load, threshold,
  environment, run-hook and report-frame components.
- **Phase two** removes the legacy plan modules listed in research R24 and changes-to-existing-apis.md.

## Complexity Tracking

There are no constitution violations to justify. Three choices go beyond the minimum, and each is
bounded:

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| A second fixed k6 runtime (R10) | Chain semantics differ from the legacy runtime in scopes, runs settings, checks, setup abort and data sets. | Extending the shared runtime would change every legacy script's bytes, disable **Run again** for every existing run, and couple two models that phase two separates. The legacy runtime is deleted in phase two, leaving one runtime. |
| The aggregate takes a `RunLayout` (R19) | Chain runs must reuse the stream aggregate and the shared execution slot. | A second aggregate would duplicate about 440 lines. A second runs table would duplicate the repository and need a second slot check, which risks concurrent runs. |
| An encrypted run plan copy (R21) | FR-035 restore needs step content, which FR-033 keeps out of the snapshot. | Putting content in the snapshot breaks FR-033. Not restoring breaks FR-035. |
