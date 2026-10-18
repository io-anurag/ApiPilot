import { describe, expect, it } from "vitest";
import { inferPathPatterns, isIdentifierLike, pathKey } from "../../../../src/apiInput/har/inferPathParameters";

const origin = "https://api.shop.test";
const inputs = (method: string, ...paths: string[]) => paths.map((path) => ({ origin, method, path }));
const patternOf = (result: ReturnType<typeof inferPathPatterns>, method: string, path: string) => {
  const found = result.get(pathKey(origin, method, path));
  if (!found) throw new Error(`no result for ${path}`);
  return found;
};

describe("isIdentifierLike", () => {
  it.each([
    "42", "0", "123456789012", "550e8400-e29b-41d4-a716-446655440000", "507f1f77bcf86cd799439011", "deadbeef",
    "DEADBEEFCAFE", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "2026-01-15", "ord_7f3a9c21d4", "a1b2c3d4e5f6a7b8", "user-2024-edition1",
  ])("treats %s as identifier-like", (segment) => {
    expect(isIdentifierLike(segment)).toBe(true);
  });

  it.each(["", "users", "list", "search", "me", "v1", "v2", "abc12", "profile", "orders", "health", "ping", "decade", "facade", "api_v2", "2026-1-5"])(
    "treats %j as literal",
    (segment) => {
      expect(isIdentifierLike(segment)).toBe(false);
    },
  );
});

describe("inferPathPatterns (FR-013, clarification 2026-10-18)", () => {
  it("makes a position with two distinct identifier-like values a parameter and records the values", () => {
    const result = inferPathPatterns(inputs("GET", "/v1/orders/ord_7f3a9c21d4", "/v1/orders/ord_1b2c3d4e5f60"));
    const first = patternOf(result, "GET", "/v1/orders/ord_7f3a9c21d4");
    expect(first.pattern).toBe("/v1/orders/{orderId}");
    expect(first.parameters).toEqual([
      { name: "orderId", position: 2, distinctValues: 2, exampleValues: ["ord_7f3a9c21d4", "ord_1b2c3d4e5f60"] },
    ]);
    expect(first.valuesByParameter).toEqual({ orderId: "ord_7f3a9c21d4" });
    expect(patternOf(result, "GET", "/v1/orders/ord_1b2c3d4e5f60").valuesByParameter).toEqual({ orderId: "ord_1b2c3d4e5f60" });
    expect(first.ambiguous).toEqual([]);
  });

  it("keeps a single identifier-like value literal and reports it as ambiguous", () => {
    const result = inferPathPatterns(inputs("GET", "/v1/invoices/inv_55aa66bb77cc", "/v1/invoices/inv_55aa66bb77cc"));
    const only = patternOf(result, "GET", "/v1/invoices/inv_55aa66bb77cc");
    expect(only.pattern).toBe("/v1/invoices/inv_55aa66bb77cc");
    expect(only.parameters).toEqual([]);
    expect(only.ambiguous).toEqual([{ position: 2, observations: 2 }]);
  });

  it("never merges non-identifier segments, even when they vary", () => {
    const result = inferPathPatterns(inputs("GET", "/v1/users/list", "/v1/users/search", "/v1/users/me"));
    for (const path of ["/v1/users/list", "/v1/users/search", "/v1/users/me"]) {
      expect(patternOf(result, "GET", path).pattern).toBe(path);
      expect(patternOf(result, "GET", path).parameters).toEqual([]);
    }
  });

  it("keeps a literal sibling apart from the parameter", () => {
    const result = inferPathPatterns(inputs("GET", "/v1/users/101", "/v1/users/102", "/v1/users/me"));
    expect(patternOf(result, "GET", "/v1/users/101").pattern).toBe("/v1/users/{userId}");
    expect(patternOf(result, "GET", "/v1/users/me").pattern).toBe("/v1/users/me");
  });

  it("infers one parameter per varying identifier position", () => {
    const result = inferPathPatterns(inputs("GET", "/v1/users/1/orders/9", "/v1/users/2/orders/8"));
    const first = patternOf(result, "GET", "/v1/users/1/orders/9");
    expect(first.pattern).toBe("/v1/users/{userId}/orders/{orderId}");
    expect(first.parameters.map((p) => p.name)).toEqual(["userId", "orderId"]);
    expect(first.valuesByParameter).toEqual({ userId: "1", orderId: "9" });
  });

  it("leaves a position with one distinct value literal while another position varies", () => {
    const result = inferPathParametersOf(inputs("GET", "/v1/users/1/orders/9", "/v1/users/2/orders/9"));
    const first = patternOf(result, "GET", "/v1/users/1/orders/9");
    expect(first.pattern).toBe("/v1/users/{userId}/orders/9");
    expect(first.ambiguous.map((a) => a.position)).toEqual([4]);
  });

  it("does not group across methods, origins or segment counts", () => {
    const mixed = inferPathPatterns([
      { origin, method: "GET", path: "/v1/items/1" },
      { origin, method: "POST", path: "/v1/items/2" },
      { origin: "https://auth.shop.test", method: "GET", path: "/v1/items/3" },
      { origin, method: "GET", path: "/v1/items/4/detail" },
    ]);
    for (const [key, value] of mixed) expect(value.parameters, key).toEqual([]);
  });

  it("names parameters from the singular of the preceding segment, with id as the fallback and a suffix on collision", () => {
    const result = inferPathPatterns(inputs("GET", "/1/2", "/3/4", "/v1/categories/10", "/v1/categories/11", "/v1/addresses/20", "/v1/addresses/21"));
    expect(patternOf(result, "GET", "/1/2").pattern).toBe("/{id}/{id2}");
    expect(patternOf(result, "GET", "/v1/categories/10").pattern).toBe("/v1/categories/{categoryId}");
    expect(patternOf(result, "GET", "/v1/addresses/20").pattern).toBe("/v1/addresses/{addressId}");
  });

  it("keeps at most ten example values and the full distinct count", () => {
    const paths = Array.from({ length: 15 }, (_, i) => `/v1/items/${1000 + i}`);
    const first = patternOf(inferPathPatterns(inputs("GET", ...paths)), "GET", "/v1/items/1000");
    expect(first.parameters[0].distinctValues).toBe(15);
    expect(first.parameters[0].exampleValues).toHaveLength(10);
  });

  it("is deterministic: the same input gives identical output", () => {
    const run = () => JSON.stringify([...inferPathPatterns(inputs("GET", "/v1/a/1", "/v1/a/2", "/v1/b/x1y2z3a4b5c6", "/v1/b/q9w8e7r6t5y4"))]);
    expect(run()).toBe(run());
  });
});

function inferPathParametersOf(value: ReturnType<typeof inputs>) {
  return inferPathPatterns(value);
}
