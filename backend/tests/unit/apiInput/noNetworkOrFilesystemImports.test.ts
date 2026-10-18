import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * specs/056 FR-046, FR-031, FR-032, research R26: nothing in the input layer may open a socket, read a
 * file-system location named in an uploaded file, start a process, undo compression, or depend on a
 * Postman or HAR-conversion library. Enforced by scanning every import in `backend/src/apiInput/`.
 */

const ROOT = path.resolve(__dirname, "../../../src/apiInput");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

const FORBIDDEN_MODULES = [
  "http", "https", "http2", "net", "tls", "dgram", "dns", "child_process", "cluster", "fs", "fs/promises",
  "vm", "worker_threads", "zlib", "readline", "repl",
];
const FORBIDDEN_PACKAGES = ["postman-collection", "newman", "swagger-parser", "har-validator", "har-to-openapi", "har-to-postman", "undici", "node-fetch", "axios"];

describe("the input layer stays free of network, file-system and process access", () => {
  const files = sourceFiles(ROOT);

  it("scans the module", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    it(`${relative} imports no forbidden module`, () => {
      const specifiers = importsOf(readFileSync(file, "utf-8"));
      for (const specifier of specifiers) {
        const bare = specifier.replace(/^node:/, "");
        expect(FORBIDDEN_MODULES, `${relative} imports ${specifier}`).not.toContain(bare);
        expect(FORBIDDEN_PACKAGES, `${relative} imports ${specifier}`).not.toContain(bare);
      }
    });

    it(`${relative} does not evaluate code or call fetch`, () => {
      const source = readFileSync(file, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(source).not.toMatch(/\beval\s*\(/);
      expect(source).not.toMatch(/\bnew\s+Function\s*\(/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    });
  }
});
