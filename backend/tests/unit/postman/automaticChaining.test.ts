import { describe, expect, it } from "vitest";
import { groupAndName } from "../../../src/postman/folders";
import { planAutomaticChains, type AutomaticChainingInput } from "../../../src/postman/automaticChaining";
import {
  chainingApiModel,
  cycleFinding,
  earlyConsumerScenario,
  graphOf,
  lateProducerScenario,
  legacyOrdersDeleteRelationship,
  legacyOrdersListScenario,
  orderGroupChildRelationship,
  orderGroupChildScenario,
  orderingViolationRelationship,
  ordersDeleteInvalidScenario,
  ordersDeleteRelationship,
  ordersDeleteScenario,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
  ordersPatchRelationship,
  ordersPatchScenario,
} from "../../fixtures/postman/dependencyFixtures";
import type { ApiOperation } from "@apipilot/shared-domain";
import {
  issueTokenScenario,
  mixedProducerGroupApiModel,
  tokenAuthRelationship,
  tokenInfoScenario,
  tokenPathConsumerScenario,
  tokenPathRelationship,
} from "../../fixtures/postman/credentialFixtures";

/** Every fixture operation this test file draws scenarios from, across both fixture models. */
const ALL_OPERATIONS: ApiOperation[] = [...chainingApiModel.operations, ...mixedProducerGroupApiModel.operations];

function operationFor(path: string, method: string) {
  const operation = ALL_OPERATIONS.find((candidate) => candidate.path === path && candidate.method === method);
  if (!operation) throw new Error(`fixture operation not found: ${method} ${path}`);
  return operation;
}

/** Pairs each scenario with its fixture operation, in the order supplied. */
function scenarioOperationPairs(scenarios: { operationPath: string; operationMethod: string; id: string }[]) {
  return scenarios.map((scenario) => ({
    scenario,
    operation: operationFor(scenario.operationPath, scenario.operationMethod),
  })) as { scenario: (typeof scenarios)[number]; operation: ReturnType<typeof operationFor> }[];
}

/** The real, unmodified emission-order rank — mirrors what generateCollection.ts computes. */
function rankOf(standaloneResolved: ReturnType<typeof scenarioOperationPairs>) {
  const rank = new Map<string, number>();
  groupAndName(standaloneResolved).forEach((folder) =>
    folder.entries.forEach((entry) => rank.set(entry.scenario.id, rank.size)),
  );
  return rank;
}

function baseInput(overrides: Partial<AutomaticChainingInput> = {}): AutomaticChainingInput {
  return {
    graph: graphOf(),
    cycles: [],
    rejectedRelationshipIds: new Set(),
    disabled: false,
    standaloneOrderRank: new Map(),
    credentialVariableNames: new Map(),
    ...overrides,
  };
}

describe("planAutomaticChains", () => {
  it("chains a single CONFIRMED producer/consumer pair (US1)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersGetRelationship()), standaloneOrderRank: rankOf(standalone) }),
    );

    expect(result.chains).toHaveLength(1);
    const chain = result.chains[0];
    expect(chain.producer.scenarioId).toBe(ordersListScenario.id);
    expect(chain.consumers).toEqual([
      expect.objectContaining({ scenarioId: ordersGetScenario.id, relationshipId: "rel-orders-get" }),
    ]);

    const consumerScenario = result.scenarios.find((pair) => pair.scenario.id === ordersGetScenario.id)!.scenario;
    expect(consumerScenario.request.pathParameters.id).toBe(`{{${chain.variableName}}}`);

    const extractions = result.extractionsByProducerScenarioId.get(ordersListScenario.id);
    expect(extractions).toEqual([
      { workflowId: chain.chainId, variableName: "id", responseField: "id" },
    ]);
  });

  it("reuses one variable/extraction for a producer feeding several consumers (US1, FR-009)", () => {
    const standalone = scenarioOperationPairs([
      ordersListScenario,
      ordersGetScenario,
      ordersPatchScenario,
      ordersDeleteScenario,
    ]);
    const result = planAutomaticChains(
      standalone,
      baseInput({
        graph: graphOf(ordersGetRelationship(), ordersPatchRelationship(), ordersDeleteRelationship()),
        standaloneOrderRank: rankOf(standalone),
      }),
    );

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].consumers).toHaveLength(3);
    expect(result.extractionsByProducerScenarioId.get(ordersListScenario.id)).toHaveLength(1);
  });

  it("passes scenarios through unchanged when disabled (FR-011)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersGetRelationship()), disabled: true, standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(0);
    expect(result.scenarios).toBe(standalone);
  });

  it("never chains a POSSIBLE-confidence-only relationship (US3, FR-004)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersGetRelationship("POSSIBLE")), standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(0);
    expect(result.scenarios.find((pair) => pair.scenario.id === ordersGetScenario.id)!.scenario.request.pathParameters.id).toBeUndefined();
  });

  it("deterministically resolves competing CONFIRMED/LIKELY producers to exactly one (US3, FR-006)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, legacyOrdersListScenario, ordersDeleteScenario]);
    const graph = graphOf(ordersDeleteRelationship(), legacyOrdersDeleteRelationship());
    const rank = rankOf(standalone);

    const first = planAutomaticChains(standalone, baseInput({ graph, standaloneOrderRank: rank }));
    const second = planAutomaticChains(standalone, baseInput({ graph, standaloneOrderRank: rank }));

    expect(first.chains).toHaveLength(1);
    expect(first.chains).toEqual(second.chains);
  });

  it("excludes a relationship that appears in a reported cycle (US3, FR-007)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({
        graph: graphOf(ordersGetRelationship()),
        cycles: [cycleFinding(["rel-orders-get"])],
        standaloneOrderRank: rankOf(standalone),
      }),
    );
    expect(result.chains).toHaveLength(0);
  });

  it("falls back when the producer operation has no approved scenario in the export (US3, FR-005)", () => {
    const standalone = scenarioOperationPairs([ordersGetScenario]); // no ordersListScenario present
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersGetRelationship()), standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(0);
  });

  it("falls back when the only approved producer scenario is not positive-outcome (FR-017)", () => {
    const negativeProducer = { ...ordersListScenario, category: "invalid-format" as const };
    const standalone = scenarioOperationPairs([negativeProducer, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersGetRelationship()), standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(0);
  });

  it("excludes a relationship belonging to an explicitly rejected workflow (US3, FR-016)", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersGetScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({
        graph: graphOf(ordersGetRelationship()),
        rejectedRelationshipIds: new Set(["rel-orders-get"]),
        standaloneOrderRank: rankOf(standalone),
      }),
    );
    expect(result.chains).toHaveLength(0);
  });

  it("declines a chain that would place the consumer before the producer in emission order (US3, FR-015)", () => {
    const standalone = scenarioOperationPairs([lateProducerScenario, earlyConsumerScenario]);
    const rank = rankOf(standalone);
    // Confirms the fixture actually exercises the guard: the "aaa" folder sorts before "zzz".
    expect(rank.get(earlyConsumerScenario.id)).toBeLessThan(rank.get(lateProducerScenario.id)!);

    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(orderingViolationRelationship()), standaloneOrderRank: rank }),
    );
    expect(result.chains).toHaveLength(0);
    expect(
      result.scenarios.find((pair) => pair.scenario.id === earlyConsumerScenario.id)!.scenario.request.pathParameters
        .token,
    ).toBeUndefined();
  });

  it("never assembles a multi-hop chain across an unavailable intermediate operation (US3, FR-018)", () => {
    // `/order-groups/{id}` is never approved, so it cannot serve as the producer for the second
    // hop — and there is no direct relationship from any approved producer to this consumer.
    const standalone = scenarioOperationPairs([orderGroupChildScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(orderGroupChildRelationship()), standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(0);
    expect(
      result.scenarios.find((pair) => pair.scenario.id === orderGroupChildScenario.id)!.scenario.request
        .pathParameters.childId,
    ).toBeUndefined();
  });

  it("chains multiple negative consumer scenarios for the same operation and parameter", () => {
    const standalone = scenarioOperationPairs([ordersListScenario, ordersDeleteScenario, ordersDeleteInvalidScenario]);
    const result = planAutomaticChains(
      standalone,
      baseInput({ graph: graphOf(ordersDeleteRelationship()), standaloneOrderRank: rankOf(standalone) }),
    );
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].consumers.map((consumer) => consumer.scenarioId).sort()).toEqual(
      [ordersDeleteScenario.id, ordersDeleteInvalidScenario.id].sort(),
    );
  });

  // specs/023-auto-auth-credential-chaining: "auth"-location consumers.
  describe("auth-credential consumers", () => {
    it("applies an auth chain, resolving to the credential variable name and never mutating the consumer request (research.md D5/D6)", () => {
      const standalone = scenarioOperationPairs([issueTokenScenario, tokenInfoScenario]);
      const result = planAutomaticChains(
        standalone,
        baseInput({
          graph: graphOf(tokenAuthRelationship()),
          standaloneOrderRank: rankOf(standalone),
          credentialVariableNames: new Map([["tokenAuth", "token"]]),
        }),
      );

      expect(result.chains).toHaveLength(1);
      const chain = result.chains[0];
      expect(chain.variableName).toBe("token"); // never a workflowVariableName-derived name
      expect(chain.consumers).toEqual([
        expect.objectContaining({ scenarioId: tokenInfoScenario.id, field: "tokenAuth", confidence: "CONFIRMED" }),
      ]);

      const consumerPair = result.scenarios.find((pair) => pair.scenario.id === tokenInfoScenario.id)!;
      expect(consumerPair.scenario.request).toEqual(tokenInfoScenario.request); // no substitution applied

      const extractions = result.extractionsByProducerScenarioId.get(issueTokenScenario.id);
      expect(extractions).toEqual([
        { workflowId: chain.chainId, variableName: "token", responseField: "token", finalVariableName: "token" },
      ]);
    });

    it("declines an auth chain that would place the consumer before the producer in emission order (FR-015)", () => {
      const standalone = scenarioOperationPairs([issueTokenScenario, tokenInfoScenario]);
      // Deliberately places the consumer's rank before the producer's, bypassing folder-grouping
      // uncertainty (mirrors dependencyFixtures.ts's own ordering-violation fixture in spirit).
      const rank = new Map([
        [tokenInfoScenario.id, 0],
        [issueTokenScenario.id, 1],
      ]);
      const result = planAutomaticChains(
        standalone,
        baseInput({
          graph: graphOf(tokenAuthRelationship()),
          standaloneOrderRank: rank,
          credentialVariableNames: new Map([["tokenAuth", "token"]]),
        }),
      );
      expect(result.chains).toHaveLength(0);
    });

    it("disables auth chaining exactly like path-parameter chaining, via the same flag (FR-008)", () => {
      const standalone = scenarioOperationPairs([issueTokenScenario, tokenInfoScenario]);
      const result = planAutomaticChains(
        standalone,
        baseInput({
          graph: graphOf(tokenAuthRelationship()),
          standaloneOrderRank: rankOf(standalone),
          credentialVariableNames: new Map([["tokenAuth", "token"]]),
          disabled: true,
        }),
      );
      expect(result.chains).toHaveLength(0);
      expect(result.scenarios).toBe(standalone);
    });

    it("splits a producer field shared by an auth consumer and a path consumer into two independent chains (research.md D7)", () => {
      const standalone = scenarioOperationPairs([issueTokenScenario, tokenInfoScenario, tokenPathConsumerScenario]);
      const rank = new Map([
        [issueTokenScenario.id, 0],
        [tokenInfoScenario.id, 1],
        [tokenPathConsumerScenario.id, 2],
      ]);
      const result = planAutomaticChains(
        standalone,
        baseInput({
          graph: graphOf(tokenAuthRelationship(), tokenPathRelationship()),
          standaloneOrderRank: rank,
          credentialVariableNames: new Map([["tokenAuth", "token"]]),
        }),
      );

      expect(result.chains).toHaveLength(2);
      const authChain = result.chains.find((chain) => chain.consumers[0]?.field === "tokenAuth")!;
      const pathChain = result.chains.find((chain) => chain.consumers[0]?.field === "token")!;
      expect(authChain.variableName).toBe("token");
      expect(pathChain.variableName).not.toBe("token"); // its own workflowVariableName-derived name
      expect(authChain.variableName).not.toBe(pathChain.variableName);

      const pathConsumerPair = result.scenarios.find((pair) => pair.scenario.id === tokenPathConsumerScenario.id)!;
      expect(pathConsumerPair.scenario.request.pathParameters.token).toBe(`{{${pathChain.variableName}}}`);
      const authConsumerPair = result.scenarios.find((pair) => pair.scenario.id === tokenInfoScenario.id)!;
      expect(authConsumerPair.scenario.request).toEqual(tokenInfoScenario.request);

      // Two independent extraction captures on the same producer scenario, not one merged entry.
      expect(result.extractionsByProducerScenarioId.get(issueTokenScenario.id)).toHaveLength(2);
    });
  });
});
