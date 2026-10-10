# AP-044: Self-contained HTML report for a collection run

**Version**: 19.38.0 | **Date**: 2026-10-10 | **Scope**: backend (HTML renderer, report insights, one route) and a second
button on the Results step; no new dependency; no change to run, execution or storage behaviour.

## Inspiration and scope

The report is modelled on the structure of the open-source reportingLabs reporter (naveenautomationlabs/reporting-labs,
MIT): a single HTML file with no server, an overview, the failures that need attention, failures grouped by cause, the
slowest requests, a breakdown, per-test detail and a light/dark theme. Nothing was copied; the design is ApiPilot's own,
built on its run data. Chosen with the product owner: the HTML report first, applied to Import & Run Collection runs
(which includes runs of collections handed off from the guided workflow, since the guided workflow does not run
collections itself, specs/026 and manual 3.10), kept beside the AP-043 PDF, from one shared report model.

Not in this feature: run history and trends across runs, bug-report and Slack/Teams text, CSV/JSON export, a
`report.json`, merging reports, palette options. They need data ApiPilot does not keep yet (history across sessions) or
are a separate feature; the report model is the place they would build on.

## Requirements

- **FR-001** `GET /api/external-collections/:id/execution/runs/:runId/report.html` returns the run as one HTML file:
  `text/html; charset=utf-8`, `Content-Disposition: attachment` with an ASCII name (`apipilot-run-report-<collection>-<id>.html`),
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Errors and status codes are those of the PDF route:
  404 `run_not_found` for an unknown run or another collection's run, 409 `run_in_progress` while running.
- **FR-002** The report contains: a header (collection, tier, status, start time); tiles for pass rate, requests, passed,
  failed, not attempted and duration; a run strip with one cell per request in run order; **Needs attention** (each failed
  request with its reason, first failed-test message and HTTP status); **Failure clusters** (failures with the same reason
  and message, numbers and quoted values ignored, with a plain-language explanation of the reason); **Slowest requests**
  (the five slowest that were sent, with bars); **By method**; **Run details**; and **All requests**, each expandable to its
  reason, failed tests and passed-test count, with All / Failed / Passed / Not attempted filters.
- **FR-003** Outcome is always a word; colour only reinforces it. Method badges use the shared method colours (AP-042).
  Light and dark follow the operating system, with a button to switch; the file prints legibly (details expanded).
- **FR-004** Self-contained and safe: one file, inline styles and a few lines of script (theme switch and filter), no network
  request, font or image; a content security policy (`default-src 'none'`) blocks any network access. Every value from the run is
  HTML-escaped, because request and test names come from an uploaded file. The file never contains request or response headers
  or bodies, variables, or anything beyond what the PDF report holds.
- **FR-005** Deterministic: the same run renders to the same bytes; all times come from the run, in UTC.
- **FR-006** The Results step offers **Download HTML report** beside **Download PDF report** for a finished (or cancelled) run;
  failures show the server's message.
- **FR-007** Both reports are built from the same report model and the same derived insights (`runReport.ts`:
  `buildRunReportModel`, `buildRunInsights`, the reason explanations and the method colours), so they carry the same
  content and always agree. The PDF draws every section of the HTML (details, tiles including the pass rate, run strip,
  needs attention, failure clusters, slowest requests, by method, all requests with reason and passed-test count) and
  leaves out only what needs a web page: the filters, expandable rows and the theme switch.
- **FR-008** The PDF also follows the HTML's visual design, not only its content: the same header (eyebrow, name, tier and
  status chips, start time), six separate tiles, bordered cards in the same order, Failure clusters beside Slowest requests and
  By method beside Run details, the same run strip, tables, method labels, outcome colours and wording. A card that does not
  fit a page moves whole (or continues on the next page with its border closed and reopened and its table header repeated).
  Text uses the standard fonts' full WinAnsi range, so typographic dashes, quotes and bullets in request names are drawn, not
  replaced by `?`.

## Validation

Backend unit tests (insights: pass rate, clustering, slowest, method order; the page: sections, escaping of hostile names,
self-containment and no leakage of headers or bodies, determinism, empty run) and Supertest integration tests (headers, body,
404s); frontend tests (button, file name, the right URL). The page was rendered in headless Chrome in light and dark and
inspected. The interactive filter and theme button were not exercised in a browser; the PDF layout was not rendered.
