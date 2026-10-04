# AP-040: Run setup launch card and load profile chart

**Version**: 19.25.0 | **Date**: 2026-10-04 | **Scope**: frontend only (no contract, route or dependency change)

## Problem

On **Run setup** the run trigger sat at the bottom, below every setup item, and the load profile was
numbers only. An engineer had to scroll past all setup to learn whether a run could start, and could not
see the shape of the load they had entered.

## Requirements

- **FR-001** A launch card leads the Run setup tab with the load run and Debug run triggers. Its wording is
  unchanged (AP-037 FR-031, AP-039 FR-017); the chains, hosts, data sets and every write
  operation are listed in the card itself (one banner for the writes), so nothing a run sends is read elsewhere.
- **FR-011** "Script generated." is announced to screen readers only; the script row already shows the state.
- **FR-009** Run setup does not repeat the Last run and Runs of this plan cards. The launch card shows the last run's
  time and status in one line with a link to Runs & reports, which holds Run again, restore and the runs table.
- **FR-010** On the Chains tab the Seeding report panel appears only when seeding left something out; with nothing to
  list, one line says everything was carried over. Seeding still always produces the report (AP-037 FR-025).
- **FR-012** Runs & reports has no run triggers. It shows the runs table, the open report, and on the right the run in
  progress with Cancel, the last run with Run again and Go to Run setup, and Restore. The Debug run, formerly also
  offered there (AP-039), is on Run setup only, in the launch card.
- **FR-008** The setup items are rows of one Configuration card; Thresholds and Data sets show a summary
  until the engineer chooses Edit, and keep what was typed while hidden.
- **FR-002** It states in one line whether a run can start ("Ready to run on NAME (TIER).", "Run in progress."
  or "Not ready to run yet."); the specific reason stays beside the button that is blocked.
- **FR-003** It shows the profile, planned duration, peak virtual users, default think time and script
  (short SHA-256, or "Not generated") from the plan.
- **FR-004** The pending bar does not repeat the ready line on the Run setup tab, and renders nothing when
  it has nothing to say. It still appears on the other tabs.
- **FR-005** The load profile editor shows a chart of the planned virtual users over time, from the stages
  as entered, starting at the one virtual user k6 starts with. It recommends no target and applies no limit.
- **FR-006** The chart is described in words (stage count, duration, peak) for assistive technology.
- **FR-007** Light and dark mode use the existing design tokens; no new dependency, no inline style.

## Out of scope

Nothing is started automatically; no Debug run or load run behavior changed.

## Validation

Unit tests: `loadProfilePoints`, `LoadProfileChart`, the launch card on the Run setup tab. Manual browser
walkthrough of light and dark mode: outstanding.
