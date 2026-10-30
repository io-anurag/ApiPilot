/**
 * Vite plugin that puts the dev server behind per-device access tokens
 * (specs/060-per-device-dev-access, superseding the shared token of specs/049-lan-dev-access-token).
 * It is added to the config only when the listen address is not loopback, so the default
 * configuration is untouched.
 *
 * The guard is the first middleware, so it sees every HTTP request before Vite serves anything or
 * proxies to the backend; WebSocket upgrades are checked by a listener placed ahead of Vite's own.
 * The backend is not changed: its loopback bind and Host/Origin guard stay as they are, and an
 * accepted `/api` request is presented to it as a same-machine request (`presentToBackend`).
 */

import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import {
  ACCESS_HEADER_NAME,
  buildAccessCookie,
  decideAccess,
  hasValidCredential,
  isApiRequest,
  isSameOrigin,
  presentToBackend,
  refusalBody,
} from "./accessControl";
import { AccessStore } from "./accessStore";
import { isIntranetAddress, normalizeClientAddress } from "./clientAddress";
import type { ListenAddress } from "./listenAddress";
import { buildNotice, listNoticeAddresses, type InterfaceTable } from "./notice";

export const DEV_ACCESS_PLUGIN_NAME = "apipilot-dev-access";

export interface DevAccessPluginOptions {
  backendPort: string;
  address: ListenAddress;
  /** Where the notice is written. Defaults to the terminal's stdout. */
  writeNotice?: (text: string) => void;
  /** The machine's network interfaces. Defaults to `os.networkInterfaces()`. */
  interfaces?: () => InterfaceTable;
  /** The peer address of a request. Defaults to the socket's remote address, never a forwarding header. */
  clientAddress?: (req: IncomingMessage) => string | undefined;
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function refuse(res: ServerResponse, api: boolean): void {
  const { contentType, body } = refusalBody(api);
  send(res, 401, contentType, body);
}

function enroll(
  req: IncomingMessage,
  res: ServerResponse,
  address: string | undefined,
  store: AccessStore,
): void {
  if (address === undefined || !isIntranetAddress(address)) {
    send(
      res,
      403,
      "text/plain; charset=utf-8",
      "Access can only be requested from a private network address.",
    );
    return;
  }
  if (!isSameOrigin(req.headers.origin, req.headers.host)) {
    send(
      res,
      403,
      "text/plain; charset=utf-8",
      "Access can only be requested from this page.",
    );
    return;
  }
  const token = store.issue(address);
  if (token === undefined) {
    send(
      res,
      503,
      "text/plain; charset=utf-8",
      "Too many devices have access. Restart the dev server to reset.",
    );
    return;
  }
  send(res, 201, "application/json", JSON.stringify({ token }));
}

/** Issues a token to a browser page load and lets the request carry on, so the page opens with no extra step. */
function enrollBrowser(
  res: ServerResponse,
  address: string | undefined,
  store: AccessStore,
): boolean {
  if (address === undefined || !isIntranetAddress(address)) return false;
  const token = store.issue(address);
  if (token === undefined) return false;
  res.setHeader("Set-Cookie", buildAccessCookie(token));
  return true;
}

export function devAccessPlugin(options: DevAccessPluginOptions): Plugin {
  // One store per plugin instance: a new launch, and a dev-server restart, both start empty.
  const store = new AccessStore();
  const backendOrigin = `http://127.0.0.1:${options.backendPort}`;
  const writeNotice =
    options.writeNotice ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const interfaces =
    options.interfaces ?? (() => os.networkInterfaces() as InterfaceTable);
  const peerAddress = (req: IncomingMessage) =>
    normalizeClientAddress(
      (options.clientAddress ?? ((r) => r.socket.remoteAddress))(req),
    );

  return {
    name: DEV_ACCESS_PLUGIN_NAME,
    configureServer(server) {
      // No returned post-hook: a middleware added here runs before Vite's internal ones.
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const address = peerAddress(req);
          const decision = decideAccess(
            {
              method: req.method,
              url: req.url,
              cookieHeader: req.headers.cookie,
              tokenHeader: req.headers[ACCESS_HEADER_NAME],
              accept: req.headers.accept,
              secFetchDest: headerValue(req.headers["sec-fetch-dest"]),
              secFetchSite: headerValue(req.headers["sec-fetch-site"]),
            },
            (token) => address !== undefined && store.verify(token, address),
          );
          if (decision.kind === "refuse") {
            refuse(res, decision.api);
            return;
          }
          if (decision.kind === "enroll") {
            enroll(req, res, address, store);
            return;
          }
          if (decision.kind === "enroll-browser" && !enrollBrowser(res, address, store)) {
            refuse(res, false);
            return;
          }
          if (isApiRequest(req.url)) presentToBackend(req.headers, backendOrigin);
          next();
        },
      );

      server.httpServer?.prependListener(
        "upgrade",
        (req: IncomingMessage, socket: Duplex) => {
          const address = peerAddress(req);
          const credentials = {
            cookie: req.headers.cookie,
            [ACCESS_HEADER_NAME]: req.headers[ACCESS_HEADER_NAME],
          };
          if (
            address !== undefined &&
            hasValidCredential(credentials, (token) => store.verify(token, address))
          ) {
            return;
          }
          socket.end(
            "HTTP/1.1 401 Unauthorized\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
          );
        },
      );

      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address() as AddressInfo | null;
        if (!address) return;
        writeNotice(
          buildNotice({
            addresses: listNoticeAddresses(
              options.address.host,
              options.address.wildcard,
              interfaces(),
            ),
            port: address.port,
          }),
        );
      });
    },
  };
}
