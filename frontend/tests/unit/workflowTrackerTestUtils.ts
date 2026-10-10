import { fireEvent, screen, within } from "@testing-library/react";

/**
 * The stage tracker lists only one phase's stages at a time (the phase on screen, or the tile the
 * user opened). Tests that inspect or click a stage in another phase open that phase first, as a
 * user would. A no-op when the phase is already open.
 */
export function openPhase(phaseId: "prepare" | "design" | "organize" | "execute") {
  const toggle = within(screen.getByTestId(`phase-tile-${phaseId}`)).getByRole("button");
  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }
}
