# Validation: Performance Test from a Postman Collection (AP-036)

## Governance

- **Constitution v2.7.0** (XVII's 2026-09-24 exception extended to collection-based performance
  plans) is merged to `main` as commit `35ef45d` ("docs: amend constitution to v2.7.0 (XVII covers
  collection-based performance plans, AP-036)"), checked on 2026-10-02 with `git fetch origin main`.
- `git diff origin/main HEAD -- .specify/memory/constitution.md specs/constitution.md` is empty: the
  branch's constitution is the merged one.
- `/speckit-implement` was therefore allowed to start (plan, Constitution Check).

## Automated validation (2026-10-02, version 19.17.0)

Run from the repository root, exactly as below.

| Command | Result |
|---|---|
| `npm test` | 315 files passed, 3 skipped; 2,674 tests passed, 16 skipped (the opt-in real-k6 cases). No failure. |
| `npm run lint` | No error, no warning. |
| `npm run build` | Succeeds (exit 0) for backend, frontend and shared-domain. |
| `npm run test:k6-real -w backend` | 13 passed with k6 v2.3.0 (Windows), including the four AP-036 cases below. |

Baseline before the feature: backend 1,878 tests passed; frontend 517 passed.

### Real-k6 cases (T068)

Against the customers target with token issue, 401 without a valid token and 409 for a repeated
email, using `apifoundryCollection({ dynamicBody: true })`:
- 2 virtual users, 10 s: one token issued before the load; no 401, 404 or 409; every PATCH and
  DELETE used its own virtual user's customer id (SC-001, SC-002).
- 10 virtual users, two 5 s runs with different run tags: every email unique within and across the
  runs, no 409 (SC-006).
- `expires_in: 10`, 2 virtual users, 40 s: refreshes from the virtual users, none failed, no 401
  (FR-028).
- Token endpoint answering 500: the setup failure is counted for the credential request, and the
  steps fail as authentication errors (FR-029).

The first run of these cases found a defect the Node sandbox had hidden: k6 passes setup data to
virtual users with `undefined` written as `null`, so a failed token source threw in every
iteration. The runtime now checks with `Array.isArray`, and the sandbox serialises setup data as k6
does. The four goldens changed in those two lines only.

### Goldens

- `golden/script.js` and `golden/user-journeys-script.js`: regenerated for research R10 (the
  `DYNAMIC` table, token sources with `captures` and optional `expected`, `tokenSchemes`, the form
  fill, the run tag, the `setup-failed` outcome) and the `Array.isArray` fix. Each diff was
  reviewed to hold only those changes.
- `golden/collection-script.js` (User Story 1) and `golden/collection-dynamic-script.js` (User
  Story 2): new, reviewed by hand. They differ only in the `DYNAMIC` table and the customer body.

## Manual walkthrough (T075)

Not performed. The quickstart's browser walkthrough (scenarios 1 to 8) still has to be done with
k6 installed; T075 is left unchecked (constitution XXXI).
