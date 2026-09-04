import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Must be the very first import in server.ts: several modules (e.g. api/aiStatus.ts)
// call getAIProvider() as a module-load side effect, so process.env has to be populated
// before anything else in the app import graph is evaluated.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });
