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

ApiPilot is a local-first API test engineering workspace. It turns an OpenAPI 3.x document (YAML or JSON), a HAR capture of real traffic, or a small ApiPilot API definition into deterministic test scenarios, optional locally generated AI suggestions, reviewed dependency workflows, and validated Postman artifacts, then lets you run them explicitly. It can also run an existing Postman collection or your own k6 script. AI is bounded, validated, and local; it cannot add undocumented endpoints, fields, response codes, or assertions to the executable model.

## Install

Requirements:

- Node.js 24 LTS or newer (see `.nvmrc`) and npm.
- For local AI: disk space for the selected model, free memory for inference, and network access only for the initial model download. The default model (Qwen3-1.7B) needs about 7 GB of disk and about 10 GB of free memory; no GPU is required. A smaller model can be chosen with `AI_MODEL_ID`, at the cost of scenario enhancement mostly coming back empty (see [Configuration](docs/configuration.md)).
- For deterministic-only use and routine tests: set `AI_PROVIDER_MODE=mock`; no model download is needed.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The `.env` file is optional when defaults are acceptable. The default development mode is local AI outside tests; set `AI_PROVIDER_MODE=mock` for a fast, model-free run.

## Quick start

1. Open `http://localhost:5173`. The Vite frontend proxies `/api` to the backend at `http://localhost:4000`.
2. ApiPilot opens on **Home**. Choose **Guided Workflow** (on Home or in the sidebar) and upload an OpenAPI 3.x document, a HAR capture or an API definition (see [Supported inputs](#supported-inputs)).
3. Review the operations, select the ones to test, and generate deterministic scenarios.
4. Optionally run local AI enhancement, then accept, reject, edit, or regenerate scenarios.
5. Review dependencies and workflows, approve them, and generate the Postman artifacts.
6. Continue to **Import & Run Collection**, fill in values for an authorized target, and explicitly start the run.

To run an existing Postman collection instead, choose **Import & Run Collection** on Home or in the sidebar. Every screen has its own address (`#/performance`, `#/k6`, `#/coverage`, `#/guided/<stage>`), so Back, Forward, refresh and bookmarks return to it. Use `npm run stop` to stop the development servers.

ApiPilot is single-user and local-only. It has no authentication, executes scripts you confirm, and holds stored credentials, so the backend binds to `127.0.0.1` by default, and so does the dev server. To open ApiPilot from another device on a network you trust, set `FRONTEND_DEV_HOST`: a non-loopback address makes a per-launch access token mandatory (printed once in the terminal; plain HTTP, so see the limits). Do not otherwise expose it to a network without adding authentication first; see [Configuration, persistence, and security](docs/configuration.md#security-model-single-user-local-only).

## Supported inputs

ApiPilot recognizes what you upload from its content, not its file name.

| Input | What it is | Use it when |
|---|---|---|
| OpenAPI 3.x, YAML or JSON | A documented contract | You have the specification. This is the most reliable source. |
| HAR capture (`.har`) | Requests and responses recorded by a browser or proxy | There is no specification, but you can exercise the API and record it. ApiPilot infers operations from what was observed. |
| ApiPilot API definition (`.json`) | A small, strict JSON file you write | You have neither of the above. Format: [API definition format](docs/api-definition-format.md). |
| Postman collection | A collection of requests | Not used by the guided workflow. ApiPilot tells you to open **Import & Run Collection** and imports nothing. |

Swagger 2.0 is not supported. Other JSON is refused with the supported formats named.

**HAR quick start.** Record a focused session in your browser's developer tools (Network tab, then *Save all as HAR with
content*) or export one from a proxy, choose **Guided Workflow**, and upload the `.har` file. API Review opens with an import
summary (what was imported, excluded and why, and which origins the operations came from), and every fact is labelled
**Observed**, **Inferred** or **Declared** so a capture is never mistaken for a contract. Observed behaviour is a baseline,
not a guarantee: read the limits in the [user manual](docs/USER_MANUAL.md#3-1a-uploading-a-har-capture).

**Captures contain secrets.** A HAR saved from developer tools normally holds cookies, `Authorization` headers and tokens.
ApiPilot replaces credential values with a placeholder as it reads the file and never stores, logs, displays or sends them to
the AI model or into a generated artifact, and the placeholder becomes a variable you fill in when you run. The file on your
disk is unchanged, so strip secrets from it before you share it. A capture is analyzed only on this machine, and nothing in it
is ever fetched or executed.

**Try it.** [`docs/examples/`](docs/examples/) holds a credential-free sample capture
([`sample-capture.har`](docs/examples/sample-capture.har)), a sample definition
([`sample-api-definition.json`](docs/examples/sample-api-definition.json)) and an OpenAPI example in JSON
([`sample-openapi.json`](docs/examples/sample-openapi.json)).

## Documentation

- [User manual](docs/USER_MANUAL.md)
- [Status, limitations, and feature freeze](docs/status.md)
- [Configuration, persistence, and security](docs/configuration.md)
- [HTTP API](docs/http-api.md)
- [API definition format](docs/api-definition-format.md)
- [Development and validation](docs/development.md)
- [Architecture reference](docs/architecture.md)
- [Product roadmap and implementation status](specs/ROADMAP.md)
- [Project constitution](specs/constitution.md)

## License

ApiPilot is released under the [MIT License](LICENSE).
