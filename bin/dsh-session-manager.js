#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { listSessions } from "../lib/index.js";

const [command = "list", ...rest] = process.argv.slice(2);
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));

if (command !== "list" || rest.length > 0) {
  console.error("Usage: dsh-session-manage list");
  console.error("Destructive operations are intentionally available only through the DSH UI, where explicit confirmation is required.");
  process.exitCode = 2;
} else {
  const sessions = await listSessions({ sessionsRoot: join(dshHome, "sessions") });
  for (const session of sessions) {
    console.log(JSON.stringify({ sessionId: session.sessionId, createdAt: session.createdAt, cwd: session.cwd, logPath: session.logPath, uploads: session.deletableFileCount, error: session.error }));
  }
}
