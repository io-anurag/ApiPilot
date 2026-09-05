#!/usr/bin/env node
// Force-frees the backend and frontend dev ports, regardless of whether Ctrl+C actually
// stopped the underlying process. On Windows, `npm run dev`'s process tree (concurrently ->
// npm -> tsx/vite, each hopping through its own cmd.exe wrapper) is deep enough that a
// console Ctrl+C signal can fail to reach the innermost node process, leaving it bound to
// its port after the terminal appears to exit. This looks up whatever process is actually
// LISTENING on each configured port and kills it directly, sidestepping signal delivery
// entirely. Run via `npm run stop`.
import { execSync } from "node:child_process";
import { platform } from "node:os";

const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 4000;
const FRONTEND_DEV_PORT = Number(process.env.FRONTEND_DEV_PORT) || 5173;
const PORTS = [BACKEND_PORT, FRONTEND_DEV_PORT];

function pidsListeningOnPort(port) {
  const isWindows = platform() === "win32";
  let output;
  try {
    output = execSync(isWindows ? "netstat -ano" : "lsof -nP -iTCP -sTCP:LISTEN", {
      encoding: "utf-8",
    });
  } catch {
    return [];
  }

  const pids = new Set();
  for (const line of output.split("\n")) {
    if (isWindows) {
      // e.g. "  TCP    0.0.0.0:4000           0.0.0.0:0              LISTENING       12345"
      const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!match) continue;
      const localPort = match[1].slice(match[1].lastIndexOf(":") + 1);
      if (Number(localPort) === port) pids.add(match[2]);
    } else {
      // e.g. "node  12345 user  23u  IPv6 ...  TCP *:4000 (LISTEN)"
      if (!line.includes(`:${port} `) && !line.includes(`:${port}->`)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts[1]) pids.add(parts[1]);
    }
  }
  return [...pids];
}

function killPid(pid) {
  try {
    if (platform() === "win32") {
      // /T kills the whole process tree rooted at pid, not just the single process.
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false; // already gone by the time we got here
  }
}

let stoppedAny = false;
for (const port of PORTS) {
  const pids = pidsListeningOnPort(port);
  if (pids.length === 0) {
    console.log(`Port ${port}: nothing listening.`);
    continue;
  }
  for (const pid of pids) {
    const stopped = killPid(pid);
    console.log(
      stopped ? `Port ${port}: stopped PID ${pid}.` : `Port ${port}: PID ${pid} already gone.`,
    );
    stoppedAny ||= stopped;
  }
}

if (!stoppedAny) {
  console.log("No dev servers were running.");
}
