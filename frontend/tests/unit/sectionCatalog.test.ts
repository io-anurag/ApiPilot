import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGE_ORDER } from "@apipilot/shared-domain";
import {
  STAGE_SECTIONS,
  WORKFLOW_SECTIONS,
  type SectionId,
} from "../../src/components/sectionCatalog";

const SRC = join(__dirname, "../../src");
const css = readFileSync(join(SRC, "index.css"), "utf8");

const ALL_SECTIONS: readonly SectionId[] = [
  "spec",
  "analysis",
  "scenarios",
  "ai",
  "dependencies",
  "artifacts",
  "execution",
  "results",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("section catalog (AP-041)", () => {
  it("maps every guided-workflow stage to a known section", () => {
    for (const stageId of WORKFLOW_STAGE_ORDER) {
      expect(ALL_SECTIONS).toContain(STAGE_SECTIONS[stageId]);
    }
  });

  it("maps every standalone workflow to a known section", () => {
    for (const section of Object.values(WORKFLOW_SECTIONS)) {
      expect(ALL_SECTIONS).toContain(section);
    }
  });

  it.each(ALL_SECTIONS)("defines the %s section in both themes", (section) => {
    expect(css).toContain(`[data-section="${section}"]`);
    // One token for the light theme (in @theme static) and one override in the dark block.
    const tokenDeclarations = css.match(new RegExp(`--color-section-${section}:`, "g")) ?? [];
    expect(tokenDeclarations).toHaveLength(2);
  });
});

describe("colour tokens are the only source of colour (AP-041)", () => {
  const files = sourceFiles(SRC);

  it("keeps hex colours out of components", () => {
    // WorkflowIcon draws third-party brand logos (Postman, k6, OpenAPI), whose colours are not
    // ApiPilot's to tokenise.
    const allowed = new Set(["components/WorkflowIcon.tsx"]);
    const offenders = files
      .filter((file) => !allowed.has(relative(SRC, file).replaceAll("\\", "/")))
      .filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("keeps Tailwind palette and raw neutral utilities out of components", () => {
    const palette =
      /\b(?:bg|text|border|ring|fill|stroke|divide|outline|caret|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black)-\d+/;
    const offenders = files
      .filter((file) => palette.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
