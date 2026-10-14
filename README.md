<p align="center">
  <img src="docs/assets/apipilot-logo.png" alt="ApiPilot logo" width="160" />
</p>

<h1 align="center">ApiPilot</h1>

[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24_LTS-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.x-6BA539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Vitest](https://img.shields.io/badge/Vitest-testing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-enabled-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/tag/io-anurag/ApiPilot?include_prereleases=&sort=semver&color=blue)](https://github.com/io-anurag/ApiPilot/releases/)

ApiPilot is a local-first API test engineering workspace. It turns an OpenAPI 3.x YAML document into deterministic test scenarios, optional locally generated AI suggestions, reviewed dependency workflows, and validated Postman artifacts, then lets you run them explicitly. It can also run an existing Postman collection or your own k6 script. AI is bounded, validated, and local; it cannot add undocumented endpoints, fields, response codes, or assertions to the executable model.

## Install

Requirements:

- Node.js 24 LTS or newer (see `.nvmrc`) and npm.
- For local AI: disk space for the selected model, free memory for inference, and network access only for the initial model download. No GPU is required.
- For deterministic-only use and routine tests: set `AI_PROVIDER_MODE=mock`; no model download is needed.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The `.env` file is optional when defaults are acceptable. The default development mode is local AI outside tests; set `AI_PROVIDER_MODE=mock` for a fast, model-free run.

## Quick start

1. Open `http://localhost:5173`. The Vite frontend proxies `/api` to the backend at `http://localhost:4000`.
2. Choose **Guided Workflow** and upload an OpenAPI 3.x YAML document.
3. Review the operations, select the ones to test, and generate deterministic scenarios.
4. Optionally run local AI enhancement, then accept, reject, edit, or regenerate scenarios.
5. Review dependencies and workflows, approve them, and generate the Postman artifacts.
6. Continue to **Import & Run Collection**, fill in values for an authorized target, and explicitly start the run.

To run an existing Postman collection instead, choose **Import & Run Collection** on the start screen. Use `npm run stop` to stop the development servers.

ApiPilot is single-user and local-only. It has no authentication, executes scripts you confirm, and holds stored credentials, so the backend binds to `127.0.0.1` by default. Do not expose it to a network without adding authentication first; see [Configuration, persistence, and security](docs/configuration.md#security-model-single-user-local-only).

## Documentation

- [User manual](docs/USER_MANUAL.md)
- [Status, limitations, and feature freeze](docs/status.md)
- [Configuration, persistence, and security](docs/configuration.md)
- [HTTP API](docs/http-api.md)
- [Development and validation](docs/development.md)
- [Architecture reference](docs/architecture.md)
- [Product roadmap and implementation status](specs/ROADMAP.md)
- [Project constitution](specs/constitution.md)

## License

ApiPilot is released under the [MIT License](LICENSE).
