import { CHAIN_PLAN_LIMITS, REFERENCE_NAME } from "@apipilot/shared-domain";

/**
 * The CSV a data set is uploaded as (specs/037-request-chain-performance FR-041, FR-042; research
 * R14): UTF-8 (a byte order mark is dropped), comma-separated, fields quoted as RFC 4180 with `""`
 * for a quote, records ended by CRLF or LF, and a header row whose names follow the `{{name}}` rules.
 * Every row must have the header's number of fields. A file that breaks any rule is refused with the
 * reason and, where it applies, the line, and nothing of it is kept. An empty cell is the empty text.
 * Pure; no value is logged or put in an error.
 */
export type DataSetRefusal =
  | { reason: "empty-file" }
  | { reason: "not-utf8"; line: number }
  | { reason: "no-header-row"; line: number }
  | { reason: "unterminated-quote"; line: number }
  | { reason: "field-count"; line: number; expected: number; found: number }
  | { reason: "too-many-rows"; line: number }
  | { reason: "too-many-columns"; line: number }
  | { reason: "invalid-column-name"; line: number; column: string }
  | { reason: "duplicate-column"; line: number; column: string }
  /** FR-042: column names are unique across a plan's data sets. */
  | { reason: "column-in-other-data-set"; column: string; dataSetName: string };

export class DataSetInvalidError extends Error {
  constructor(readonly refusal: DataSetRefusal) {
    super(refusalText(refusal));
    this.name = "DataSetInvalidError";
  }
}

export function refusalText(refusal: DataSetRefusal): string {
  switch (refusal.reason) {
    case "empty-file":
      return "The file is empty.";
    case "not-utf8":
      return `Line ${refusal.line} is not valid UTF-8. Save the file as UTF-8.`;
    case "no-header-row":
      return `Line ${refusal.line}: the first row must name the columns.`;
    case "unterminated-quote":
      return `Line ${refusal.line}: a quoted field is never closed.`;
    case "field-count":
      return `Line ${refusal.line}: expected ${refusal.expected} fields, found ${refusal.found}.`;
    case "too-many-rows":
      return `Line ${refusal.line}: a data set has at most ${CHAIN_PLAN_LIMITS.dataSetRows.toLocaleString("en-US")} rows.`;
    case "too-many-columns":
      return `Line ${refusal.line}: a data set has at most ${CHAIN_PLAN_LIMITS.dataSetColumns} columns.`;
    case "invalid-column-name":
      return `Line ${refusal.line}: the column name "${refusal.column}" may hold only letters, digits and underscores.`;
    case "duplicate-column":
      return `Line ${refusal.line}: the column ${refusal.column} appears twice.`;
    case "column-in-other-data-set":
      return `The column ${refusal.column} is already a column of ${refusal.dataSetName}. Column names are unique across a plan's data sets.`;
  }
}

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
}

/** The line of the first byte sequence that is not UTF-8, or `null`. */
function invalidUtf8Line(bytes: Buffer): number | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  let line = 1;
  while (start <= bytes.length) {
    let end = bytes.indexOf(0x0a, start);
    if (end < 0) end = bytes.length;
    try {
      decoder.decode(bytes.subarray(start, end));
    } catch {
      return line;
    }
    start = end + 1;
    line += 1;
  }
  return null;
}

export function parseCsv(bytes: Buffer): ParsedCsv {
  const badLine = invalidUtf8Line(bytes);
  if (badLine !== null) throw new DataSetInvalidError({ reason: "not-utf8", line: badLine });
  let text = bytes.toString("utf-8");
  if (text.startsWith("﻿")) text = text.slice(1);
  if (text.trim() === "") throw new DataSetInvalidError({ reason: "empty-file" });

  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let quoteLine = 1;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;
  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    if (records.length > CHAIN_PLAN_LIMITS.dataSetRows + 1) throw new DataSetInvalidError({ reason: "too-many-rows", line: recordLine });
    fields = [];
    field = "";
    fieldStarted = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      quoteLine = line;
      fieldStarted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
      fieldStarted = false;
    } else if (char === "\n" || (char === "\r" && text[index + 1] === "\n")) {
      if (char === "\r") index += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) throw new DataSetInvalidError({ reason: "unterminated-quote", line: quoteLine });
  if (fieldStarted || field !== "" || fields.length > 0) endRecord();

  const [header, ...rows] = records;
  if (header.fields.length === 1 && header.fields[0] === "") throw new DataSetInvalidError({ reason: "no-header-row", line: header.line });
  if (header.fields.length > CHAIN_PLAN_LIMITS.dataSetColumns) throw new DataSetInvalidError({ reason: "too-many-columns", line: header.line });
  const seen = new Set<string>();
  for (const column of header.fields) {
    if (!REFERENCE_NAME.test(column)) throw new DataSetInvalidError({ reason: "invalid-column-name", line: header.line, column });
    if (seen.has(column)) throw new DataSetInvalidError({ reason: "duplicate-column", line: header.line, column });
    seen.add(column);
  }
  for (const row of rows) {
    if (row.fields.length !== header.fields.length) throw new DataSetInvalidError({ reason: "field-count", line: row.line, expected: header.fields.length, found: row.fields.length });
  }
  return { columns: header.fields, rows: rows.map((row) => row.fields) };
}
