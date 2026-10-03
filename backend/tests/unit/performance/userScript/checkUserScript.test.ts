import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScriptCheckAccepted } from "@apipilot/shared-domain";
import { USER_SCRIPT_MAX_BYTES } from "@apipilot/shared-domain";
import { checkUserScript, hostsInText } from "../../../../src/performance/userScript/checkUserScript";

/** AP-034 FR-004 to FR-009, SC-001, SC-005, SC-010 (research R1 to R5, R23; tasks T019). */

const FIXTURES = path.join(__dirname, "..", "..", "..", "fixtures", "userScripts");

function fixture(kind: "accepted" | "refused", name: string): Buffer {
  return readFileSync(path.join(FIXTURES, kind, name));
}

function accepted(bytes: Uint8Array): ScriptCheckAccepted {
  const result = checkUserScript(bytes);
  if (!result.accepted) throw new Error(`Expected acceptance, got ${JSON.stringify(result.problems)}`);
  return result;
}

const expected = JSON.parse(readFileSync(path.join(FIXTURES, "refused", "expected.json"), "utf-8")) as Record<string, { rule: string; line: number }>;

describe("checkUserScript: the refused corpus (SC-001)", () => {
  it("has at least 25 scripts, each with an expected rule and line", () => {
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(25);
    const files = readdirSync(path.join(FIXTURES, "refused")).filter((file) => file.endsWith(".js"));
    expect(files.sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))("refuses %s with its rule at its line, and only that", (file, { rule, line }) => {
    const result = checkUserScript(fixture("refused", file));
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.problems.map((problem) => ({ rule: problem.rule, line: problem.line }))).toEqual([{ rule, line }]);
  });

  it("never quotes a string literal from the script in a message", () => {
    for (const file of Object.keys(expected)) {
      const result = checkUserScript(fixture("refused", file));
      if (result.accepted) continue;
      for (const problem of result.problems) {
        for (const literal of ["/etc/passwd", "https://jslib.k6.io", "doSomething()", "./lib.js", "lodash", "return 1"]) expect(problem.message).not.toContain(literal);
      }
    }
  });
});

describe("checkUserScript: the accepted corpus", () => {
  it.each(readdirSync(path.join(FIXTURES, "accepted")))("accepts %s", (file) => {
    expect(checkUserScript(fixture("accepted", file)).accepted).toBe(true);
  });

  it("lists the names a script reads and whether it has a default function (FR-009, FR-027)", () => {
    expect(accepted(fixture("accepted", "basic.js"))).toMatchObject({
      envNames: [
        { name: "API_KEY", mappable: true },
        { name: "BASE_URL", mappable: true },
      ],
      hasDefaultFunction: true,
    });
    expect(accepted(fixture("accepted", "scenarios-only.js")).hasDefaultFunction).toBe(false);
  });

  it("lists every host written as an absolute URL, and none built from a template (SC-005)", () => {
    expect(accepted(fixture("accepted", "unnamed-urls.js")).hosts).toEqual(["https://api.example.test:8443"]);
    expect(accepted(fixture("accepted", "basic.js")).hosts).toEqual([]);
    expect(hostsInText("// see http://Docs.Example.test/a\nconst a = 'wss://x.test:9000/s'; const b = `https://${host}/x`; const c = 'https://user:pw@y.test/q?x=1';")).toEqual([
      "http://docs.example.test:80",
      "https://y.test:443",
      "wss://x.test:9000",
    ]);
  });

  it("lists names read by destructuring, and marks a name that cannot be mapped", () => {
    const result = accepted(Buffer.from('const { BASE_URL, "K6_OUT": out, PATH } = __ENV;\nexport default function () {}\n'));
    expect(result.envNames).toEqual([
      { name: "BASE_URL", mappable: true },
      { name: "K6_OUT", mappable: false, reason: "k6-prefix" },
      { name: "PATH", mappable: false, reason: "reserved-startup-name" },
    ]);
  });

  it("gives the same result, problems and lists for the same bytes, 10 times (FR-008, SC-010)", () => {
    for (const bytes of [fixture("accepted", "basic.js"), fixture("refused", "computed-key.js"), fixture("accepted", "unnamed-urls.js")]) {
      const results = new Set(Array.from({ length: 10 }, () => JSON.stringify(checkUserScript(bytes))));
      expect(results.size).toBe(1);
    }
  });

  it("sorts several problems by line, column and rule", () => {
    const result = checkUserScript(Buffer.from('const a = open("x"); const b = eval("y");\nimport z from "./z.js";\nexport default function () {}\n'));
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.problems.map((problem) => `${problem.line}:${problem.column}:${problem.rule}`)).toEqual([
      "1:11:forbidden-identifier",
      "1:32:forbidden-identifier",
      "2:15:import-file",
    ]);
  });
});

describe("checkUserScript: limits", () => {
  it("refuses a script over 1 MiB, invalid UTF-8 and a NUL character", () => {
    const tooLarge = checkUserScript(Buffer.alloc(USER_SCRIPT_MAX_BYTES + 1, 0x20));
    expect(tooLarge.accepted ? null : tooLarge.problems[0].rule).toBe("too-large");
    const invalid = checkUserScript(Buffer.from([0x63, 0x6f, 0xc3, 0x28]));
    expect(invalid.accepted ? null : invalid.problems[0].rule).toBe("not-utf8-text");
    const nul = checkUserScript(Buffer.from("export default function () {}\u0000"));
    expect(nul.accepted ? null : nul.problems[0].rule).toBe("not-utf8-text");
  });

  it("accepts a byte order mark", () => {
    expect(checkUserScript(Buffer.from("﻿export default function () {}\n")).accepted).toBe(true);
  });
});
