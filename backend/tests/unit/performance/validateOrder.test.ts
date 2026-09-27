import { describe, expect, it } from "vitest";
import { DependencyOrderViolationError, InvalidOrderError } from "../../../src/performance/errors";
import { validateJourneyOrder, validateStepOrder } from "../../../src/performance/plan/validateOrder";
import { journeyFixture, planFixture, stepFixture } from "../../fixtures/performance/builders";

/** FR-007, SC-009 (research D5; tasks T082). */

// a produces x; b consumes x from a and produces y; c consumes y from b.
const a = stepFixture({ id: "a", variableBindings: [{ variable: "x", role: "produces", field: "x" }] });
const b = stepFixture({
  id: "b",
  variableBindings: [
    { variable: "x", role: "consumes", field: "x", location: "path", producerStepId: "a" },
    { variable: "y", role: "produces", field: "y" },
  ],
});
const c = stepFixture({ id: "c", variableBindings: [{ variable: "y", role: "consumes", field: "y", location: "auth", producerStepId: "b" }] });
const journey = journeyFixture({ id: "j", steps: [a, b, c] });

function permutations(ids: string[]): string[][] {
  if (ids.length <= 1) return [ids];
  return ids.flatMap((id, index) => permutations([...ids.slice(0, index), ...ids.slice(index + 1)]).map((rest) => [id, ...rest]));
}

describe("reorder validation", () => {
  it("accepts only orders that keep every producer before its consumers, and names the broken variable otherwise", () => {
    let rejected = 0;
    for (const order of permutations(["a", "b", "c"])) {
      const valid = order.indexOf("a") < order.indexOf("b") && order.indexOf("b") < order.indexOf("c");
      if (valid) {
        expect(validateStepOrder(journey, order)).toEqual(order);
        continue;
      }
      rejected += 1;
      try {
        validateStepOrder(journey, order);
        throw new Error("expected a rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyOrderViolationError);
        expect(["x", "y"]).toContain((error as DependencyOrderViolationError).variable);
      }
    }
    expect(rejected).toBe(5);
  });

  it("reports the first broken variable in the journey's own order", () => {
    expect(() => validateStepOrder(journey, ["c", "b", "a"])).toThrow(expect.objectContaining({ variable: "x", producerStepId: "a", consumerStepId: "b" }));
    expect(() => validateStepOrder(journey, ["a", "c", "b"])).toThrow(expect.objectContaining({ variable: "y" }));
  });

  it("counts a credential chain (consumer location auth) like any other variable", () => {
    expect(() => validateStepOrder(journey, ["c", "a", "b"])).toThrow(DependencyOrderViolationError);
  });

  it("rejects anything that is not a permutation of the same steps", () => {
    for (const bad of [["a", "b"], ["a", "b", "b"], ["a", "b", "d"], "abc", [1, 2, 3]]) {
      expect(() => validateStepOrder(journey, bad)).toThrow(InvalidOrderError);
    }
  });

  it("accepts any permutation of journeys, and nothing else", () => {
    const plan = planFixture({ journeys: [journeyFixture({ id: "j1" }), journeyFixture({ id: "j2", steps: [stepFixture({ id: "other" })] })] });
    expect(validateJourneyOrder(plan, ["j2", "j1"])).toEqual(["j2", "j1"]);
    expect(() => validateJourneyOrder(plan, ["j2"])).toThrow(InvalidOrderError);
  });
});
