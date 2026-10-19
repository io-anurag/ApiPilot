# Feature Specification: Home, decluttered

**Feature Branch**: `058-home-declutter`
**Created**: 2026-10-19
**Status**: Implemented
**Amends**: `specs/054-sidebar-shell-redesign` FR-018, FR-019, FR-020 and FR-021 (the contents of Home). Every other requirement of that
specification, and the data Home reads, are unchanged.

## Why

Home showed everything at once: the same four workflows twice (as three artifact boxes and again as four large cards), six figure
widgets that all read "Needs a specification" until one was loaded, a tall card for "Nothing is waiting on you", a recent-runs list that
ran to eight identical rows, and a full-width card for two words of AI status. A new person saw a screen of empty boxes with no clear
first action, and Security Lab, a results destination, was not reachable from it. The engineer's report: "looks ugly and super non user
friendly".

## Clarification (2026-10-19)

- Q: Which layout? → A: **Two-state Home.** With no specification, a short launcher and recent runs. With one, a compact status card, the
  next steps and recent runs. The by-area and by-method charts leave Home. (Chosen from three previewed options: two-state, launcher only,
  keep widgets and tidy.)
- Deviation, stated plainly: the mock-up put the AI status in the page header. Home shows it as one line instead, because a header
  placement would make every screen read the provider's status on every visit, which is a behaviour change outside this feature.

## Requirements

- **FR-001** Home MUST have two states chosen by whether a specification is loaded. Until the session's workflow has been read once, the
  top section MUST be a loading state, so the layout never flips after first paint and a control is never replaced under the pointer.
- **FR-002** With no specification, Home MUST ask what the person is starting from and show the three artifacts (OpenAPI specification,
  Postman collection, k6 script), each listing the workflows that accept it with their one-sentence descriptions. Each workflow MUST
  appear once on the screen, named by its title, with Guided Workflow alone marked Recommended and an unfinished Performance test marked
  Draft in progress in words. Coverage and Security Lab MUST be reachable from it.
- **FR-003** With no specification and something pending (for example an unfinished Performance draft), Home MUST say so above the
  launcher with a link to it. With nothing pending it MUST show no such box.
- **FR-004** With a specification, Home MUST lead with a single status card: the specification's name, file, operation and scenario
  counts, the four figures of FR-019 (each a text reason, never a number, when it has no data), a link to Coverage, and the first
  pending step as the one button, with further steps as links and "Nothing is waiting on you." in words when none. While coverage loads
  or fails, the card MUST say so in place of the figures.
- **FR-005** With a specification, Home MUST list the four workflows, Coverage and Security Lab as a compact "Start something else" row.
- **FR-006** In both states Home MUST show recent runs (FR-020 unchanged in content), the newest three first and the rest on request,
  and the AI provider's readiness on one line in words (state, provider, reason when unavailable).
- **FR-007** Home MUST NOT show an empty figure, chart or card for a datum it does not hold. A coverage failure with no specification MUST
  be named, not hidden.
- **FR-008** Home MUST fit a 375 px wide window without horizontal page scroll, in both themes, and every control MUST keep its
  accessible name, keyboard path and visible focus.
- **FR-009** Home MUST read only while visible, once per visit, and never poll, as before. No endpoint, payload, stored datum or
  shared-domain type changes.

## Success criteria

- **SC-001** On a session with no specification, the first screenful shows one question and three cards, and no figure.
- **SC-002** On a session with a specification, the specification's name and the one next action are visible without scrolling at
  1440 by 900.
- **SC-003** No Home state shows the same workflow twice as a choice.
- **SC-004** Home has no horizontal overflow at 375 px in light and dark.

## Out of scope

Home's coverage-over-runs chart and pass-rate trend (deferred by AP-054), moving the AI status into the header, and any change to the
Coverage screen.
