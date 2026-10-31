import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { zstdCompress } from "node:zlib";
import { isInside, listSessions } from "../lib/index.js";

const compress = promisify(zstdCompress);

test("isInside rejects Windows paths on a different drive", () => {
  assert.equal(isInside("E:\\work\\output.txt", "C:\\Users\\Xkuno\\.dsh"), false);
  assert.equal(isInside("C:\\Users\\Xkuno\\.dsh\\sessions\\one", "C:\\Users\\Xkuno\\.dsh"), true);
});

test("listSessions reports upload files but does not make ordinary workspace references deletable", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-manager-"));
  const cwd = join(root, "workspace");
  const sessionDir = join(root, "sessions", "workspace", "abc");
  await mkdir(join(cwd, ".dsh-uploads"), { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const upload = join(cwd, ".dsh-uploads", "report.txt");
  const source = join(cwd, "source.txt");
  await writeFile(upload, "upload");
  await writeFile(source, "source");
  const lines = [
    JSON.stringify({ id: "session-test", createdAt: 1, cwd }),
    JSON.stringify({ type: "tool/result", data: { uploadPath: upload, filePath: source } })
  ].join("\n");
  await writeFile(join(sessionDir, "session.v4.jsonl.zstd"), await compress(Buffer.from(lines)));
  const [session] = await listSessions({ sessionsRoot: join(root, "sessions"), includeFiles: true });
  assert.equal(session.sessionId, "session-test");
  assert.equal(session.files.find((item) => item.path === upload)?.deletable, true);
  assert.equal(session.files.find((item) => item.path === source)?.deletable, false);
});

test("listSessions hides delegated subagent sessions and counts them for their primary session", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-manager-"));
  const sessions = join(root, "sessions", "workspace");
  const writeSession = async (directory, header) => {
    await mkdir(join(sessions, directory), { recursive: true });
    await writeFile(join(sessions, directory, "session.v4.jsonl.zstd"), await compress(Buffer.from(JSON.stringify(header))));
  };
  await writeSession("primary", { id: "primary", createdAt: 1, cwd: root, delegationDepth: 0 });
  await writeSession("child", { id: "child", createdAt: 2, cwd: root, parentSession: "primary", origin: "subagent", delegationDepth: 1 });
  await writeSession("grandchild", { id: "grandchild", createdAt: 3, cwd: root, parentSession: "child", origin: "subagent", delegationDepth: 2 });

  const visible = await listSessions({ sessionsRoot: join(root, "sessions") });
  assert.deepEqual(visible.map((session) => session.sessionId), ["primary"]);
  assert.equal(visible[0].childSessionCount, 2);

  const all = await listSessions({ sessionsRoot: join(root, "sessions"), includeChildSessions: true });
  assert.equal(all.length, 3);
});

test("listSessions uses the same title projection as the Desktop sidebar", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-manager-"));
  const sessionRoot = join(root, "sessions", "workspace", "primary");
  const titleRoot = join(root, "storages", "session_projcache", "sessions");
  await mkdir(sessionRoot, { recursive: true });
  await mkdir(titleRoot, { recursive: true });
  await writeFile(join(sessionRoot, "session.v4.jsonl.zstd"), await compress(Buffer.from(JSON.stringify({ id: "primary", createdAt: 1, cwd: root }))));
  await writeFile(join(titleRoot, "primary.json"), JSON.stringify({ record: { rows: { title: { val: "侧边栏会话标题" } } } }));

  const [session] = await listSessions({ sessionsRoot: join(root, "sessions"), sessionTitlesRoot: titleRoot });
  assert.equal(session.title, "侧边栏会话标题");
});

test("listSessions finds workspace-local paths in the durable session projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-manager-"));
  const workspace = join(root, "workspace");
  const sessionRoot = join(root, "sessions", "workspace", "primary");
  const titleRoot = join(root, "storages", "session_projcache", "sessions");
  const output = join(workspace, "output.txt");
  const secondOutput = join(workspace, "output-two.txt");
  await mkdir(sessionRoot, { recursive: true });
  await mkdir(titleRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(output, "created");
  await writeFile(secondOutput, "created");
  await writeFile(join(sessionRoot, "session.v4.jsonl.zstd"), await compress(Buffer.from(JSON.stringify({ id: "primary", createdAt: 1, cwd: workspace }))));
  const projection = { record: { rows: { turnOutline: { val: { turns: [{ response: `Created ![first](${output}) ![second](${secondOutput})` }] } } } } };
  await writeFile(join(titleRoot, "primary.json"), JSON.stringify(projection));

  const [session] = await listSessions({ sessionsRoot: join(root, "sessions"), sessionTitlesRoot: titleRoot, includeFiles: true });
  assert.equal(session.files.find((item) => item.path === output)?.source, "session-projection-created");
  assert.equal(session.files.find((item) => item.path === output)?.deletable, true);
  assert.equal(session.files.find((item) => item.path === secondOutput)?.deletable, true);
});

test("projection references without a creation claim remain visible but cannot be deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-session-manager-"));
  const workspace = join(root, "workspace");
  const sessionRoot = join(root, "sessions", "workspace", "primary");
  const titleRoot = join(root, "storages", "session_projcache", "sessions");
  const source = join(workspace, "source.txt");
  await mkdir(sessionRoot, { recursive: true });
  await mkdir(titleRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(source, "pre-existing");
  await writeFile(join(sessionRoot, "session.v4.jsonl.zstd"), await compress(Buffer.from(JSON.stringify({ id: "primary", createdAt: Date.now(), cwd: workspace }))));
  await writeFile(join(titleRoot, "primary.json"), JSON.stringify({ record: { rows: { turnOutline: { val: { turns: [{ response: `Read ${source}` }] } } } } }));

  const [session] = await listSessions({ sessionsRoot: join(root, "sessions"), sessionTitlesRoot: titleRoot, includeFiles: true });
  assert.equal(session.files.find((item) => item.path === source)?.deletable, false);
});
