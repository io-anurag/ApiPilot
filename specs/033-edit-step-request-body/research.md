# Research: Edit a Performance Step's Request Body (AP-033)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-29

Each decision records what was chosen, why, and what was rejected. Code references are to the
state of the `AP-033` branch on 2026-09-29.

## Starting point (verified in code)

- A step's request is built by `buildStepRequest` (`backend/src/performance/plan/stepRequest.ts`)
  from the step's scenario. Substitutions are applied to the scenario's body **object** before it
  is serialized:
  - workflow variables through `applyWorkflowSubstitutions`
    (`backend/src/postman/workflowVariables.ts`), which creates missing intermediate objects;
  - per-iteration unique fields through `setDotted`, which only replaces keys that exist;
  - credential fields through `substituteCredentialsInBody`
    (`backend/src/postman/requestItem.ts`), by field name (`credentialKindForField`).
  The Postman builder then serializes the body (`JSON.stringify(body, null, 2)` for JSON, the
  string as is for `text/*`), and `templateFromItem` copies it to `RequestTemplate.body`.
- `stepRequestFor` (`plan/planStepRequest.ts`) is the single function that both `renderScript`
  and the step preview (`plan/requestPreview.ts`) call. Plan assembly does **not** use it:
  `buildJourneys.makeStep` calls `buildStepRequest` directly for `requiredValues`, and collects
  unique-field candidates from the raw scenario body.
- Unique tokens are named by position, `apipilot_unique_<index>`, where `<index>` is the entry's
  index in `plan.uniqueValueFields` (`uniqueTokensOf`). The index changes when another step is
  removed or restored.
- The script embeds every step's request in `const JOURNEYS = ${JSON.stringify(journeys, null, 2)}`
  (`k6/renderScript.ts`). At run time `fill` replaces `{{name}}` inside the body; in JSON mode the
  value is escaped as JSON-string content, so references are only ever inside JSON strings.
- The plan is edited only through `PUT <base>/plan` and the pure `applyPlanUpdate`
  (`plan/planUpdate.ts`). `assemblePlan` (`plan/buildPlan.ts`) rebuilds everything from choices.
  The guided plan is rebuilt lazily when `upstreamFingerprint` changes (`rebuildPlan`); the quick
  plan is never rebuilt, only replaced by a new upload.
- A run stores the whole `PerformancePlan` as `plan_snapshot`, unencrypted, because it "holds no
  variable value, body, token or resolved URL" (`persistence/connection.ts`, AP-029 research D20).
- There is no backend validator of a body value against a request schema. `walkFields`
  (`testDesign/requestHelpers.ts`) walks object properties only, not array items. `ajv` is only a
  hoisted transitive package, not a backend dependency.

## R1. What the editor edits: the base body, not the as-sent text

**Decision**: The engineer edits the step's **base body**: the body before ApiPilot applies its
own substitutions. For a generated step that is the scenario's body. ApiPilot then applies the
same substitutions to the edited body that it applies to a generated one: workflow variables at
their consumer field, unique values at their field path, and credential references by field name.
The preview, built from the result, stays what the script sends.

The editor shows two things:
- the base body, for editing;
- beside it, the fields that are replaced at run time and by what. These are taken from the
  preview's body references, for example "`customerEmail`: unique per virtual user and
  iteration".

The engineer can also write `{{name}}` in any JSON string value, or anywhere in a text body. That
refers to an environment value.

**Rationale**:
- Unique tokens are named by position in `plan.uniqueValueFields`. A stored as-sent text holding
  `{{apipilot_unique_3}}` would point at a different field, or at nothing, as soon as another step
  is removed or restored. Workflow variable names are internal (`<workflowId>_<name>`) and would
  go stale the same way.
- Re-applying substitutions keeps every ApiPilot-applied reference working without the engineer
  touching it, which is the user's requirement ("keep … references working").
- Credential substitution keeps working as a safety net. A literal typed into a field such as
  `password` is replaced by `{{password}}` in the script, as it is for generated bodies.

**Spec amendment** (made in spec.md with this plan): FR-009 said the engineer can "keep, move or
remove any reference". A reference ApiPilot applies (a workflow variable, a unique field, a
credential) is bound to its field. The engineer keeps it by keeping the field and removes it by
removing the field (FR-010), but cannot move it. References the engineer writes can be placed
anywhere. User Story 3's independent test and scenarios are adjusted to match.

**Alternatives considered**:
- *Edit the as-sent text, including ApiPilot's tokens.* Rejected: positional token names go stale
  (above), and internal names would be exposed as if they were part of the contract.
- *Make unique token names stable (hash of step and field).* Rejected: it changes every generated
  script, including the reviewed golden file, to support one editor. It also still leaves workflow
  names internal.
- *Edit the as-sent text and map tokens back on save.* Rejected: a two-way mapping is fragile and
  hard to explain when a token has been moved or duplicated.

## R2. Where the edit is stored

**Decision**: The edit is stored in the plan, as `PerformancePlan.bodyEdits: BodyEdit[]`, sorted
by `stepId`. A JSON edit stores the **parsed value**, not the typed text. A text edit stores the
string. Each edit records its `stepId`, `operationKey` and the `scenarioId` the step used when the
edit was saved (data-model.md).

**Rationale**:
- The plan is the approved input of the XVII exception (constitution v2.5.0), so edits belong in
  it and in its fingerprint.
- Storing the parsed JSON value makes the script body `JSON.stringify(value, null, 2)`, exactly as
  for generated bodies. Two edits that differ only in whitespace give the same script, and key
  order follows the engineer's text, so the same edits always give the same bytes (FR-015).
- `scenarioId` lets a rebuild tell "same step, same scenario" from "same step, new scenario"
  (R9).

**Alternatives considered**:
- *A separate per-session edit store beside the plan.* Rejected: two stores to keep in step, and
  the fingerprint would not see the edits.
- *Store the typed text.* Rejected: whitespace-only differences would change the script.

## R3. One place applies the edit

**Decision**: A new pure function, `effectiveScenario(scenario, edit)`, in
`plan/bodyEdits.ts`. It returns the scenario with `request.body` replaced by the edit's value, or
the scenario unchanged when there is no edit. It is called in the two places that build a step's
request from a scenario:
- `buildJourneys.makeStep`, for `requiredValues` and unique-field candidates;
- `stepRequestFor`, for the script and the preview.

**Rationale**: The preview and the script already share `stepRequestFor` (AP-032 Q8). Routing plan
assembly through the same effective scenario makes the plan's needed values (FR-011) and unique
fields agree with what is sent. No third path can differ.

**Alternatives considered**: *Replacing the body inside `buildStepRequest` from a plan lookup.*
Rejected: `buildStepRequest` is also used for chained-login token requests and knows nothing
about the plan.

## R4. References in an edited body

**Decision**:
- **Workflow variables.** For an edited step, a consumer with location `body` is applied only if
  its field path exists in the edited body. `applyWorkflowSubstitutions` would otherwise create
  the field again. A dropped consumer produces the notice `workflow-variable-dropped` (FR-010).
  The step's order constraint (`dependsOn`) is unchanged, so the step still runs after its
  producer, which is harmless. Unedited steps keep today's behavior exactly.
- **Unique fields.** `uniqueValueCandidates` runs on the effective body, so a removed field is no
  longer a candidate. Comparing the candidates of the generated body with those of the edited body
  produces `unique-field-dropped` notices (FR-010).
- **Credential fields.** Unchanged: `substituteCredentialsInBody` runs on the edited body.
- **Engineer-written references.** A `{{name}}` is recognised by the existing `REFERENCE` pattern.
  In a JSON body it can only be inside a string, because the edit must parse as JSON and the
  run-time `fill` escapes values as JSON-string content. The name goes into `envNames` and so into
  `requiredValues`, `userSuppliedValues`, the environment template and the checklist (FR-011) with
  no new code.
- **Reserved names.** A reference whose name starts with `apipilot_unique_`, or equals a workflow
  variable name of the plan or the token variable of a token source, is refused with
  `reserved_reference`. It would otherwise be resolved as something the engineer did not mean.

**Rationale**: Every existing substitution keeps one implementation. The only behavior change is
for edited steps, where the engineer has deliberately removed a field.

## R5. The body stays data in the script

**Decision**: No change to how the script is written. The body is a string inside
`JSON.stringify(journeys)`, which escapes quotes, backslashes, control characters, U+2028 and
U+2029, so no body content can become script code (FR-013; constitution v2.5.0 XVII condition).
A test renders a plan whose edited body contains `"`, `\`, a backtick, `${1}`, `</script>`,
`*/`, U+2028 and U+2029. It asserts that the script still parses and that the step's `request.body`
in `JOURNEYS` equals the expected text byte for byte.

**Alternatives considered**: none needed. The existing mechanism is correct, and the test pins it
so a later change cannot regress it silently.

## R6. Checks on save

**Decision**: `PUT /plan` accepts `bodyEdits: { [stepId]: BodyEditInput | null }`. Each entry is
checked, in this order, and the whole update is refused on the first failure (400, nothing saved).
The error names the step:
1. The step exists in the plan and is not removed: `invalid_body_edit`.
2. The operation documents a request body whose primary content type is JSON-like
   (`application/json`, `*+json`, or none declared, as `buildBody` treats it) or `text/*`, and the
   edit's `kind` matches it: `body_not_accepted`. Form and multipart bodies stay view-only.
3. The text is at most 64 KiB in UTF-8: `body_too_large`.
4. A JSON edit parses: `invalid_body`, always with `line` and `column` (FR-004). `JSON.parse`
   stays the parser, but V8's messages do not always carry an offset (for example "Unexpected end
   of JSON input"). The offset therefore comes from a small, pure, single-pass JSON syntax scanner,
   `jsonErrorOffset(text)` in `plan/bodyEdits.ts`, run only when `JSON.parse` has failed. It is
   linear in the text (at most the 64 KiB of check 3) and returns the offset of the first
   character that cannot continue a valid JSON text, or the end of the text for an unfinished one.
   The offset is converted to a 1-based line and column. The parser's message is not returned, because V8 quotes part of the input in it; the
   message is ApiPilot's own, for example "Not valid JSON at line 3, column 5." Any JSON value is
   accepted, including a top-level string, number or boolean; a top-level type that differs from
   the schema's is a mismatch (R7), not a refusal. (Amended 2026-09-29 by `/speckit-analyze`
   findings U1 and U2: a former check refused non-object top-level values, and the position was
   optional.)
5. No reserved reference (R4): `reserved_reference`, naming the reference.
6. No literal value in a sensitive field (R8): `body_secret_literal`, naming the field.

A `null` entry resets that step's body (FR-017). An edit equal to the generated base body is
stored as no edit (spec edge case).

**Rationale**: This follows `PUT /plan`'s existing all-or-nothing validation (`applyPlanUpdate`),
so a mixed update never half-applies. The 64 KiB limit is well under the app's JSON body limit
(`MAX_UPLOAD_BYTES`, 10 MiB) and bounds session memory (spec Assumptions).

## R7. Schema mismatches: a small, schema-only checker

**Decision**: A new pure module, `plan/bodySchemaMismatches.ts`. It walks the edited JSON value
against the operation's primary request-body `SchemaConstraint`, including array items, to the
existing `MAX_TRAVERSAL_DEPTH`. It reports, per field path:
- a missing required property;
- a wrong type;
- a value not in a documented `enum`;
- a documented `format` the generator already knows (`email`, `uuid`, `date`, `date-time`, `uri`,
  `hostname`, `ipv4`, `ipv6`, `byte`) that the value does not match;
- `minimum`/`maximum`, `minLength`/`maxLength` and `minItems`/`maxItems` violations.

A top-level value whose type differs from the schema's is reported as a `type` mismatch at
`fieldPath` `""`. A string value that is exactly one `{{name}}` reference is never reported
(FR-005). Mismatches are
returned with the step preview and the save response. They do not block saving or generation.
Text bodies are not checked.

**Rationale**:
- The rules are the constraint vocabulary the rule-based generator already uses
  (`valueGenerators.ts`), so a warning never claims something the specification does not say
  (constitution I).
- `pattern` is deliberately not evaluated. It would run a regular expression taken from an
  uploaded specification against engineer text, which is a ReDoS risk for a warning the spec does
  not require (FR-005 lists required, type, enum, format and bounds).
- Unknown properties are not reported. OpenAPI allows additional properties unless stated
  otherwise, and the analysis does not model `additionalProperties: false`, so such a warning
  would often be false.

**Alternatives considered**:
- *`ajv` with `toJsonSchema`.* Rejected: `ajv` would become a new direct dependency, and its
  errors would need mapping back to plain words anyway.
- *Block saving on mismatch.* Rejected by the user (Clarifications, Q2).

## R8. Literal values in sensitive fields

**Decision**: For a JSON edit, every field the request schema declares `format: password`
(walked as in R7) that is present in the edited body must hold exactly one `{{name}}` reference.
Anything else is refused with `body_secret_literal {stepId, fieldPath}`, including the generated
value left unchanged while another field was edited. Fields are identified from the schema only
(FR-012a).

The editor shows, at all times, "Values you type are written into the script. Reference secrets
from the environment as `{{name}}`." (FR-012).

**Rationale**: This is the user's decision (Clarifications, Q3) and the v2.5.0 XVII condition,
which refuses "a literal value" in such a field without exception. An edited body therefore always
needs a reference there, even when the engineer changed another field. A generated password is not
usable against a real target anyway. (Amended 2026-09-29 by `/speckit-analyze` finding C1: an
earlier draft accepted the unchanged generated value.)

**Known limit** (recorded, not solved): a literal secret typed into a field the schema does not
mark `format: password` is stored in the session's plan. In the script it is still replaced by
credential substitution when the field name is a detected credential name. Detecting secrets in
arbitrary fields would mean guessing, which FR-012a forbids. The editor's statement is the
safeguard, and the user manual repeats it.

## R9. Edits across plan changes

**Decision**:
- **Plan edits (`applyPlanUpdate`).** `choicesOf` carries `bodyEdits`. An edit is kept when its
  step exists, or when its `operationKey` is in `excludedOperationKeys`. Step ids are
  content-derived (`identifiers.ts`), so a restored operation gets the same step id and its edit
  back (FR-018). The Removed view's preview (`buildRemovedOperationPreview`, which restores
  virtually) therefore shows the edit.
- **Guided rebuild (`rebuildPlan`).** An edit is kept when its step exists with the same
  `scenarioId`, or its operation is still removed. Otherwise it is discarded, and the operation key
  is added to `discardedBodyEdits`.
- **Discard notice lifetime.** `discardedBodyEdits` is not fingerprinted and is carried through
  `choicesOf`. It is cleared by the next `PUT /plan` of any kind, or by the next rebuild. The guided
  rebuild runs when the plan is opened after an upstream change, so the notice is on screen at the
  moment it matters.
- **`POST /plan/reset`** keeps body edits, as it keeps expected statuses, exclusions and thresholds.
  It only resets order. Resetting bodies is its own action (FR-017).
- **Quick replace.** A new upload replaces the whole quick test after the existing confirmation
  (AP-032 FR-021). Edits go with it, and the confirmation text says so.

**Rationale**: This is the same carry-over rule the plan already applies to expected statuses (by
step id), plus the scenario check that FR-018 requires.

## R10. Fingerprint and out-of-date marking

**Decision**: `planFingerprint` includes `bodyEdits` **only when it is not empty**. `bodyEditNotices`
and `discardedBodyEdits` are derived and excluded, like `stepsNeedingExpectedStatus`. Saving or
resetting an edit changes the fingerprint, so the existing `script.outOfDate` logic marks the
script out of date (FR-007) and blocks download and run until it is regenerated.

**Rationale**: A plan with no edits keeps exactly today's fingerprint and script. Existing plans,
tests and the reviewed golden files are unchanged byte for byte.

## R11. Run snapshot and report hold no body

**Decision**:
- Each step with an edit carries `bodyEdited: true` (optional, absent otherwise, and not written
  into the script).
- `POST /runs` stores `planSnapshotForRun(plan)`: the plan with `bodyEdits` emptied and
  `discardedBodyEdits` cleared. The steps' `bodyEdited` flags are kept (FR-014).
- The report marks each such step "Body edited by you". Its provenance section states that N steps
  sent a body written by the engineer, not generated from the specification (constitution XI,
  XIII).
- `SqlitePerformanceRunRepository.toRun` defaults the new plan fields to empty for rows written
  before this feature.
- No migration: the flags live in the existing `plan_snapshot` JSON. The table comment "holds no
  … body" stays true and is covered by a test that scans the stored row.

**Alternatives considered**:
- *A new `edited_steps` column.* Rejected: the information is per step and already has a home in
  the snapshot.
- *Encrypt `plan_snapshot`.* Rejected: it is simpler and safer never to store the body.

## R12. API shape

**Decision**:
- **`PUT <base>/plan`** gains `bodyEdits` (R6). The response is the usual `{plan, script}`. "Reset
  all" is one `PUT` with every edited step set to `null`.
- **`GET <base>/plan/steps/:stepId/request`** returns the existing `StepRequestPreview` with new
  fields:
  - `bodyStatus`, one of `sent`, `not-documented`, `documented-not-sent` or `unsupported-content-type`
    (FR-001);
  - `bodyEdit`, the editor's model: kind, base text, edited flag and mismatches (data-model.md).
- **`GET <base>/plan/removed-operation`** returns the same preview shape. The client does not
  offer editing there (FR-003).

Both paths get all of this through the shared `registerPerformanceRoutes`.

**Rationale**: One edit route is kept, as for every other plan edit (AP-029). The per-step `null`
reset mirrors how `expectedStatuses` is sent.

## R13. Frontend

**Decision**:
- **`StepBodyEditor`** (new, `frontend/src/components/performance/`), rendered inside
  `StepRequestPreview` for steps in the plan:
  - a labelled monospace `<textarea>`;
  - Save and Cancel;
  - "Reset to generated body", confirmed through the existing `ConfirmDialog` with
    `affectedCount={1}`;
  - the always-visible statement about literal values (R8);
  - the list of fields replaced at run time;
  - the mismatch warnings;
  - errors returned by the server, with line and column.
- **`JourneyList`**: a "Body edited" `StatusBadge` on each edited row (text, not colour); a
  "Body edited · N" filter chip; and "Reset all edited bodies" through `ConfirmDialog` with
  `affectedCount={N}` (FR-008, FR-017, SC-006).
- **Notices**: `bodyEditNotices` in the step inspector; `discardedBodyEdits` as a note on the plan
  screen.
- **Other text**: the preview's "View only" line stays for removed operations and for
  headers/query. For steps without a body it reads "This request has no body." (FR-001).
- **Client**: `PlanUpdate` in `performanceTestingClient.ts` gains `bodyEdits`. No new client
  function and no new dependency. Styling uses Tailwind utilities and existing tokens (constitution
  XXXIII).

**Rationale**: Existing components cover the dialog and the badges. The editor is the only new
component, and a plain textarea serves the 64 KiB bodies of this feature without an editor
library.

## R14. Logging and dependencies

**Decision**: No body text, parser message or field value is logged. The existing
`performance_plan_built` event gains only `bodyEditCount`. No new dependency, no configuration, no
AI.
