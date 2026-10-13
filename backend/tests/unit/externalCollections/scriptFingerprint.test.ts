import { describe, expect, it } from "vitest";
import { computeScriptsSha256 } from "../../../src/externalCollections/scriptFingerprint";

function collection(exec: string[], url = "http://x/a") {
  return JSON.stringify({
    info: { name: "c" },
    item: [
      {
        id: "i1",
        name: "one",
        event: [{ listen: "test", script: { exec } }],
        request: { method: "GET", url },
      },
    ],
  });
}

describe("computeScriptsSha256", () => {
  it("is stable for identical scripts", () => {
    expect(computeScriptsSha256(collection(["pm.test('a', () => {});"]))).toBe(
      computeScriptsSha256(collection(["pm.test('a', () => {});"])),
    );
  });

  it("changes when a script changes", () => {
    expect(computeScriptsSha256(collection(["a();"]))).not.toBe(computeScriptsSha256(collection(["b();"])));
  });

  it("does not change for edits that cannot change which code runs", () => {
    expect(computeScriptsSha256(collection(["a();"], "http://x/a"))).toBe(
      computeScriptsSha256(collection(["a();"], "http://other/b")),
    );
  });

  it("covers collection-level and folder-level scripts, and where a script sits", () => {
    const withCollectionScript = JSON.stringify({ info: { name: "c" }, event: [{ listen: "prerequest", script: { exec: ["x();"] } }], item: [] });
    const withFolderScript = JSON.stringify({
      info: { name: "c" },
      item: [{ id: "f", name: "f", event: [{ listen: "prerequest", script: { exec: ["x();"] } }], item: [] }],
    });
    const none = JSON.stringify({ info: { name: "c" }, item: [] });
    const hashes = [withCollectionScript, withFolderScript, none].map(computeScriptsSha256);
    expect(new Set(hashes).size).toBe(3);
  });

  it("does not throw on malformed JSON", () => {
    expect(computeScriptsSha256("{nope")).toMatch(/^[0-9a-f]{64}$/);
  });
});
