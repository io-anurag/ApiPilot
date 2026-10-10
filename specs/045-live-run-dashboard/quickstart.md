# Quickstart: validating the live run dashboard (AP-045)

Prerequisites: `npm install`; a target API reachable locally (the mock target used by the existing performance tests); k6 installed
for scenarios 1 and 2 (the ordinary test suite does not need it).

## Automated

```bash
npm test -w backend      # live series, recent ring, route and totals tests
npm test -w frontend     # dashboard, chart, hook, state tests
npm run lint
npm run build
```

Expected: live series and ring tests are deterministic (fixed NDJSON fixtures, no clock); the totals-equal-report test passes for
all three kinds.

## Manual

1. **Performance plan run.** Start a run from Run setup. Expect to land on Runs & reports, see the counters rise at least once a
   second, a graph gaining points, chains filling, and the latest-requests table updating. Reload mid-run: the graph and counters
   return for the run so far. Let it finish: the badge becomes Completed and the totals match the report (SC-002).
2. **Run k6 Script.** Run a script; the same dashboard appears in the run activity area. Cancel mid-run: the badge shows Cancelled
   with the totals reached.
3. **Import & Run Collection.** Start a run; the Results step shows the same dashboard with "n of N", the request in flight, and a
   graph of requests and failures (no virtual users shown).
4. **Stale.** Stop the backend during a run: the dashboard says its figures are stale and since when, keeps the last values, and
   recovers when the backend returns.
5. **Privacy.** Run a plan whose requests carry an Authorization header and a query-string token: the dashboard shows no header,
   token, query string or body (SC-006).
6. **Reports.** Download the HTML and the PDF report of a finished collection run: both show the graph with the same figures, and the
   run report of a finished plan or script run shows it too. Open a collection run from before this feature: its reports show the graph.
7. **Consistency.** Check light and dark themes, keyboard navigation through the dashboard, the values table under the graph, and
   reduced motion. Compare tiles, badges, method badges and wording with the run report and run list (FR-016).

Contracts: `contracts/live-run-routes.md`. Types: `data-model.md`.
