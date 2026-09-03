import http from "node:http";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

/**
 * SC-012 and FR-023: generating an artifact issues no request to any API described by the
 * specification, and producing the artifact is not authorization to run it.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("export network isolation", () => {
  it("issues no fetch, http, or https request while generating", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("the export must not issue a network request");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const httpRequest = vi.spyOn(http, "request").mockImplementation(() => {
      throw new Error("the export must not issue a network request");
    });
    const httpGet = vi.spyOn(http, "get").mockImplementation(() => {
      throw new Error("the export must not issue a network request");
    });
    const httpsRequest = vi.spyOn(https, "request").mockImplementation(() => {
      throw new Error("the export must not issue a network request");
    });
    const httpsGet = vi.spyOn(https, "get").mockImplementation(() => {
      throw new Error("the export must not issue a network request");
    });

    const outcome = generateCollection(exportApiModel, approvedTestModel, {
      baseUrl: "https://qa.internal.example",
    });

    expect(outcome.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpsGet).not.toHaveBeenCalled();
  });

  it("does not resolve or fetch anything for a specification carrying analysis issues", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    generateCollection(exportApiModel, approvedTestModel);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
