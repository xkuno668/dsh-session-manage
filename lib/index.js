/**
 * DSH Session Manager host plugin.
 *
 * Security model:
 * - the API is served by DSH's loopback web server, not a separate listener;
 * - identifiers are verified against a decoded session header before mutation;
 * - destructive requests require an exact, action-specific confirmation token;
 * - "delete" is a same-volume move to the DSH-managed trash directory;
 * - arbitrary workspace paths are never accepted for file deletion.
 */
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { zstdDecompress } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const zstdDecompressAsync = promisify(zstdDecompress);
const API_PREFIX = "/api/dsh-session-manage";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_COMPRESSED_LOG_BYTES = 32 * 1024 * 1024;
const MAX_DECOMPRESSED_LOG_BYTES = 96 * 1024 * 1024;
const MAX_TITLE_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_REFERENCES_PER_SESSION = 250;
const LOG_FILE_RE = /^session\.v\d+\.jsonl\.zstd$/i;
const TRACKER_VERSION = 4;

export const inject = ["webServer", "sessions", "workspaceRegistry"];

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > MAX_BODY_BYTES) throw new Error("Request body exceeds 512 KiB.");
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function requireObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object.");
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function isInside(child, parent) {
  const target = resolve(child);
  const root = resolve(parent);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,180}$/.test(value) ? value : undefined;
}

function isAbsolutePath(value) {
  return typeof value === "string" && isAbsolute(value);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathInfo(path) {
  try {
    const info = await stat(path);
    return {
      exists: true,
      kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      size: info.isFile() ? info.size : undefined,
      fileCreatedAt: info.birthtime.toISOString(),
      fileCreatedAtMs: info.birthtimeMs,
      modifiedAt: info.mtime.toISOString()
    };
  } catch {
    return { exists: false };
  }
}

function boundaryRootOf(path, cwd, dshHome) {
  if (cwd !== undefined && isInside(path, cwd)) return cwd;
  if (dshHome !== undefined && isInside(path, dshHome)) return dshHome;
  return undefined;
}

async function expandDirectoryTree(refs) {
  const entries = new Map(refs.map((item) => [item.path, { ...item, treeDepth: item.treeDepth ?? 0 }]));
  const visit = async (directory, depth, inherited) => {
    if (entries.size >= MAX_REFERENCES_PER_SESSION) return;
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (entries.size >= MAX_REFERENCES_PER_SESSION || child.isSymbolicLink()) continue;
      const path = join(directory, child.name);
      if (!isInside(path, inherited.boundaryRoot)) continue;
      const info = await pathInfo(path);
      const item = { path, source: "session-tree", deletable: inherited.deletable, treeDepth: depth, parentPath: directory, boundaryRoot: inherited.boundaryRoot, ...info };
      entries.set(path, item);
      if (info.kind === "directory") await visit(path, depth + 1, item);
    }
  };
  for (const item of [...entries.values()]) {
    // Never treat the workspace root as a session artifact.
    if (item.kind === "directory" && item.path !== item.boundaryRoot) await visit(item.path, item.treeDepth + 1, item);
  }
  return [...entries.values()].filter((item) => item.path !== item.boundaryRoot).sort((left, right) => left.path.localeCompare(right.path));
}

function parseJsonLines(text, path) {
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      throw new Error(`Session log is malformed at ${path}:${index + 1}.`);
    }
  }
  if (records.length === 0) throw new Error(`Session log is empty: ${path}`);
  return records;
}

async function decodeLog(path) {
  const compressed = await readFile(path);
  if (compressed.length > MAX_COMPRESSED_LOG_BYTES) throw new Error(`Session log exceeds ${MAX_COMPRESSED_LOG_BYTES / 1024 / 1024} MiB compressed limit.`);
  const decoded = await zstdDecompressAsync(compressed);
  if (decoded.length > MAX_DECOMPRESSED_LOG_BYTES) throw new Error(`Session log exceeds ${MAX_DECOMPRESSED_LOG_BYTES / 1024 / 1024} MiB decoded limit.`);
  return parseJsonLines(decoded.toString("utf8"), path);
}

function headerOf(records, path) {
  const header = records[0];
  if (header === null || typeof header !== "object" || Array.isArray(header)) throw new Error(`Session header is invalid: ${path}`);
  if (safeId(header.id) === undefined) throw new Error(`Session header id is invalid: ${path}`);
  if (!Number.isSafeInteger(header.createdAt) || header.createdAt < 0) throw new Error(`Session header createdAt is invalid: ${path}`);
  return header;
}

function titleOf(records) {
  const titleEvent = records.findLast((record) => record?.type === "session/title");
  const title = titleEvent?.data?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : "未命名会话";
}

async function sessionProjectionOf(titlesRoot, sessionId) {
  // The Desktop sidebar does not source its title from the durable session
  // event log. Its authoritative, per-session projection lives in this local
  // cache. Read only the exact safe-ID filename and keep an upper bound so a
  // malformed cache cannot slow down the metadata list.
  if (titlesRoot === undefined || safeId(sessionId) === undefined) return undefined;
  const path = join(resolve(titlesRoot), `${sessionId}.json`);
  if (!isInside(path, titlesRoot)) return undefined;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_TITLE_CACHE_BYTES) return undefined;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing/incompatible UI cache must never hide a valid durable session.
    return undefined;
  }
}

function projectionChildSessionIds(projection) {
  const values = projection?.record?.rows?.subagentCatalog?.val?.head?.values;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => safeId(value?.childId)).filter((id) => id !== undefined))];
}

async function projectionSessionTree(state, rootSessionIds, fallbackCwd, fallbackCreatedAt) {
  const queue = rootSessionIds.map((sessionId) => ({ sessionId, cwd: fallbackCwd, createdAt: fallbackCreatedAt }));
  const seen = new Set();
  const entries = [];
  while (queue.length > 0 && entries.length < 250) {
    const current = queue.shift();
    if (seen.has(current.sessionId)) continue;
    seen.add(current.sessionId);
    const projection = await sessionProjectionOf(state.sessionTitlesRoot, current.sessionId);
    if (projection === undefined) continue;
    const identity = projection?.record?.identity ?? {};
    const cwd = isAbsolutePath(identity.cwd) ? resolve(identity.cwd) : current.cwd;
    const createdAt = Number.isSafeInteger(identity.createdAt) ? identity.createdAt : current.createdAt;
    entries.push({ sessionId: current.sessionId, projection, cwd, createdAt });
    for (const childId of projectionChildSessionIds(projection)) queue.push({ sessionId: childId, cwd, createdAt });
  }
  return entries;
}

async function sidebarTitleOf(titlesRoot, sessionId) {
  const projection = await sessionProjectionOf(titlesRoot, sessionId);
  const title = projection?.record?.rows?.title?.val;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : undefined;
}

// DSH stores delegated work as independent session logs.  They are not
// workspace conversations: a subagent log identifies its owner through
// `parentSession` and normally also has origin=\"subagent\"/a positive depth.
// Keep those implementation sessions out of the manager's top-level list.
function childSessionOf(header) {
  const parentSession = safeId(header?.parentSession);
  const delegated = header?.origin === "subagent"
    || (Number.isSafeInteger(header?.delegationDepth) && header.delegationDepth > 0);
  return { parentSession, isPrimary: parentSession === undefined && !delegated };
}

function descendantSessions(sessions, rootSessionId) {
  const childrenByParent = new Map();
  for (const session of sessions) {
    if (session.parentSession === undefined) continue;
    const children = childrenByParent.get(session.parentSession) ?? [];
    children.push(session);
    childrenByParent.set(session.parentSession, children);
  }
  const descendants = [];
  const seen = new Set([rootSessionId]);
  const visit = (sessionId) => {
    for (const child of childrenByParent.get(sessionId) ?? []) {
      // A malformed circular chain must not loop forever or move a row twice.
      if (seen.has(child.sessionId)) continue;
      seen.add(child.sessionId);
      descendants.push(child);
      visit(child.sessionId);
    }
  };
  visit(rootSessionId);
  return descendants;
}

function visitPaths(value, output, seen, depth = 0, key = "") {
  if (output.size >= MAX_REFERENCES_PER_SESSION || depth > 18 || value === null || value === undefined) return;
  if (typeof value === "string") {
    // Only path-like fields are considered. This blocks a prompt from turning
    // an arbitrary absolute-looking string into a deletable filesystem target.
    if (/path|file|cwd|directory|attachment/i.test(key) && isAbsolutePath(value)) output.add(resolve(value));
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visitPaths(item, output, seen, depth + 1, key);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) visitPaths(child, output, seen, depth + 1, childKey);
}

function uploadRoot(cwd) {
  return cwd === undefined ? undefined : join(cwd, ".dsh-uploads");
}

async function referencesFrom(records, cwd, dshHome) {
  const paths = new Set();
  for (const record of records.slice(1)) visitPaths(record, paths, new WeakSet());
  const uploads = uploadRoot(cwd);
  const refs = [];
  for (const path of paths) {
    // Session events can mention files anywhere. Show only workspace-local
    // values; system paths, other workspaces and credentials never leak here.
    const boundaryRoot = boundaryRootOf(path, cwd, dshHome);
    if (boundaryRoot === undefined) continue;
    const uploaded = uploads !== undefined && isInside(path, uploads);
    const info = await pathInfo(path);
    refs.push({
      path,
      boundaryRoot,
      source: uploaded ? "dsh-upload" : "workspace-reference",
      // Historical logs prove a DSH upload, but not that a normal workspace
      // file was created by this session. Real-time context evidence below is
      // intentionally required before a normal workspace file is deletable.
      deletable: uploaded && (info.kind === "file" || info.kind === "directory"),
      ...info
    });
  }
  return expandDirectoryTree(refs);
}

function projectionWriteIntent(text) {
  // Only an assistant-side success/creation statement can make a durable
  // projection reference deletable, and the file birth time is checked below.
  return /\b(?:created?|wrote|saved|generated|exported|downloaded)\b|(?:已|成功|完成).{0,20}(?:创建|生成|写入|保存|导出|下载)|(?:创建|生成|写入|保存|导出|下载).{0,20}(?:文件|成功|完成)/i.test(text);
}

function visitProjectionPaths(value, output, seen, depth = 0) {
  if (output.size >= MAX_REFERENCES_PER_SESSION || depth > 18 || value === null || value === undefined) return;
  if (typeof value === "string") {
    // Unlike a structured tool event, a projection stores transcript text. It
    // may contain a path without a `filePath` key, so extract only absolute
    // candidates and later restrict them to the session workspace.
    // Markdown images/links often place multiple Windows paths on one line.
    // Parse parenthesized links separately and prevent a bare match from
    // swallowing `) ![next](...` into one non-existent path.
    const matches = [
      ...[...value.matchAll(/\((?:file:\/\/\/)?([A-Za-z]:[\\/][^)\r\n]+)\)/g)].map((match) => match[1]),
      ...(value.match(/[A-Za-z]:[\\/][^\r\n"'`<>()\[\]|?*]*/g) ?? [])
    ];
    const creationClaim = projectionWriteIntent(value);
    for (const match of matches) {
      const candidate = match.replace(/[),.;:!?，。；：]+$/u, "").trim();
      if (isAbsolutePath(candidate)) {
        const path = resolve(candidate);
        output.set(path, Boolean(output.get(path)) || creationClaim);
      }
    }
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) visitProjectionPaths(child, output, seen, depth + 1);
}

async function referencesFromProjection(projection, cwd, createdAt, dshHome) {
  const paths = new Map();
  // `turnOutline` is the durable, condensed transcript available after a
  // restart. Do not scan arbitrary cache rows (permissions and prompts can
  // contain unrelated paths).
  const turns = projection?.record?.rows?.turnOutline?.val?.turns;
  if (Array.isArray(turns)) for (const turn of turns) visitProjectionPaths(turn?.response, paths, new WeakSet());
  const refs = [];
  for (const [path, creationClaim] of paths) {
    const boundaryRoot = boundaryRootOf(path, cwd, dshHome);
    if (boundaryRoot === undefined) continue;
    const info = await pathInfo(path);
    const createdByProjection = creationClaim && (info.kind === "file" || info.kind === "directory") && Number.isFinite(info.fileCreatedAtMs) && info.fileCreatedAtMs >= createdAt;
    refs.push({
      path,
      boundaryRoot,
      source: createdByProjection ? "session-projection-created" : "session-projection",
      deletable: createdByProjection,
      ...info
    });
  }
  return expandDirectoryTree(refs);
}

function mergeStaticFiles(...groups) {
  const byPath = new Map();
  for (const group of groups) for (const item of group) {
    const current = byPath.get(item.path);
    // Keep the stronger deletion evidence if two durable sources name a file.
    byPath.set(item.path, current?.deletable ? current : item);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function logFilesUnder(root) {
  const files = [];
  if (!(await exists(root))) return files;
  const workspaces = await readdir(root, { withFileTypes: true });
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspaceRoot = join(root, workspace.name);
    const candidates = await readdir(workspaceRoot, { withFileTypes: true });
    for (const candidate of candidates) {
      if (!candidate.isDirectory()) continue;
      const sessionRoot = join(workspaceRoot, candidate.name);
      const children = await readdir(sessionRoot, { withFileTypes: true });
      for (const child of children) if (child.isFile() && LOG_FILE_RE.test(child.name)) files.push(join(sessionRoot, child.name));
    }
  }
  return files;
}

function activeSessionIds(ctx) {
  try {
    return new Set(ctx.sessions.list().map((session) => String(session.id)));
  } catch {
    return new Set();
  }
}

function activeWorkspaceRoots(ctx, excludedSessionIds = new Set()) {
  try {
    return ctx.sessions.list()
      .filter((session) => !excludedSessionIds.has(String(session.id)))
      .map((session) => session?.header?.cwd)
      .filter(isAbsolutePath)
      .map(resolve);
  } catch {
    return [];
  }
}

function protectedFromDeletion(state, path, workspaceRoot, activeRoots) {
  // Never move the workspace root or any DSH-owned runtime data. Also avoid
  // modifying a path that lies inside another currently running session's cwd.
  if (samePath(path, workspaceRoot) || isInside(path, state.dshHome)) return true;
  return activeRoots.some((root) => isInside(path, root));
}

/** List stored DSH sessions without mutating state. Exported for the CLI/tests. */
function writeIntent(event) {
  if (event?.type === "tool/call") {
    const text = JSON.stringify(event.data ?? {}).slice(0, 32 * 1024);
    return /(?:write|create|generate|download|save|export|upload)[-_ /]?(?:file|artifact|report|image|document)?/i.test(text);
  }
  if (event?.type === "command/run") {
    const text = JSON.stringify(event.data ?? {}).slice(0, 32 * 1024);
    return /\b(?:new-item|set-content|add-content|out-file|copy-item|move-item|mkdir|md|touch|tee|curl\s+.*-o|wget\s+.*-o)\b/i.test(text);
  }
  return false;
}

function integrationObservations(event) {
  const data = event?.data;
  if (data === null || typeof data !== "object") return [];
  const observed = new Map();
  const add = (kind, name, detail) => {
    if (typeof name !== "string" || name.trim() === "" || name.length > 220 || /[\u0000-\u001f]/.test(name)) return;
    if (detail !== undefined && (typeof detail !== "string" || detail.length > 220 || /[\u0000-\u001f]/.test(detail))) return;
    const key = `${kind}:${name}:${detail ?? ""}`;
    observed.set(key, { kind, name, ...(detail === undefined ? {} : { detail }) });
  };
  const type = typeof event?.type === "string" ? event.type : "";
  const typedSkill = /^skill[/:]([^/:"]+)/i.exec(type);
  if (typedSkill) add("skill", typedSkill[1]);
  const typedMcp = /^mcp[/:]([^/:]+)(?:[/:](.+))?/i.exec(type);
  if (typedMcp) add("mcp", typedMcp[1], typedMcp[2]);
  const walk = (value, key = "", depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (/(?:^|[_-])skill(?:name|id)?$/i.test(key) || /^skill[/:]/i.test(type)) add("skill", value);
      if (/(?:^|[_-])mcp(?:server|name|id)?$/i.test(key)) add("mcp", value);
      if (/(?:tool|function|command)(?:name|id)?$/i.test(key) || /^(name|id)$/i.test(key)) {
        const match = /^(?:mcp__|mcp[/:])([^_/:]+)(?:__|[/:])(.+)$/i.exec(value);
        if (match) add("mcp", match[1], match[2]);
        if (/(?:^|[_-])skill/i.test(value)) add("skill", value);
      }
      return;
    }
    if (typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) walk(child, childKey, depth + 1);
  };
  walk(data);
  return [...observed.values()];
}

function mergeRealtimeFiles(files, observations) {
  if (observations === undefined) return files;
  const byPath = new Map(files.map((item) => [item.path, item]));
  for (const observation of observations.values()) {
    const current = byPath.get(observation.path);
    if (current !== undefined) {
      current.context = observation;
      // A real-time write operation plus a filesystem birth time later than
      // session creation is stronger evidence than a log-only reference.
      if (observation.createdByContext === true && (current.kind === "file" || current.kind === "directory")) {
        current.source = "session-context";
        current.deletable = true;
      }
      continue;
    }
    byPath.set(observation.path, {
      path: observation.path,
      source: observation.createdByContext ? "session-context" : "workspace-reference",
      deletable: observation.createdByContext && (observation.info?.kind === "file" || observation.info?.kind === "directory"),
      ...(observation.info ?? { exists: false }),
      context: observation
    });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function listSessions(options) {
  const logs = await logFilesUnder(options.sessionsRoot);
  const active = options.activeSessionIds ?? new Set();
  const rows = [];
  for (const logPath of logs) {
    try {
      const records = await decodeLog(logPath);
      const header = headerOf(records, logPath);
      const cwd = isAbsolutePath(header.cwd) ? resolve(header.cwd) : undefined;
      const { parentSession, isPrimary } = childSessionOf(header);
      const sidebarTitle = await sidebarTitleOf(options.sessionTitlesRoot, header.id);
      const projection = options.includeFiles === true ? await sessionProjectionOf(options.sessionTitlesRoot, header.id) : undefined;
      const refs = options.includeFiles === true
        ? mergeRealtimeFiles(
          mergeStaticFiles(await referencesFrom(records, cwd, options.dshHome), await referencesFromProjection(projection, cwd, header.createdAt, options.dshHome)),
          options.realtime?.get(header.id)?.files
        )
        : [];
      rows.push({
        sessionId: header.id,
        title: sidebarTitle ?? titleOf(records),
        createdAt: new Date(header.createdAt).toISOString(),
        cwd,
        logPath,
        logSize: (await stat(logPath)).size,
        active: active.has(header.id),
        parentSession,
        isPrimary,
        files: refs,
        deletableFileCount: refs.filter((item) => item.deletable && item.exists).length
      });
    } catch (error) {
      rows.push({
        sessionId: undefined,
        createdAt: undefined,
        cwd: undefined,
        logPath,
        active: false,
        parentSession: undefined,
        isPrimary: false,
        files: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  for (const row of rows) row.childSessionCount = descendantSessions(rows, row.sessionId).length;
  const visible = options.includeChildSessions === true ? rows : rows.filter((row) => row.isPrimary);
  return visible.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

class RealtimeContextTracker {
  constructor(state) {
    this.state = state;
    this.entries = new Map();
    this.pinnedSessionIds = new Set();
    this.writeChain = Promise.resolve();
    this.stopped = false;
    this.path = join(state.dshHome, "storages", "session-manager-context.json");
  }

  async start() {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8"));
      if ((stored?.version === 1 || stored?.version === 2 || stored?.version === 3 || stored?.version === TRACKER_VERSION) && Array.isArray(stored.sessions)) {
        for (const id of Array.isArray(stored.pinnedSessionIds) ? stored.pinnedSessionIds : []) if (safeId(id) !== undefined) this.pinnedSessionIds.add(id);
        for (const row of stored.sessions) {
          if (safeId(row.sessionId) === undefined || !Array.isArray(row.files)) continue;
          if (this.entries.has(row.sessionId)) continue;
          this.entries.set(row.sessionId, {
            sessionId: row.sessionId,
            cwd: isAbsolutePath(row.cwd) ? resolve(row.cwd) : undefined,
            createdAt: Number.isSafeInteger(row.createdAt) ? row.createdAt : 0,
            files: new Map(row.files.filter((item) => isAbsolutePath(item?.path)).map((item) => [resolve(item.path), item])),
            integrations: new Map((Array.isArray(row.integrations) ? row.integrations : [])
              .filter((item) => (item?.kind === "skill" || item?.kind === "mcp") && typeof item?.name === "string")
              .map((item) => [`${item.kind}:${item.name}:${item.detail ?? ""}`, item])),
            hiddenPaths: new Set((Array.isArray(row.hiddenPaths) ? row.hiddenPaths : []).filter((path) => isAbsolutePath(path)).map(resolve))
          });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") this.state.ctx.logger?.warn(`dsh-session-manage: context index ignored: ${String(error)}`);
    }
    for (const session of this.state.ctx.sessions.list()) this.adopt(session);
  }

  adopt(session) {
    const id = safeId(session?.id);
    if (id === undefined) return undefined;
    const header = session.header ?? {};
    const current = this.entries.get(id) ?? {
      sessionId: id,
      cwd: isAbsolutePath(header.cwd) ? resolve(header.cwd) : undefined,
      createdAt: Number.isSafeInteger(header.createdAt) ? header.createdAt : Date.now(),
      files: new Map(),
      integrations: new Map(),
      hiddenPaths: new Set()
    };
    this.entries.set(id, current);
    return current;
  }

  async capture(session, event) {
    if (this.stopped) return;
    const entry = this.adopt(session);
    if (entry === undefined) return;
    const observedAt = new Date().toISOString();
    for (const observation of integrationObservations(event)) {
      const key = `${observation.kind}:${observation.name}:${observation.detail ?? ""}`;
      const prior = entry.integrations.get(key);
      entry.integrations.set(key, {
        ...observation,
        firstSeenAt: prior?.firstSeenAt ?? observedAt,
        lastSeenAt: observedAt,
        callCount: (Number.isSafeInteger(prior?.callCount) ? prior.callCount : 0) + 1
      });
    }
    if (entry.cwd === undefined) { this.scheduleWrite(); return; }
    const paths = new Set();
    visitPaths(event?.data, paths, new WeakSet());
    const uploads = uploadRoot(entry.cwd);
    for (const path of paths) {
      if (!isInside(path, entry.cwd)) continue;
      const info = await pathInfo(path);
      const isUpload = uploads !== undefined && isInside(path, uploads);
      const createdByContext = isUpload || writeIntent(event) && (info.kind === "file" || info.kind === "directory") && Number.isFinite(info.fileCreatedAtMs) && info.fileCreatedAtMs >= entry.createdAt;
      entry.files.set(path, {
        path,
        firstSeenAt: new Date().toISOString(),
        eventType: typeof event?.type === "string" ? event.type : "unknown",
        createdByContext,
        info
      });
    }
    this.scheduleWrite();
  }

  snapshot() { return this.entries; }

  isPinned(sessionId) { return this.pinnedSessionIds.has(sessionId); }

  setPinned(sessionId, pinned) {
    if (safeId(sessionId) === undefined) return;
    if (pinned) this.pinnedSessionIds.add(sessionId); else this.pinnedSessionIds.delete(sessionId);
    this.scheduleWrite();
  }

  hideFileEntry(session, path) {
    const entry = this.adopt(session);
    if (entry === undefined || !isAbsolutePath(path)) return;
    entry.hiddenPaths.add(resolve(path));
    this.scheduleWrite();
  }

  remove(sessionId) {
    this.entries.delete(sessionId);
    this.scheduleWrite();
  }

  scheduleWrite() {
    this.writeChain = this.writeChain.then(async () => {
      const body = JSON.stringify({
        version: TRACKER_VERSION,
        updatedAt: new Date().toISOString(),
        pinnedSessionIds: [...this.pinnedSessionIds],
        sessions: [...this.entries.values()].map((entry) => ({ ...entry, files: [...entry.files.values()], integrations: [...entry.integrations.values()], hiddenPaths: [...entry.hiddenPaths] }))
      });
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, body, "utf8");
      await rename(temporary, this.path);
    }).catch((error) => this.state.ctx.logger?.warn(`dsh-session-manage: context index write failed: ${String(error)}`));
  }

  async stop() {
    this.stopped = true;
    await this.writeChain;
  }
}

async function sessionContents(state, summary) {
  const records = await decodeLog(summary.logPath);
  const cwd = isAbsolutePath(records[0]?.cwd) ? resolve(records[0].cwd) : summary.cwd;
  const projection = await sessionProjectionOf(state.sessionTitlesRoot, summary.sessionId);
  const realtime = state.tracker?.snapshot().get(summary.sessionId);
  const hiddenPaths = realtime?.hiddenPaths ?? new Set();
  return {
    files: mergeRealtimeFiles(
      mergeStaticFiles(await referencesFrom(records, cwd, state.dshHome), await referencesFromProjection(projection, cwd, records[0]?.createdAt, state.dshHome)),
      realtime?.files
    ).filter((file) => !hiddenPaths.has(resolve(file.path))),
    integrations: [...(realtime?.integrations?.values() ?? [])].sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`))
  };
}

async function sessionById(state, sessionId) {
  // The list screen never traverses file references. Decode and scan only the
  // selected session after the user explicitly opens its detail page.
  const summary = await sessionSummaryById(state, sessionId);
  return { ...summary, ...(await sessionContents(state, summary)), deletableFileCount: undefined };
}

async function sessionSummaryById(state, sessionId) {
  const result = (await listSessions({
    sessionsRoot: state.sessionsRoot,
    dshHome: state.dshHome,
    sessionTitlesRoot: state.sessionTitlesRoot,
    activeSessionIds: activeSessionIds(state.ctx)
  }))
    .find((row) => row.sessionId === sessionId);
  if (result === undefined) throw new Error("Session does not exist or its log could not be read.");
  return result;
}

function trashName(path) {
  return `${basename(path)}-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}

async function moveToTrash(source, trashRoot, label) {
  const destination = join(trashRoot, new Date().toISOString().replace(/[:.]/g, "-"), label, trashName(source));
  await mkdir(dirname(destination), { recursive: true });
  // The source is validated beneath a DSH-owned/session-specific root before
  // this call. rename is atomic on one volume and preserves recoverability.
  await rename(source, destination);
  return destination;
}

async function appendAudit(state, event) {
  const path = join(state.trashRoot, "audit.jsonl");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { encoding: "utf8", flag: "a" });
}

async function purgeSession(state, input) {
  const sessionId = requireString(input.sessionId, "sessionId");
  if (input.confirm !== `DELETE SESSION ${sessionId}`) throw new Error("Confirmation must exactly equal DELETE SESSION <sessionId>.");
  const sessions = await listSessions({
    sessionsRoot: state.sessionsRoot,
    dshHome: state.dshHome,
    sessionTitlesRoot: state.sessionTitlesRoot,
    activeSessionIds: activeSessionIds(state.ctx),
    includeChildSessions: true
  });
  const session = sessions.find((row) => row.sessionId === sessionId);
  if (session === undefined || !session.isPrimary) throw new Error("Only a workspace primary session can be deleted.");
  const affected = [session, ...descendantSessions(sessions, sessionId)];
  const running = affected.find((row) => row.active);
  if (running !== undefined) throw new Error(`Cannot delete this session while ${running.sessionId} is running. Stop it first, then refresh this view.`);

  const roots = [...new Map(affected.map((row) => [dirname(row.logPath), row])).entries()];
  if (roots.some(([root]) => !isInside(root, state.sessionsRoot))) throw new Error("Refusing to move a session outside the DSH session store.");
  // Deleting the final visible workspace session is intentional and supported.
  // Only workspace-local files and directories discovered for this session
  // tree are eligible; the workspace root itself is never moved.
  const filesByPath = new Map();
  const protectedFiles = [];
  const activeRoots = activeWorkspaceRoots(state.ctx, new Set(affected.map((row) => row.sessionId)));
  const addFile = (file, owner) => {
    if (!file.exists || (file.kind !== "file" && file.kind !== "directory") || owner.cwd === undefined || samePath(file.path, owner.cwd) || !isInside(file.path, owner.cwd)) return;
    if (protectedFromDeletion(state, file.path, owner.cwd, activeRoots)) { protectedFiles.push(file.path); return; }
    if (!filesByPath.has(file.path)) filesByPath.set(file.path, { path: file.path, sessionId: owner.sessionId, kind: file.kind });
  };
  for (const row of affected) {
    const detail = await sessionContents(state, row);
    for (const file of detail.files) addFile(file, row);
  }
  // DSH presets can delegate work into projection-only child sessions that do
  // not have a separate durable .zstd log. Traverse that catalog too, so their
  // generated artifacts are deleted with the parent session.
  const projectionTree = await projectionSessionTree(state, affected.map((row) => row.sessionId), session.cwd, Date.parse(session.createdAt));
  for (const entry of projectionTree) {
    for (const file of await referencesFromProjection(entry.projection, entry.cwd, entry.createdAt, state.dshHome)) addFile(file, entry);
  }
  if (protectedFiles.length > 0) throw new Error("Refusing to delete files used by DSH or another running session. Stop the other session first, then retry.");
  const movedFiles = [];
  const candidates = [...filesByPath.values()];
  const rootsToMove = candidates.filter((file) => !candidates.some((parent) => parent.kind === "directory" && parent.path !== file.path && isInside(file.path, parent.path)));
  for (const file of rootsToMove) movedFiles.push({ ...file, destination: await moveToTrash(file.path, state.trashRoot, `files-${sessionId}`) });
  const moved = [];
  for (const [root, row] of roots) {
    moved.push({ sessionId: row.sessionId, source: root, destination: await moveToTrash(root, state.trashRoot, `sessions-${sessionId}`) });
    state.tracker?.remove(row.sessionId);
    // Archive prevents a stale sidebar reference from reopening a removed log.
    try { await state.ctx.workspaceRegistry.archiveSession(row.sessionId); } catch { /* optional compatibility path */ }
  }
  await appendAudit(state, { action: "session-tree-trash", sessionId, childSessionCount: affected.length - 1, projectionSessionCount: projectionTree.length, files: movedFiles, sessions: moved });
  return { sessionId, childSessionCount: affected.length - 1, projectionSessionCount: projectionTree.length, movedFiles, moved, restartRequired: true };
}

async function purgeFiles(state, input) {
  const sessionId = requireString(input.sessionId, "sessionId");
  if (input.confirm !== `DELETE FILES ${sessionId}`) throw new Error("Confirmation must exactly equal DELETE FILES <sessionId>.");
  if (!Array.isArray(input.paths) || input.paths.length === 0) throw new Error("paths must contain at least one selected file entry.");
  const session = await sessionById(state, sessionId);
  if (session.active) throw new Error("Files for a running session cannot be deleted. Stop it first, then refresh this view.");
  // The user chooses from paths already constrained to this session's
  // workspace. Existing files are always moved to the managed trash; missing
  // paths are only hidden from this plugin's list below.
  const allowed = new Set(session.files.filter((item) => item.path !== session.cwd).map((item) => item.path));
  const requested = [...new Set(input.paths.map((path) => requireString(path, "paths[]")).map(resolve))];
  if (requested.some((path) => !allowed.has(path))) throw new Error("A selected item is not deletable or is no longer listed by this session. Refresh and select only eligible items.");
  const activeRoots = activeWorkspaceRoots(state.ctx, new Set([sessionId]));
  if (requested.some((path) => protectedFromDeletion(state, path, session.cwd, activeRoots))) throw new Error("Refusing to delete the workspace root, DSH runtime data, or files used by another running session.");
  const moved = [];
  const hidden = [];
  const rootsToMove = requested.filter((path) => !requested.some((parentPath) => {
    const parent = session.files.find((item) => item.path === parentPath);
    return parent?.kind === "directory" && parentPath !== path && isInside(path, parentPath);
  }));
  for (const path of rootsToMove) {
    const file = session.files.find((item) => item.path === path);
    if (file?.exists) moved.push({ path, movedTo: await moveToTrash(path, state.trashRoot, `files-${sessionId}`) });
    else {
      state.tracker?.hideFileEntry({ id: sessionId, header: { cwd: session.cwd, createdAt: Date.parse(session.createdAt) } }, path);
      hidden.push(path);
    }
  }
  await appendAudit(state, { action: "files-trash-or-hide", sessionId, files: moved, hiddenEntries: hidden });
  return { sessionId, moved, hiddenEntries: hidden };
}

async function revealSessionPath(state, input) {
  const sessionId = requireString(input.sessionId, "sessionId");
  const path = resolve(requireString(input.path, "path"));
  const session = await sessionById(state, sessionId);
  const item = session.files.find((file) => file.path === path && file.exists);
  if (item === undefined) throw new Error("Path is not a current, existing item of this session.");
  if (process.platform !== "win32") throw new Error("Opening Explorer is supported only on Windows Desktop.");
  // Do not route this through `cmd start`: Node's Windows argument quoting can
  // turn its required empty title into a literal `\\\" \\\"` path.  Explorer
  // accepts an argv array directly.  Do not use `windowsHide`, as that can
  // suppress a newly created Explorer GUI window in some Desktop hosts.
  const args = item.kind === "file" ? [`/select,${path}`] : [path];
  const child = spawn("explorer.exe", args, { detached: true, stdio: "ignore" });
  await new Promise((resolveLaunch, rejectLaunch) => {
    child.once("spawn", resolveLaunch);
    child.once("error", rejectLaunch);
  });
  child.unref();
  return { path };
}

async function revealTrash(state) {
  if (process.platform !== "win32") throw new Error("Opening Explorer is supported only on Windows Desktop.");
  await mkdir(state.trashRoot, { recursive: true });
  const child = spawn("explorer.exe", [state.trashRoot], { detached: true, stdio: "ignore" });
  await new Promise((resolveLaunch, rejectLaunch) => {
    child.once("spawn", resolveLaunch);
    child.once("error", rejectLaunch);
  });
  child.unref();
  return { path: state.trashRoot };
}

async function handler(state, req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === `${API_PREFIX}/sessions`) {
      // Intentionally metadata-only. File/context traversal runs only after the
      // user opens a single session detail view.
      const sessions = await listSessions({
        sessionsRoot: state.sessionsRoot,
        dshHome: state.dshHome,
        sessionTitlesRoot: state.sessionTitlesRoot,
        activeSessionIds: activeSessionIds(state.ctx)
      });
      json(res, 200, { sessions: sessions.map((session) => ({ ...session, pinned: state.tracker?.isPinned(session.sessionId) ?? false })) });
      return;
    }
    if (req.method === "GET" && url.pathname === `${API_PREFIX}/session`) {
      const sessionId = requireString(url.searchParams.get("sessionId"), "sessionId");
      json(res, 200, { session: await sessionById(state, sessionId) });
      return;
    }
    if (req.method === "POST" && url.pathname === `${API_PREFIX}/sessions/delete`) {
      json(res, 200, await purgeSession(state, requireObject(await readJson(req))));
      return;
    }
    if (req.method === "POST" && url.pathname === `${API_PREFIX}/files/delete`) {
      json(res, 200, await purgeFiles(state, requireObject(await readJson(req))));
      return;
    }
    if (req.method === "POST" && url.pathname === `${API_PREFIX}/files/reveal`) {
      json(res, 200, await revealSessionPath(state, requireObject(await readJson(req))));
      return;
    }
    if (req.method === "POST" && url.pathname === `${API_PREFIX}/trash/reveal`) {
      json(res, 200, await revealTrash(state));
      return;
    }
    if (req.method === "POST" && url.pathname === `${API_PREFIX}/sessions/pin`) {
      const input = requireObject(await readJson(req));
      const sessionId = requireString(input.sessionId, "sessionId");
      const pinned = input.pinned === true;
      await sessionSummaryById(state, sessionId);
      state.tracker?.setPinned(sessionId, pinned);
      json(res, 200, { sessionId, pinned });
      return;
    }
    json(res, 404, { error: "Unknown session-manager endpoint." });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function apply(ctx, config = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".dsh"));
  const state = {
    ctx,
    dshHome,
    sessionsRoot: resolve(config.sessionsRoot ?? join(dshHome, "sessions")),
    sessionTitlesRoot: resolve(config.sessionTitlesRoot ?? join(dshHome, "storages", "session_projcache", "sessions")),
    trashRoot: resolve(config.trashDirectory ?? join(dshHome, "trash", "session-manager"))
  };
  const tracker = new RealtimeContextTracker(state);
  state.tracker = tracker;
  // Register synchronously so no new event is missed while the durable index
  // is loading; start() subsequently adopts pre-existing live sessions.
  ctx.on("session/created", (session) => tracker.adopt(session));
  ctx.on("session/event", (session, event) => { void tracker.capture(session, event); });
  ctx.on("session/disposed", (session) => tracker.adopt(session));
  ctx.effect(() => {
    void tracker.start();
    return () => tracker.stop();
  }, "dsh-session-manage: context tracker");
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: (req, res) => handler(state, req, res)
  }), "dsh-session-manage: API");
}
