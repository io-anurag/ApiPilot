/**
 * Vite plugin that puts the dev server behind a per-launch access token
 * (specs/049-lan-dev-access-token). It is added to the config only when the listen address is not
 * loopback, so the default configuration is untouched.
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
  createAccessToken,
  decideAccess,
  hasValidCredential,
  isApiRequest,
  presentToBackend,
  refusalBody,
} from "./accessControl.ts";
import type { ListenAddress } from "./listenAddress.ts";
import { buildNotice, listNoticeAddresses, type InterfaceTable } from "./notice.ts";

export const DEV_ACCESS_PLUGIN_NAME = "apipilot-dev-access";

export interface DevAccessPluginOptions {
  backendPort: string;
  address: ListenAddress;
  /** Where the notice (which contains the token) is written. Defaults to the terminal's stdout. */
  writeNotice?: (text: string) => void;
  /** The machine's network interfaces. Defaults to `os.networkInterfaces()`. */
  interfaces?: () => InterfaceTable;
}

function refuse(res: ServerResponse, api: boolean): void {
  const { contentType, body } = refusalBody(api);
  res.statusCode = 401;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

export function devAccessPlugin(options: DevAccessPluginOptions): Plugin {
  // One token per plugin instance: a new launch, and a dev-server restart, both get a new one.
  const token = createAccessToken();
  const backendOrigin = `http://127.0.0.1:${options.backendPort}`;
  const writeNotice =
    options.writeNotice ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const interfaces = options.interfaces ?? (() => os.networkInterfaces() as InterfaceTable);

  return {
    name: DEV_ACCESS_PLUGIN_NAME,
    configureServer(server) {
      // No returned post-hook: a middleware added here runs before Vite's internal ones.
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const decision = decideAccess(
          {
            method: req.method,
            url: req.url,
            cookieHeader: req.headers.cookie,
            tokenHeader: req.headers[ACCESS_HEADER_NAME],
          },
          token,
        );
        if (decision.kind === "refuse") {
          refuse(res, decision.api);
          return;
        }
        if (decision.kind === "exchange") {
          // Redirected before any later middleware runs, so the URL carrying the token is never
          // seen by Vite's static serving, error reporting or logger, and is gone from the
          // address bar after one load.
          res.statusCode = 302;
          res.setHeader("Location", decision.location);
          res.setHeader("Set-Cookie", decision.cookie);
          res.setHeader("Cache-Control", "no-store");
          res.end();
          return;
        }
        if (isApiRequest(req.url)) presentToBackend(req.headers, backendOrigin);
        next();
      });

      server.httpServer?.prependListener(
        "upgrade",
        (req: IncomingMessage, socket: Duplex) => {
          const credentials = {
            cookie: req.headers.cookie,
            [ACCESS_HEADER_NAME]: req.headers[ACCESS_HEADER_NAME],
          };
          if (hasValidCredential(credentials, token)) return;
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
            token,
          }),
        );
      });
    },
  };
}
