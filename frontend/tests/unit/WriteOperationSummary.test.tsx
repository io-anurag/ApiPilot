import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { summarizeWriteOperations, type PerformanceJourney } from "@apipilot/shared-domain";
import { WRITE_REPETITION_SENTENCE, WriteOperationSummary } from "../../src/components/performance/WriteOperationSummary";
import { quickStep } from "./performanceFixtures";

/** AP-032 FR-009 to FR-012, SC-002 (specs/032-quick-performance-test tasks T041). */

function journeysOf(count: number): PerformanceJourney[] {
  const methods = ["POST", "PUT", "PATCH", "DELETE"];
  const writes = Array.from({ length: count }, (_, index) => quickStep(methods[index % 4], `/r${index}`));
  return [...writes, quickStep("GET", "/read")].map((step) => ({ id: `j-${step.id}`, source: { kind: "operation" as const }, steps: [step] }));
}

describe("WriteOperationSummary", () => {
  it("states the count, the count per method, every operation and the repetition sentence above the journeys", () => {
    render(<WriteOperationSummary summary={summarizeWriteOperations(journeysOf(15))} variant="plan" listId="writes" />);
    const summary = screen.getByTestId("write-summary-plan");
    expect(summary).toHaveTextContent("15 write operations will be sent");
    expect(within(screen.getByRole("list", { name: "Write operations per method" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "POST× 4",
      "PUT× 4",
      "PATCH× 4",
      "DELETE× 3",
    ]);
    expect(summary).toHaveTextContent(WRITE_REPETITION_SENTENCE);
    // SC-002: all 15 readable without expanding anything.
    const list = screen.getByTestId("write-summary-plan-list");
    expect(list.tagName).not.toBe("DETAILS");
    for (let index = 0; index < 15; index += 1) expect(list).toHaveTextContent(`/r${index}`);
    expect(list).not.toHaveTextContent("/read");
  });

  it("lists every write operation beside the run trigger too, with no collapsed section (FR-011)", () => {
    render(<WriteOperationSummary summary={summarizeWriteOperations(journeysOf(12))} variant="trigger" listId="writes" />);
    const trigger = screen.getByTestId("write-summary-trigger");
    expect(trigger).toHaveTextContent("12 write operations will be sent");
    expect(trigger.querySelector("details")).toBeNull();
    for (let index = 0; index < 12; index += 1) expect(trigger).toHaveTextContent(`/r${index}`);
    expect(within(trigger).getByRole("link", { name: "See the plan's list" })).toHaveAttribute("href", "#writes");
  });

  it("names each write's effect in text, not colour alone (FR-010)", () => {
    render(<WriteOperationSummary summary={summarizeWriteOperations(journeysOf(4))} variant="plan" />);
    const list = screen.getByTestId("write-summary-plan-list");
    for (const label of ["Creates", "Replaces", "Updates", "Deletes"]) expect(list).toHaveTextContent(label);
  });

  it("says a read-only plan sends only read requests (FR-012)", () => {
    render(<WriteOperationSummary summary={summarizeWriteOperations(journeysOf(0))} variant="trigger" />);
    expect(screen.getByTestId("write-summary-trigger")).toHaveTextContent("This plan sends only read requests.");
  });
});

/** AP-035 FR-023 (specs/035-user-defined-journeys research R15). */
describe("WriteOperationSummary with an operation in several steps", () => {
  it("counts each step and names the journeys of an operation sent more than once", () => {
    const post = quickStep("POST", "/orders");
    const journeys: PerformanceJourney[] = [
      { id: "j-user", source: { kind: "user", userJourneyId: "j-user", name: "Lifecycle" }, steps: [post, { ...post, id: "s-again" }] },
      { id: "j-single", source: { kind: "operation" }, steps: [{ ...post, id: "s-single" }] },
    ];
    render(<WriteOperationSummary summary={summarizeWriteOperations(journeys)} variant="plan" listId="writes" />);
    const summary = screen.getByTestId("write-summary-plan");
    expect(summary).toHaveTextContent("3 write operations will be sent");
    expect(summary).toHaveTextContent("× 3 steps: J1 Lifecycle, J1 Lifecycle, J2");
  });
});
