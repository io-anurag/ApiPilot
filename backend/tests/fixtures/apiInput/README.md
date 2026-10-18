# API input fixtures (AP-056)

Fixtures for the format-independent input layer (`backend/src/apiInput/`).

- `har/`: HAR captures. `realistic.har` is a small capture with analytics, a font, a preflight, a redirect, a `304`, repeated
  calls, a varying identifier, bodies in several states and two origins. `seeded-secrets.har` carries recognizable secret
  markers in every location a credential can appear. The `invalid-*.har` files are structurally broken captures.
- `definitions/`: ApiPilot API definition documents (`apipilot.api-definition`, version 1): one valid, one minimal, and one per
  violation class.
- `json/`: JSON documents of other families (Swagger 2.0, a Postman collection, arbitrary JSON, an ambiguous document).

Rules for every file here:

- Synthetic only. No real credential, host, person or customer data.
- No network access is needed to use any fixture.
- Seeded secrets use the marker prefix `SEEDED-SECRET-` so a test can search every output surface for them.
