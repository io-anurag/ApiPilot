import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { approvedTestModel, exportApiModel } from "../fixtures/postman/exportFixtures";

const ENDPOINT = "/api/test-models/postman-collection";
const REJECTED_SCENARIO = "scenario-list-no-assertions";

interface WireItem {
  id: string;
  name: string;
}

function exportRequest(scenarioIds?: string[]) {
  const scenarios = scenarioIds
    ? approvedTestModel.scenarios.filter((scenario) => scenarioIds.includes(scenario.id))
    : approvedTestModel.scenarios;
  return request(createApp())
    .post(ENDPOINT)
    .send({ apiModel: exportApiModel, testModel: { scenarios } });
}

function items(body: { collection: { item: { item: WireItem[] }[] } }): WireItem[] {
  return body.collection.item.flatMap((folder) => folder.item);
}

describe(`${ENDPOINT} re-export`, () => {
  it("returns identical artifacts when nothing changed between exports", async () => {
    const first = await exportRequest();
    const second = await exportRequest();
    expect(JSON.stringify(second.body.collection)).toBe(JSON.stringify(first.body.collection));
    expect(JSON.stringify(second.body.environment)).toBe(JSON.stringify(first.body.environment));
    expect(second.body.readme).toBe(first.body.readme);
  });

  it("confines the difference to the rejected scenario's request", async () => {
    const before = await exportRequest();
    const remainingIds = approvedTestModel.scenarios
      .map((scenario) => scenario.id)
      .filter((id) => id !== REJECTED_SCENARIO);
    const after = await exportRequest(remainingIds);

    const beforeItems = new Map(items(before.body).map((item) => [item.id, item]));
    const afterItems = new Map(items(after.body).map((item) => [item.id, item]));

    expect(afterItems.size).toBe(beforeItems.size - 1);
    for (const [id, item] of afterItems) {
      expect(JSON.stringify(item)).toBe(JSON.stringify(beforeItems.get(id)));
    }
  });

  it("keeps the variables an existing filled-in environment already carries", async () => {
    const before = await exportRequest();
    const remainingIds = approvedTestModel.scenarios
      .map((scenario) => scenario.id)
      .filter((id) => id !== REJECTED_SCENARIO);
    const after = await exportRequest(remainingIds);

    const beforeKeys = (before.body.environment.values as { key: string }[]).map(
      (value) => value.key,
    );
    const afterKeys = (after.body.environment.values as { key: string }[]).map(
      (value) => value.key,
    );
    expect(afterKeys).toEqual(beforeKeys);
  });
});
