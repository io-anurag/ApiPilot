import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DataSetInvalidError, parseCsv, type DataSetRefusal } from "../../../../src/performance/chain/csv";

/** AP-037 (specs/037-request-chain-performance tasks T076; FR-041, FR-042; research R14). */

const FIXTURES = path.join(__dirname, "..", "..", "..", "fixtures", "chain");

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, name));
}

function refusal(bytes: Buffer): DataSetRefusal {
  try {
    parseCsv(bytes);
  } catch (error) {
    if (error instanceof DataSetInvalidError) return error.refusal;
    throw error;
  }
  throw new Error("The file was accepted.");
}

describe("parseCsv", () => {
  it("reads the 50-row customers file with CRLF line ends", () => {
    const parsed = parseCsv(fixture("customers.csv"));
    expect(parsed.columns).toEqual(["tenant_id", "first_name", "last_name", "email", "username", "password"]);
    expect(parsed.rows).toHaveLength(50);
    expect(parsed.rows[0]).toEqual(["tenant-1", "Ada", "Lovelace", "ada.lovelace1@example.test", "user01", "fixture-secret-01"]);
  });

  it("reads RFC 4180 quoting, LF endings, a byte order mark and empty cells", () => {
    const parsed = parseCsv(Buffer.from('﻿name,note,empty\n"Lovelace, Ada","said ""hi""\nthen left",\nplain,x,\n', "utf-8"));
    expect(parsed).toEqual({
      columns: ["name", "note", "empty"],
      rows: [
        ["Lovelace, Ada", 'said "hi"\nthen left', ""],
        ["plain", "x", ""],
      ],
    });
  });

  it.each([
    ["bad-short-row.csv", { reason: "field-count", line: 7, expected: 6, found: 5 }],
    ["bad-no-header.csv", { reason: "no-header-row", line: 1 }],
    ["bad-empty.csv", { reason: "empty-file" }],
    ["bad-not-utf8.csv", { reason: "not-utf8", line: 2 }],
    ["bad-duplicate-column.csv", { reason: "duplicate-column", line: 1, column: "name" }],
    ["bad-column-name.csv", { reason: "invalid-column-name", line: 1, column: "first name" }],
    ["bad-unterminated-quote.csv", { reason: "unterminated-quote", line: 2 }],
    ["bad-too-many-columns.csv", { reason: "too-many-columns", line: 1 }],
  ])("refuses %s with its reason and line", (file, expected) => {
    expect(refusal(fixture(file))).toEqual(expected);
  });

  it("refuses more than 100,000 data rows", () => {
    const text = ["a", ...Array.from({ length: 100_001 }, (_unused, index) => String(index))].join("\n");
    expect(refusal(Buffer.from(text))).toEqual({ reason: "too-many-rows", line: 100_002 });
  });

  it("never puts a cell value in a refusal message", () => {
    try {
      parseCsv(Buffer.from("a,b\nSECRET-CELL\n"));
    } catch (error) {
      expect((error as Error).message).toBe("Line 2: expected 2 fields, found 1.");
      expect((error as Error).message).not.toContain("SECRET-CELL");
    }
  });

  it("parses 5 MiB in under 2 seconds", () => {
    const row = "tenant-1,Ada,Lovelace,ada@example.test,user01,secret-value-0001";
    const count = Math.floor((5 * 1024 * 1024 - 100) / (row.length + 1));
    const text = `tenant_id,first_name,last_name,email,username,password\n${`${row}\n`.repeat(count)}`;
    const started = performance.now();
    const parsed = parseCsv(Buffer.from(text));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(parsed.rows.length).toBe(count);
  });
});
