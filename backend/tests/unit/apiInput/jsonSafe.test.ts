import { describe, expect, it } from "vitest";
import {
  nullProtoRecord,
  ownEntries,
  scanJsonDepth,
  toPlainRecord,
  yieldToEventLoop,
} from "../../../src/apiInput/jsonSafe";

describe("scanJsonDepth", () => {
  it("reports the deepest nesting of a well-formed document", () => {
    expect(scanJsonDepth('{"a":[{"b":1}],"c":{}}', 10)).toEqual({ depth: 3, exceeded: false });
    expect(scanJsonDepth("[]", 10)).toEqual({ depth: 1, exceeded: false });
    expect(scanJsonDepth('"just a string"', 10)).toEqual({ depth: 0, exceeded: false });
  });

  it("refuses a hostile run of opening brackets without needing the closers", () => {
    const hostile = "[".repeat(100_000);
    const result = scanJsonDepth(hostile, 128);
    expect(result.exceeded).toBe(true);
    expect(result.depth).toBe(129);
  });

  it("ignores brackets inside string literals, including escaped quotes", () => {
    const text = JSON.stringify({ text: "[[[[[[[[[[[[[[[[ {{{{ \" ]]]] }}}}" });
    expect(scanJsonDepth(text, 2)).toEqual({ depth: 1, exceeded: false });
  });

  it("allows exactly the limit and refuses one past it", () => {
    expect(scanJsonDepth("[[[]]]", 3).exceeded).toBe(false);
    expect(scanJsonDepth("[[[[]]]]", 3).exceeded).toBe(true);
  });
});

describe("prototype-safe helpers", () => {
  it("keeps a __proto__ key as an ordinary key in a null-prototype record", () => {
    const record = nullProtoRecord<number>();
    record["__proto__"] = 1;
    record.polluted = 2;
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const plain = toPlainRecord(record);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(Object.keys(plain).sort()).toEqual(["__proto__", "polluted"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not alter Object.prototype when JSON carries a __proto__ key", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as object;
    expect(ownEntries(parsed)).toEqual([["ok", 1]]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("yieldToEventLoop", () => {
  it("lets queued work run before it resolves", async () => {
    const order: string[] = [];
    setImmediate(() => order.push("other request"));
    await yieldToEventLoop();
    order.push("resumed");
    expect(order).toEqual(["other request", "resumed"]);
  });
});
