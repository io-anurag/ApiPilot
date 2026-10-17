import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AP-054 colour contract (specs/054-sidebar-shell-redesign/contracts/tokens.md). Reads the literal
 * hex tokens from index.css and checks every required pairing in both themes: 4.5:1 for text, 3:1
 * for control outlines, focus marks and graphics. This test is the authority for the palette
 * values: they are tuned to satisfy it, never the reverse.
 */
const css = readFileSync(join(__dirname, "../../src/index.css"), "utf8");

function blocks(opener: RegExp): string[] {
  const found: string[] = [];
  const pattern = new RegExp(opener.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    found.push(css.slice(start, i - 1));
  }
  return found;
}

function declarations(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    map.set(m[1], m[2].toLowerCase());
  }
  return map;
}

const light = new Map<string, string>();
for (const text of [...blocks(/@theme\s*\{/), ...blocks(/@theme static\s*\{/)]) {
  for (const [k, v] of declarations(text)) light.set(k, v);
}
// The semantic status colours are `var(--color-<status>-600)` in the light theme (@theme static).
for (const status of ["success", "warning", "danger", "info"]) {
  const step = light.get(`${status}-600`);
  if (step !== undefined) light.set(status, step);
}
const darkOverrides = new Map<string, string>();
for (const text of blocks(/:root\[data-theme="dark"\]\s*\{/)) {
  for (const [k, v] of declarations(text)) darkOverrides.set(k, v);
}
const dark = new Map<string, string>([...light, ...darkOverrides]);

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `foreground` at `alpha` over `backdrop`, as utilities like `bg-success-500/15` paint it. */
function blend(foreground: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return foreground.map((v, i) => Math.round(v * alpha + backdrop[i] * (1 - alpha))) as unknown as Rgb;
}

type Pairing = Readonly<{ fg: string; bg: string; min: number; themes?: readonly ("light" | "dark")[] }>;

const TEXT = 4.5;
const NON_TEXT = 3;

function pairs(fgs: readonly string[], bgs: readonly string[], min: number, themes?: Pairing["themes"]): Pairing[] {
  return fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min, themes })));
}

const BODY_SURFACES = ["background", "surface", "surface-subtle", "surface-strong", "lime-pale", "mint"];

const PAIRINGS: readonly Pairing[] = [
  ...pairs(["text-primary", "text-secondary"], BODY_SURFACES, TEXT),
  // Lime in the dark theme is a bright fill; light text on it is not a pairing. Only on-accent is.
  ...pairs(["text-primary", "text-secondary"], ["accent"], TEXT, ["light"]),
  ...pairs(["muted"], ["background", "surface", "surface-subtle"], TEXT),
  ...pairs(["on-accent"], ["accent"], TEXT),
  ...pairs(["brand-700"], ["surface", "background", "lime-pale", "mint"], TEXT),
  ...pairs(["brand-700"], ["accent"], TEXT, ["light"]),
  ...pairs(["border-control"], ["surface", "background", "surface-subtle", "lime-pale", "mint"], NON_TEXT),
  ...pairs(["brand-500"], ["surface", "background", "lime-pale", "mint"], NON_TEXT),
  ...pairs(["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"], ["surface"], NON_TEXT),
  // Status text on its own tint (light: the scale steps components use together).
  ...pairs(["success-700"], ["success-50", "success-100"], TEXT, ["light"]),
  ...pairs(["warning-700"], ["warning-50", "warning-100"], TEXT, ["light"]),
  ...pairs(["danger-700"], ["danger-50", "danger-100"], TEXT, ["light"]),
  ...pairs(["info-700"], ["info-50", "info-100"], TEXT, ["light"]),
  // Semantic status colour as text on the surfaces it sits on, in both themes.
  ...pairs(["success", "warning", "danger", "info"], ["surface", "surface-subtle"], TEXT),
];

const REQUIRED_TOKENS = [
  "background", "surface", "surface-elevated", "surface-subtle", "surface-strong", "surface-hover", "chrome",
  "border", "border-strong", "border-control", "text-primary", "text-secondary", "muted",
  "accent", "on-accent", "lime-pale", "mint", "sage", "olive",
  "brand-50", "brand-100", "brand-200", "brand-300", "brand-400", "brand-500", "brand-600", "brand-700", "brand-800", "brand-900",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6",
  "method-get", "method-post", "method-put", "method-patch", "method-delete", "method-head", "method-options",
  "success-50", "success-100", "success-500", "success-600", "success-700",
  "warning-50", "warning-100", "warning-500", "warning-600", "warning-700",
  "danger-50", "danger-100", "danger-500", "danger-600", "danger-700",
  "info-50", "info-100", "info-500", "info-600", "info-700",
] as const;

/** Tokens a theme may inherit from the light definition because the value is theme-invariant. */
const THEME_INVARIANT = new Set([
  "method-get", "method-post", "method-put", "method-patch", "method-delete", "method-head", "method-options",
  "success-50", "success-100", "success-500", "success-600", "success-700",
  "warning-50", "warning-100", "warning-500", "warning-600", "warning-700",
  "danger-50", "danger-100", "danger-500", "danger-600", "danger-700",
  "info-50", "info-100", "info-500", "info-600", "info-700",
]);

describe("palette tokens (AP-054)", () => {
  it.each(REQUIRED_TOKENS)("defines %s in the light theme", (token) => {
    expect(light.get(token), `--color-${token} is missing from the light theme`).toBeDefined();
  });

  it.each(REQUIRED_TOKENS.filter((t) => !THEME_INVARIANT.has(t)))("defines %s in the dark theme", (token) => {
    expect(darkOverrides.get(token), `--color-${token} is missing from the dark theme`).toBeDefined();
  });

  it("uses the palette values the specification names", () => {
    expect(light.get("accent")).toBe("#e7f68f");
    expect(light.get("lime-pale")).toBe("#f3fcc7");
    expect(light.get("mint")).toBe("#d5f6e5");
    expect(light.get("sage")).toBe("#bdd9ca");
    expect(light.get("olive")).toBe("#ccd97f");
    expect(light.get("background")).toBe("#f8f8f8");
    expect(light.get("brand-700")).toBe("#5b7314");
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("contrast in the %s theme (AP-054)", (theme, tokens) => {
  const applicable = PAIRINGS.filter((p) => p.themes === undefined || p.themes.includes(theme));

  it.each(applicable.map((p) => [`${p.fg} on ${p.bg}`, p] as const))("%s", (_name, pairing) => {
    const fg = tokens.get(pairing.fg);
    const bg = tokens.get(pairing.bg);
    expect(fg, `--color-${pairing.fg}`).toBeDefined();
    expect(bg, `--color-${pairing.bg}`).toBeDefined();
    expect(ratio(rgb(fg as string), rgb(bg as string))).toBeGreaterThanOrEqual(pairing.min);
  });

  it.each(["success", "warning", "danger"] as const)(
    "%s-100 text on its 15%% tint over the surface (dark: variants)",
    (status) => {
      if (theme === "light") return;
      const tint = blend(rgb(tokens.get(`${status}-500`) as string), 0.15, rgb(tokens.get("surface") as string));
      expect(ratio(rgb(tokens.get(`${status}-100`) as string), tint)).toBeGreaterThanOrEqual(TEXT);
    },
  );
});
