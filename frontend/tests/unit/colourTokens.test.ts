import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");
const css = readFileSync(join(SRC, "index.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Each source file is read once and shared by every check below: the checks scan the whole tree,
// and repeating those synchronous reads per test made them time out when the full suite ran in
// parallel on a busy machine.
const contents = new Map<string, string>();
function read(file: string): string {
  let text = contents.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    contents.set(file, text);
  }
  return text;
}

describe("colour tokens are the only source of colour (AP-041, AP-054)", { timeout: 30_000 }, () => {
  const files = sourceFiles(SRC);

  it("keeps hex colours out of components", () => {
    // WorkflowIcon draws third-party brand logos (Postman, k6, OpenAPI), whose colours are not
    // ApiPilot's to tokenise.
    const allowed = new Set(["components/WorkflowIcon.tsx"]);
    const offenders = files
      .filter((file) => !allowed.has(relative(SRC, file).replaceAll("\\", "/")))
      .filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(read(file)))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("keeps Tailwind palette and raw neutral utilities out of components", () => {
    const palette =
      /\b(?:bg|text|border|ring|fill|stroke|divide|outline|caret|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black)-\d+/;
    const offenders = files
      .filter((file) => palette.test(read(file)))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("never puts white text on the accent, a brand fill or a pale tint (FR-009)", () => {
    // Lime and the olive/mint tints are too pale for white text. A fill that carries text is
    // `bg-accent text-on-accent`. HTTP method labels keep their own pairings (httpMethodStyles).
    const literal = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;
    const paleFill = /(?<![\w:-])bg-(?:brand-\d+|accent|lime-pale|mint|sage|olive)(?![\w-])/;
    const whiteText = /(?<![\w-])text-white(?![\w-])/;
    const offenders = files
      .filter((file) => relative(SRC, file).replaceAll("\\", "/") !== "components/httpMethodStyles.ts")
      .filter((file) =>
        (read(file).match(literal) ?? []).some((text) => paleFill.test(text) && whiteText.test(text)),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("keeps the retired section and workflow colour machinery out (FR-006)", () => {
    const retired =
      /data-section|--section-|--solid-|--color-section|--color-wf-|\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:section|wf)-[a-z]/;
    const offenders = [...files.map((file) => [relative(SRC, file), file] as const), ["index.css", join(SRC, "index.css")] as const]
      .filter(([, file]) => retired.test(read(file)))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it("leaves paragraph text left-aligned (FR-012)", () => {
    expect(css).not.toMatch(/text-align:\s*justify/);
    const offenders = files
      .filter((file) => /\btext-justify\b|\bhyphens-auto\b/.test(read(file)))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
