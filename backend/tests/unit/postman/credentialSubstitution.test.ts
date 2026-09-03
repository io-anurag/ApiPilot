import { describe, expect, it } from "vitest";
import { buildRequestItem } from "../../../src/postman/requestItem";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

const createSession = exportApiModel.operations[4];
const sessionScenario = approvedTestModel.scenarios.find(
  (scenario) => scenario.id === "scenario-session-credentials",
);

if (!sessionScenario) throw new Error("fixture scenario-session-credentials is missing");

describe("credential substitution", () => {
  it("replaces a credential-carrying header with a variable reference", () => {
    const { item } = buildRequestItem({
      scenario: sessionScenario,
      operation: createSession,
      requestName: "POST /sessions — positive",
    });
    const authorization = item.request.header.find((header) => header.key === "Authorization");
    expect(authorization?.value).toBe("{{token}}");
    expect(JSON.stringify(item)).not.toContain("sk-live-supersecret");
  });

  it("replaces a credential-named body field with a variable reference", () => {
    const { item } = buildRequestItem({
      scenario: sessionScenario,
      operation: createSession,
      requestName: "POST /sessions — positive",
    });
    const body = JSON.parse(item.request.body?.raw ?? "null");
    expect(body.password).toBe("{{password}}");
    expect(JSON.stringify(item)).not.toContain("hunter2");
  });

  it("leaves non-credential values exactly as approved", () => {
    const { item } = buildRequestItem({
      scenario: sessionScenario,
      operation: createSession,
      requestName: "POST /sessions — positive",
    });
    const body = JSON.parse(item.request.body?.raw ?? "null");
    expect(body.username).toBe("qa");
  });

  it("emits a runnable variable reference rather than the review redaction marker", () => {
    const { item } = buildRequestItem({
      scenario: sessionScenario,
      operation: createSession,
      requestName: "POST /sessions — positive",
    });
    expect(JSON.stringify(item)).not.toContain("[redacted]");
  });

  it("declares every credential variable it substituted", () => {
    const { variables } = buildRequestItem({
      scenario: sessionScenario,
      operation: createSession,
      requestName: "POST /sessions — positive",
    });
    const names = variables.map((variable) => variable.name);
    expect(names).toContain("token");
    expect(names).toContain("password");
    expect(variables.filter((variable) => variable.name === "token")[0].secret).toBe(true);
  });
});
