import { Banner } from "../patterns/Banner";

/**
 * Shown when no specification is loaded in the guided workflow (specs/057 FR-004). Analysis, generation, approval
 * and running need one; retained work (scenarios, findings, run summaries, reports) stays readable without it,
 * and the notice says so, so the engineer does not read a blank list as lost data.
 */
export function SpecNotLoadedNotice({ retainedAvailable = true }: Readonly<{ retainedAvailable?: boolean }>) {
  return (
    <Banner tone="neutral" title="No specification is loaded" role="status" testId="security-spec-not-loaded">
      Security analysis, scenario generation, approval and runs need a specification. Upload one in the Guided Workflow to continue.
      {retainedAvailable
        ? " Scenarios, findings, run summaries and reports you kept earlier are still shown and are marked “specification not loaded”."
        : ""}
    </Banner>
  );
}
