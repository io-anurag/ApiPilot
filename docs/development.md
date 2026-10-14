# Development and validation

Run commands from the repository root unless noted otherwise:

```powershell
npm install
npm run build
npm run lint
npm test
npm run dev
npm run stop
```

`npm test`, `npm run lint`, `npm run build` and `npm run dev` first run `scripts/check-dependencies.mjs`, which fails with a "run `npm install`" message naming the missing root dev dependencies when `node_modules` has not been installed, instead of the shell's "command not recognized" error. It only checks; it never installs.

Workspace-specific commands:

```powershell
npm run dev -w backend
npm run build -w backend
npm start -w backend
npm run test -w backend
npm run test:ai-real -w backend
npm run test:ai-real:failure-analysis -w backend
npm run ai:benchmark -w backend

npm run dev -w frontend
npm run build -w frontend
npm run preview -w frontend
npm run test -w frontend
```

`npm test` runs Vitest across the workspace, including backend unit/integration tests, frontend jsdom/React tests, and shared-domain tests. Ordinary tests use mock or scripted providers and do not download a model. `test:ai-real`, `test:ai-real:failure-analysis` (the AP-031 evaluation corpus, recorded in `specs/030-ai-failure-analysis/evaluation.md`), and `ai:benchmark` are opt-in and may load or download local models. `test:k6-real` (`K6_TEST_REAL=1`) is opt-in and needs a k6 1.0.0 or later that you installed; `perf:stub` starts a local stub target for AP-029's manual quickstart. Neither is part of `npm test`.

The backend's `dev` and `start` scripts, and its Vitest workers, run Node with `--disable-warning=DEP0176`. On Node 24, `newman@6.2.3` reads the deprecated `fs.F_OK` constant as it loads, which prints a DeprecationWarning that has no functional effect. Only that warning code is silenced. If you run `backend/dist/server.js` directly with `node`, pass the same flag to keep the log clean.

npm 11, bundled with Node 24, skips dependency install scripts that the root `allowScripts` field does not list. `better-sqlite3` (native build) and `onnxruntime-node` (runtime binaries) need theirs, so their entries are pinned to the installed versions. After upgrading either package, run `npm install-scripts ls` and approve the new version with `npm install-scripts approve <pkg>` once you have reviewed it.

Dependency updates retain the existing major versions; breaking upgrades need separate compatibility review. Node types stay on version 24 to match the runtime. Root `overrides` pin security patches for transitive dependencies. After changing an override, use `npm update <package>` if `npm install` leaves its old locked version in place, and verify the result with `npm ls <package>` and `npm audit`.

The repository has no checked-in Dockerfile, docker-compose file, or deployment manifest. The backend and frontend do have independent production build scripts: the backend compiles to `backend/dist`, and the frontend builds a Vite distribution under `frontend/dist`.
