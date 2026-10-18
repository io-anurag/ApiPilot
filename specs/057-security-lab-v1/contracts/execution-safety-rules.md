# Contract: Execution Safety Rules (binding)

**Status**: behavioural contract for `backend/src/securityLab/execution/`. **Spec**: FR-034 to FR-052, SC-006 to SC-009.
Research: R8 to R14. Every rule here is enforced by the server's execution service; the UI mirrors them but is never the
only enforcement point (FR-036). A test that calls the service directly, bypassing the router and the UI, covers each rule.

## 1. What the service may send

The service builds each request from an approved `SecurityScenarioVersion` and the profile snapshot **only**: base URL from the
environment snapshot, path from the operation, parameters and body from `baseRequest` after the scenario's typed
mutations, credentials resolved by variable name from the environment. No model output, scenario field or imported content
names a URL, host, port, or a header chosen by content. A scenario whose content parses as a URL in any string field that
is not a documented example value is rejected at validation (contracts/security-scenario-contract.md).

## 2. Destination policy

Evaluated by one pure function, `evaluateDestination`, at: profile save, run preview, the connect step of **every** request,
and **every** redirect hop.

| Step | Rule | Block reason code |
|---|---|---|
| 1 | Scheme is `http` or `https`; no userinfo | `scheme_not_allowed`, `userinfo_not_allowed` |
| 2 | Host (lowercased, trailing dot removed, IDNA-normalised) is in `allowedHosts` | `host_not_allowed` |
| 3 | Port (default by scheme) is in `allowedPorts` | `port_not_allowed` |
| 4 | Connected address class: `loopback`, `private`, `cgnat`, `link-local`, `unique-local`, `multicast`, `unspecified`, `mapped-ipv4` (judged by the embedded v4), `public` | |
| 5 | Always blocked: `169.254.169.254`, `fd00:ec2::254`, and the `unspecified` class | `metadata_address_blocked`, `unspecified_address_blocked` |
| 6 | Any non-`public` class is allowed only if tier is `local` **and** `allowedAddressRanges` names that address or contains it | `restricted_address_blocked` |
| 7 | A literal IP host must pass steps 4 to 6 and also appear in `allowedHosts` | `literal_ip_not_allowed` |

The address checked is the address connected to: the sender's socket `lookup` resolves all candidates, applies steps 4 to
7 to each, and connects only to an allowed one; if none is allowed the request fails with the first block reason. A
hostname that resolves to both an allowed and a restricted address connects only to the allowed one. A re-resolution to a
different answer is checked again, because each connect performs its own lookup.

Redirects: the library never follows. A 3xx with a `Location` is parsed against the current URL, evaluated as a new destination
(steps 1 to 7), and followed only if allowed, at most 3 hops, dropping `Authorization`, `Cookie` and `Proxy-Authorization` on
a cross-origin hop and counting each hop against the request budget. A disallowed or excess hop records
`redirect_blocked` with the redacted target and does not send.

Proxies: environment proxy variables are ignored. TLS: certificate verification is on unless `tlsPolicy = "relaxed-local"`,
which is accepted only for a `local` profile and is printed in the run summary and recorded in the run snapshot.

## 3. Tiers

| Tier | Treated as | Confirmation | Restricted addresses | Destructive |
|---|---|---|---|---|
| `local` | local profile | digest + authorization attestation | only those named in `allowedAddressRanges` | needs profile flag and per-scenario confirmation |
| `dev`, `qa`, `staging` | staging-like | digest + exact target name + exact base URL + attestation | never | needs profile flag and per-scenario confirmation at approval and at run |
| `production` | refused | not applicable | not applicable | not applicable (`production_tier_refused` on save and use) |

## 4. Limits

Defaults and ceilings come from research R11 and are validated at startup. A profile value above its ceiling is refused on save and
clamped never. Preview computes `plannedRequests = Σ plannedRequestCount + redirect allowance (0) + cleanup requests` and refuses a
plan above `min(profile.maxRequests, ceiling)` with the required and allowed counts. The budget counter is decremented
before a request is sent; when it reaches zero no further request is sent and the remaining scenarios are recorded `not_run`
with reason `budget_exhausted`. A request is never retried automatically.

Concurrency is a fixed-size worker pool. Per-request deadline = the effective timeout; the response is read to the byte cap
and flagged truncated. Rate-limit probes are bounded by `request.repeat.count`, which the generator caps at the lesser of
(documented or configured threshold + margin) and the repeat ceiling.

## 5. Cancellation and cleanup

Cancel sets the run flag and aborts every in-flight request through its `AbortSignal`; workers stop dequeuing. Results already
recorded stay; unstarted scenarios are `not_run` (`cancelled`). Cleanup then runs once (it may exceed the budget by the
planned cleanup requests only, which are included in the plan). Cleanup applies the profile strategy:

- `none`: no cleanup request; a scenario that creates data (a `POST` with a documented create semantics, or any destructive
  mutation) while strategy is `none` is classified **destructive** at generation (FR-045).
- `delete-created-via-spec`: for each scenario that created a resource, read `idField` from the creating response, build the
  documented `DELETE` operation for that resource from the model, and send it through the same sender and policy. If the
  specification has no such operation, or the id cannot be read, the cleanup is `failed` with `leftBehind` naming the
  resource and `manualRemoval` instructions.

Every cleanup outcome is in the run result. A run with any failed cleanup is flagged and the run summary lists what remains
(FR-046, SC-008).

## 6. Secrets, redaction and where results live

Two lifetimes (FR-051). The **redacted evidence records** are session data: stored encrypted in a session-scoped table and removed
with the session. What the run keeps as retained work is the **observed summary** of each result: the status code, a fixed set of
response header names with redacted values, and a deterministic statement, never a body excerpt. The run keeps a profile
summary (name, tier, base URL, limits, TLS policy), never identities, test data values, host allow-lists or credentials.

Credential values are read from the environment's encrypted `variableValues` at send time and held only in memory for the
run. Evidence records are redacted at construction (headers, URL query, JSON and form fields by name and by shape, and every
resolved credential value by literal match). Logs contain run id, scenario id, stage, outcome code, duration, error
category and nothing else. Reports and exports are built only from stored redacted records and variable names.

## 7. Failure semantics

Anything that prevents an honest judgement is recorded, never converted to pass: blocked destination → `blocked`; missing
prerequisite → `blocked`; transport failure → `errored`; budget or cancel → `not_run`; undecidable condition →
`inconclusive`. A block or a transport failure of one scenario never stops the run unless the user cancels.

## 8. Test obligations

1. Destination matrix: each block reason, each tier, literal IPs, IPv4-mapped IPv6, metadata addresses, trailing-dot and
   case variants, userinfo.
2. Rebinding: an injected resolver returns an allowed address at save and a restricted one at connect; the request is blocked.
3. Redirects: cross-origin drop of credentials, hop limit, redirect to a disallowed host, redirect to a metadata address.
4. Budget: concurrency of 4 against a budget of 10 never sends 11.
5. Cancel: in-flight abort, no new request after the flag, cleanup still attempted.
6. Cleanup failure surfaces in the result.
7. Direct-to-service calls bypassing the router obey every rule.
8. Seeded-secret corpus over evidence, observed summaries, retained run rows, logs, findings, report, export.
8a. After a forced session expiry: profiles, identities, test data and evidence are gone; retained results and observed summaries
    remain and contain none of them; a new run without a profile is refused.
9. Windows: `localhost` resolving to `::1` and `127.0.0.1` against a local profile that names only one of them.
