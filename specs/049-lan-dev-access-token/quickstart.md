# Quickstart: Verifying the Access-Token-Protected Dev Server

Prerequisites: dependencies installed (`npm install`), a machine with at least one non-loopback network address, and a second device (or a second machine) on the same network. Do this on a network you trust: the connection is plain HTTP.

## 1. Default behaviour is unchanged

1. Leave `FRONTEND_DEV_HOST` unset (or `127.0.0.1`).
2. `npm run dev`.
3. Expect: the server listens on loopback only, no token notice is printed, `http://127.0.0.1:5173` works as before, and `http://<your-ip>:5173` from another device is not reachable.

## 2. Enable a network address

1. In the repository-root `.env`, set `FRONTEND_DEV_HOST=0.0.0.0` (or one specific address). Restart `npm run dev`.
2. Expect: a notice in the terminal listing one `http://<address>:5173/?token=…` per network address, and the statement that the connection is unencrypted.
3. Open one of those addresses on the second device. Expect: the application loads, and the address bar no longer shows `?token=`.
4. Upload a specification, reach scenario review and approve a scenario. Expect: every step works, including the ones that change state.
5. Reload, and open a new tab. Expect: still works, with no need to use the printed address again.

## 3. Refusal checks (from the second device or any shell)

Replace `HOST` with the machine's address.

```powershell
curl -i http://HOST:5173/api/health            # 401, JSON {"error":"unauthorized",...}
curl -i http://HOST:5173/                      # 401, one-line text
curl -i "http://HOST:5173/?token=wrong"        # 401, identical body
curl -i -X POST http://HOST:5173/api/anything  # 401
```

Expect: no application content and no API data in any of them. The same requests succeed when they carry the token in a header, which is how a script or CI job calls the API through the dev server:

```powershell
curl -i -H "X-ApiPilot-Token: <token from the terminal>" http://HOST:5173/api/health   # 200
```

(A `Cookie: apipilot_dev_access=<token>` header works too; that is what the browser holds after opening the printed address.)

## 4. Restart invalidates

1. Stop and start `npm run dev`. Note that the printed token is different.
2. Reload the page on the second device. Expect: `401` with the "open the address printed in the terminal" text. Open the new address to continue.

## 5. Misconfiguration

1. Set `FRONTEND_DEV_HOST=not a host`. Start `npm run dev`.
2. Expect: it refuses to start and the message names `FRONTEND_DEV_HOST`. It does not fall back to another address.

## 6. Nothing leaked

After a session, search for the token you used in `logs/frontend.log` and `logs/backend.log`. Expect: no match in either.

## 7. Automated checks

```powershell
npm test -w frontend      # unit + integration tests for devAccess
npm run lint
npm run build
```

Contract details: [contracts/dev-server-access.md](./contracts/dev-server-access.md). Data shapes: [data-model.md](./data-model.md).
