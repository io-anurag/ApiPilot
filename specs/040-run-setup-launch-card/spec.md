# AP-040: Run setup launch card and load profile chart

**Version**: 19.24.0 | **Date**: 2026-10-04 | **Scope**: frontend only (no contract, route or dependency change)

## Problem

On **Run setup** the run trigger sat at the bottom, below every setup item, and the load profile was
numbers only. An engineer had to scroll past all setup to learn whether a run could start, and could not
see the shape of the load they had entered.

## Requirements

- **FR-001** The Run card leads the Run setup tab, in the same card that already holds the target summary,
  write list, Load run and Debug run. Its content and wording are unchanged (AP-037 FR-031, AP-039 FR-017).
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
