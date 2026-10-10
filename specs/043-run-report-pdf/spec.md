# AP-043: Downloadable PDF report for an Import & Run Collection run

**Version**: 19.37.0 | **Date**: 2026-10-10 | **Scope**: backend route and PDF renderer, one frontend button; one new
backend dependency (`pdfkit`, `@types/pdfkit` for development); no change to run, execution or storage behaviour.

## Problem

A finished run could only be read on screen. There was nothing to hand to a teammate, attach to a ticket or keep as a
record of what a run did.

## Requirements

- **FR-001** On the Results step, an open run that has finished (completed or cancelled) offers **Download PDF
  report**. A run still in progress does not. The button is also absent until a run is open.
- **FR-002** `GET /api/external-collections/:id/execution/runs/:runId/report.pdf` returns the report as
  `application/pdf` with `Content-Disposition: attachment` and an ASCII file name
  (`apipilot-run-report-<collection>-<run id prefix>.pdf`), `Cache-Control: no-store`. An unknown run, or one that
  belongs to another collection, is `404 run_not_found`; a run in progress is `409 run_in_progress`. Errors are the
  structured JSON the other routes use, never a broken file.
- **FR-003** The report states the collection name and tier, the run's status, start and completion time (UTC,
  fixed format), duration and id; a summary (requests, passed, failed, not attempted); a results table (position,
  method, request name, outcome, HTTP status, time) with each request's outcome written as a word (colour only
  reinforces it) and the reason for a failure or a skipped request; and a Failures section listing each failed
  request's failed tests with their first-line messages (already redacted, shortened to 240 characters).
- **FR-004** The report never contains request or response headers or bodies, the collection's variables, or anything
  from the uploaded files beyond the names the run recorded, and says so. A report can therefore be shared without
  leaking credentials.
- **FR-005** Deterministic: the same run renders to the same bytes (document dates come from the run, not the clock;
  nothing random). Long runs continue onto further pages without splitting a row; the table header repeats; every page
  has a footer with the run id and "Page n of m".
- **FR-006** Text the standard PDF font cannot draw (outside Latin-1) is shown as `?` rather than dropped, so a name in
  another script is approximate in the report.
- **FR-007** Generated locally by the backend from the stored run; nothing is sent to any external service.

## Dependency

`pdfkit` (MIT, pure JavaScript, no native code, works offline) draws the document on the backend. Checked against the
alternatives: a browser-side library would put a larger bundle in every page load and make output depend on the browser;
printing to PDF from the browser is not a download and cannot be tested. Its standard Helvetica fonts are bundled, so no
font files are fetched or committed.

## Out of scope

Reports for other screens (guided workflow execution, performance runs), charts, a report of several runs, branding or
themes, and non-Latin text rendering.

## Validation

Backend unit tests (report model, no leakage of headers or bodies, formatting, file name, determinism, multi-page,
empty and cancelled runs) and Supertest integration tests (headers, body is a PDF, 404s); frontend tests (button
visibility, download, error shown). The rendered layout was not looked at in a PDF viewer: none was available in the
build environment, so only the drawing instructions were inspected. Manual walkthrough: outstanding.
