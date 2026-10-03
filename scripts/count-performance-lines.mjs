import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AP-037 SC-006 (specs/037-request-chain-performance plan.md "SC-006 measured set"): counts the
 * lines of the performance plan code and screens, so the size before and after phase two can be
 * compared. Lines are counted as `wc -l` counts them, which is how the 2026-10-03 baseline of
 * 16,110 was taken. Test files are never in the set; paths that do not exist yet are skipped.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AREAS = [
  {
    name: "backend",
    paths: [
      "backend/src/performance/plan",
      "backend/src/performance/collection",
      "backend/src/performance/quick",
      "backend/src/performance/chain",
      "backend/src/performance/k6/renderScript.ts",
      "backend/src/performance/k6/renderChainScript.ts",
      "backend/src/api/performanceRoutes.ts",
      "backend/src/api/performanceTesting.ts",
      "backend/src/api/quickPerformance.ts",
      "backend/src/api/collectionPerformance.ts",
      "backend/src/api/chainPlans.ts",
      "backend/src/api/chainPlanHttp.ts",
    ],
  },
  {
    name: "frontend",
    paths: [
      "frontend/src/components/performance",
      "frontend/src/components/requestChain",
      "frontend/src/pages/QuickPerformancePage.tsx",
      "frontend/src/pages/CollectionPerformancePage.tsx",
      "frontend/src/pages/RequestChainPlansPage.tsx",
      "frontend/src/services/performanceTestingClient.ts",
      "frontend/src/services/quickPerformanceClient.ts",
      "frontend/src/services/collectionPerformanceClient.ts",
      "frontend/src/services/requestChainClient.ts",
    ],
  },
  {
    name: "shared",
    paths: ["packages/shared-domain/src/performance.ts", "packages/shared-domain/src/requestChain.ts"],
  },
];

const SOURCE = /\.(ts|tsx)$/;
const TEST = /\.test\.(ts|tsx)$/;

function filesUnder(target) {
  const absolute = path.join(root, target);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return SOURCE.test(absolute) && !TEST.test(absolute) ? [absolute] : [];
  return readdirSync(absolute)
    .sort()
    .flatMap((entry) => filesUnder(path.join(target, entry)));
}

function lineCount(file) {
  const text = readFileSync(file, "utf8");
  if (text === "") return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

let total = 0;
for (const area of AREAS) {
  const lines = area.paths.flatMap(filesUnder).reduce((sum, file) => sum + lineCount(file), 0);
  total += lines;
  console.log(`${area.name.padEnd(10)} ${String(lines).padStart(7)}`);
}
console.log(`${"total".padEnd(10)} ${String(total).padStart(7)}`);
