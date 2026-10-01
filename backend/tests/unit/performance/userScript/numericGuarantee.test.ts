import { describe, expect, it } from "vitest";
import { checkUserScript } from "../../../../src/performance/userScript/checkUserScript";

/**
 * AP-034 research R3 rule 4 (tasks T020): which computed keys and bases the check accepts. Each
 * case is a whole script, so the scope analysis is exercised as the check uses it.
 */
function verdict(body: string): string {
  const result = checkUserScript(Buffer.from(`${body}\nexport default function () {}\n`));
  return result.accepted ? "accepted" : result.problems.map((problem) => problem.rule).join(",");
}

describe("numeric-guaranteed keys", () => {
  it.each([
    ["a number literal", "const x = make(); x[0];"],
    ["unary minus, plus and not", "const x = make(); const s = make(); x[-s]; x[+s]; x[~s];"],
    ["arithmetic and bitwise operators", "const x = make(); const s = make(); x[s - 1]; x[s * 2]; x[s % 3]; x[s | 0]; x[s >>> 1];"],
    ["+ of two numeric operands", "const x = make(); let i = 0; x[i + 1];"],
    ["Math calls", "const x = make(); x[Math.floor(Math.random() * x.length)];"],
    ["k6's __VU and __ITER", "const x = make(); x[__VU]; x[__ITER];"],
    ["a loop counter", "const x = make(); for (let i = 0; i < 3; i++) x[i];"],
    ["a counter written with -= and +=", "const x = make(); let i = 10; i -= 1; i += 2; x[i];"],
    ["a conditional with numeric branches", "const x = make(); const s = make(); x[s ? 1 : 2];"],
  ])("accepts %s", (_label, body) => {
    expect(verdict(body)).toBe("accepted");
  });

  it.each([
    ["a string variable", 'const x = make(); const k = "a"; x[k];'],
    ["a counter later assigned a string", 'const x = make(); let i = 0; i = "constructor"; x[i];'],
    ["+ with a non-numeric operand", 'const x = make(); let i = 0; x[i + "a"];'],
    ["+= with a non-numeric right side", 'const x = make(); let i = 0; i += "a"; x[i];'],
    ["a parameter", "const x = make(); function f(i) { return x[i]; }"],
    ["a for...of variable", "const x = make(); for (const i of [1, 2]) x[i];"],
    ["a destructured variable", "const x = make(); const [i] = [1]; x[i];"],
    ["shadowed Math", 'const x = make(); const Math = { floor: () => "constructor" }; x[Math.floor(1)];'],
    ["shadowed __VU", 'const x = make(); function f(__VU) { return x[__VU]; }'],
    ["a self-referencing initializer", "const x = make(); let i = i; x[i];"],
  ])("refuses %s", (_label, body) => {
    expect(verdict(body)).toBe("computed-access");
  });
});

describe("literal bases and computed writes", () => {
  it("accepts any key on an unshadowed const object or array literal", () => {
    expect(verdict('const T = { a: 1 }; const L = [1]; const k = "a"; T[k]; L[k];')).toBe("accepted");
  });

  it("refuses a const literal shadowed in an inner scope by a non-literal", () => {
    expect(verdict('const T = { a: 1 }; const k = "a"; function f() { const T = make(); return T[k]; }')).toBe("computed-access");
  });

  it("refuses a let literal and a const non-literal", () => {
    expect(verdict('let T = {}; const k = "a"; T[k];')).toBe("computed-access");
    expect(verdict('const T = make(); const k = "a"; T[k];')).toBe("computed-access");
  });

  it("accepts a computed write and refuses a compound assignment on the same base", () => {
    expect(verdict('const T = make(); const k = "a"; T[k] = 1;')).toBe("accepted");
    expect(verdict('const T = make(); const k = "a"; T[k] = 1; T[k] += 1;')).toBe("computed-access");
    expect(verdict('const T = make(); const k = "a"; T[k]++;')).toBe("computed-access");
  });

  it("refuses a second computed read through a literal's result", () => {
    expect(verdict('const T = {}; const k = "a"; T[k][k];')).toBe("computed-access");
    expect(verdict('const T = {}; const k = "a"; const c = T[k]; c[k];')).toBe("computed-access");
  });

  it("accepts __ENV with any key, unless __ENV is shadowed", () => {
    expect(verdict('const k = "A"; __ENV[k];')).toBe("accepted");
    expect(verdict('const k = "A"; function f(__ENV) { return __ENV[k]; }')).toBe("computed-access");
  });
});
