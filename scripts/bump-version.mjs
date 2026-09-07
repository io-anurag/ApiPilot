import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2];
const increments = { spec: 0, feature: 1, bugfix: 2 };

if (!(kind in increments)) {
  console.error("Usage: npm run version:bump -- <spec|feature|bugfix>");
  process.exit(1);
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  return {
    filePath,
    value: JSON.parse(readFileSync(filePath, "utf8")),
  };
}

const rootPackage = readJson("package.json");
const current = rootPackage.value.version.split(".").map(Number);
if (current.length !== 3 || current.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error(`Invalid root version: ${rootPackage.value.version}`);
}

const next = [...current];
const index = increments[kind];
next[index] += 1;
if (index === 0) {
  next[1] = 0;
  next[2] = 0;
} else if (index === 1) {
  next[2] = 0;
}
const nextVersion = next.join(".");

const packagePaths = ["package.json", "backend/package.json", "frontend/package.json"];
for (const relativePath of packagePaths) {
  const packageFile = readJson(relativePath);
  packageFile.value.version = nextVersion;
  writeFileSync(packageFile.filePath, `${JSON.stringify(packageFile.value, null, 2)}\n`);
}

const lockFile = readJson("package-lock.json");
lockFile.value.version = nextVersion;
for (const relativePath of packagePaths) {
  const workspacePath =
    relativePath === "package.json" ? "" : relativePath.slice(0, -"/package.json".length);
  const packageLockEntry = lockFile.value.packages?.[workspacePath];
  if (packageLockEntry) packageLockEntry.version = nextVersion;
}
writeFileSync(lockFile.filePath, `${JSON.stringify(lockFile.value, null, 2)}\n`);

console.log(`${current.join(".")} -> ${nextVersion} (${kind})`);
