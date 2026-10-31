<div align="center">

# dsh-session-manage

**DSH（DeepSeek Harness）的会话、产物文件与回收区管理插件**

在「设置 → 会话管理」里按会话查看日志、关联文件与 Skill / MCP 使用记录，并把处置动作收敛成「移入回收区 + 写审计 + 可恢复」。

![version](https://img.shields.io/badge/version-0.5.4-4f46e5)
![node](https://img.shields.io/badge/node-%3E%3D22.15-339933)
![platform](https://img.shields.io/badge/platform-DSH%20Desktop%20%C2%B7%20Web-0ea5e9)
![license](https://img.shields.io/badge/license-MIT-111827)

本地运行 · 不调用模型 · 不消耗 token · 删除即可恢复

</div>

---

## 目录

- [为什么需要它](#为什么需要它)
- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [删除、恢复与安全边界](#删除恢复与安全边界)
- [配置](#配置)
- [HTTP API](#http-api)
- [磁盘布局](#磁盘布局)
- [CLI](#cli)
- [已知限制](#已知限制)
- [开发](#开发)
- [发布](#发布)
- [License](#license)
- [English](#english)

## 为什么需要它

DSH 把每个会话写成 `<DSH_HOME>/sessions/<workspace>/<session-id>/session.v*.jsonl.zstd`，并在
`<DSH_HOME>/storages/session_projcache/sessions/<session-id>.json` 里维护侧边栏标题等投影数据。
这些文件只增不减：会话日志、被会话读过或写过的产物、历史上的删除记录都会一直留在磁盘上，而 DSH 本身不提供
「这个会话动了哪些文件」的视图。

`dsh-session-manage` 补上这一层：

- 以**会话**而不是**目录**为单位回答「谁产生了这些文件」；
- 处置动作统一走「移入 DSH 回收区 + 写审计 + 可恢复」，而不是不可逆的擦除；
- 会话树（主会话 + 子会话 + 仅存在于投影中的委派会话）作为一个整体处理，不会只删掉一半；
- 全部在本机完成：插件不读取提示词、不调用模型。

## 功能

| 能力 | 说明 |
| --- | --- |
| 主会话列表 | 会话 ID、与侧边栏同源的标题、工作区、创建时间、日志路径与体积、绑定的子会话数量。被标记为委派会话（`parentSession` / `origin: "subagent"`）的行不单独占位，计数归入主会话。 |
| 延迟扫描 | 列表只解码日志头部与标题投影；文件与上下文扫描只在你点开某一行为止，避免一进设置页就扫全部工作区。 |
| 搜索与排序 | 按会话 ID、标题、工作区、日志路径即时过滤；按创建时间倒序。 |
| 收藏 | ★ 收藏会话，状态持久化到本地索引，可切换到「仅看收藏」。 |
| 归入工作区 | 把会话归入某个当前已打开的 DSH 工作区，或改为「未分组」；会话会从原工作区移出。 |
| 文件树 | 递归展示会话边界内的文件与目录（可展开/收起），工作区根目录本身绝不作为条目出现；每行给出「作用」「来源」「状态 / 体积」。 |
| 文件处置 | 复选框多选、全选可处理项、右键菜单：在资源管理器中定位、复制完整路径、移入回收区。目录按整棵子树处理，父子同时选中时自动去重。 |
| 停止会话 | 对运行中的主会话（含其子会话）发出停止请求，先停止再处置，避免删掉正在写的日志。 |
| 会话删除 | 连带子会话与「仅存在于投影中的委派会话」；日志目录与扫描到的现存文件一并移入回收区，并归档侧边栏引用。 |
| 回收区视图 | 会话为根节点、文件/目录为子树的可视化回收区；支持恢复原位置、恢复会话、永久删除（单条 / 批量）、在资源管理器中定位、复制路径。 |
| 重启提示 | 恢复会话或删除会话后提示「现在重启 DSH」，由插件调用 Desktop 重启；否则侧边栏索引与磁盘状态不一致。 |
| Skill / MCP 记录 | 插件运行期间从会话事件中持续采集用到的 Skill、MCP 服务、工具详情与调用次数，并持久化。 |
| 审计 | 每次移动 / 恢复 / 永久删除都追加一行到 `audit.jsonl`，回收区视图本身就是从审计记录重建的。 |
| 清单导出 | 把当前过滤后的会话列表导出为 JSON，便于归档或对外说明。 |
| 零模型开销 | 只读本机元数据与文件系统。 |

界面语言为简体中文；设置入口注册在 `settings.section`，与 DSH 其他一级设置项并列。

## 安装

### 前置条件

| 项目 | 要求 |
| --- | --- |
| DSH Host WebServer | `>= 0.2.1-rc.1 < 0.2.2-0` |
| DSH Cordis | `~4.0.5` |
| React（客户端运行时） | `^18.2.0` |
| Node.js（仅开发 / 打包需要） | `>= 22.15.0` |
| 平台 | DSH Desktop 或 Web；「在资源管理器中定位 / 打开」仅 Windows Desktop |

### 方式一：安装 Release 里的插件包

从 [Releases](https://github.com/xkuno668/dsh-session-manage/releases) 下载
`dsh-session-manage-<version>.tgz`，然后：

```bash
dsh plugin --profile desktop add file:./dsh-session-manage-0.5.4.tgz
```

### 方式二：从源码构建安装

```bash
git clone https://github.com/xkuno668/dsh-session-manage.git
cd dsh-session-manage

npm run check    # 语法检查：宿主 / 客户端 / CLI
npm test         # 回归测试
npm pack         # 生成 dsh-session-manage-<version>.tgz

dsh plugin --profile desktop add file:./dsh-session-manage-0.5.4.tgz
```

安装完成后**完全退出并重启 DSH**（宿主插件与客户端 bundle 都在启动期装载），再打开
`设置 → 会话管理`。Profile 名按实际环境替换，例如 `desktop` / `web`。

## 使用

### 会话列表

顶部工具条：搜索框、`↻ 刷新`、`♻ 回收区`、`★ 收藏`、`导出 JSON (n)`。单击会话行进入详情；
右键菜单提供 `打开会话`、`归入工作区`、`收藏 / 取消收藏`。

### 会话详情

1. 头部信息：Session ID、标题、工作区、创建时间、绑定子会话数、日志路径与体积。
2. `Skill / MCP 使用记录`：类型、名称、工具 / 详情、调用次数。
3. `会话文件`：树状列表。勾选框决定处置范围；右键可定位、复制完整路径、移入回收区。
4. `处理选中项目 (n)`：现存的条目移入回收区；状态为「不存在」的历史条目只从本插件视图隐藏，不改写 DSH 原始日志。
5. `■ 停止会话`：对运行中的会话树发出停止请求；`删除会话`：弹确认框，说明将连同子会话与现存文件一起移入回收区。

### 回收区

两种视图可切换：**会话树**（按会话分组，根节点可整体恢复 / 永久删除，子节点是移入回收区的文件与目录）与
**列表**（时间、类型、原路径、关联会话）。都支持 `全选`、`恢复`、`⌫ 永久删除`（批量），
右键菜单提供 `打开回收位置`、`复制原始路径`、`复制回收位置`。

恢复会话后插件会调用 DSH 的 `workspaceRegistry.unarchiveSession()` 并刷新会话索引，然后提示重启；
重启后会话回到侧边栏的「未分组」，由你决定归入哪个工作区。

## 删除、恢复与安全边界

> [!IMPORTANT]
> 本插件的「删除」= 移动到 DSH 专用回收区，不是物理擦除。只有回收区里的「永久删除」是不可撤销的。

### 证据等级

每个条目标记一种来源，等级越高，「由本会话产生」的证据越强：

| `source` | 含义 | `deletable` |
| --- | --- | --- |
| `session-context` | 运行期事件里出现路径字段，且事件是写 / 创建类动作，文件创建时间晚于会话创建时间 | ✅ |
| `dsh-upload` | 位于 `<cwd>/.dsh-uploads` 的 DSH 上传附件 | ✅ |
| `session-projection-created` | 持久化投影（`turnOutline`）中出现绝对路径且带创建声明，文件创建时间晚于会话创建时间 | ✅ |
| `session-projection` / `workspace-reference` / `session-tree` | 仅被会话读到 / 提到，或在会话边界内被扫到 | ❌ |

`deletable` 用于计数与展示；实际可处置范围是「本会话扫描到的现存条目」（见[已知限制](#已知限制)），
处置前请按「来源」「作用」列人工确认。

### 受保护对象

- 会话的工作区根目录本身；
- `<DSH_HOME>` 内的任意路径（DSH 运行时数据）；
- 位于 `sessionsRoot` 之外的会话日志目录；
- 运行中的会话：其文件不可删除，会话树也不可删除 / 需先 `停止会话`；
- 回收区之外任意路径的恢复 / 永久删除请求（只接受 `audit.jsonl` 记录的路径）。

### 移动语义

- 同卷：原子 `rename` 到回收区；
- 跨卷（Windows 不同盘符会返回 `EXDEV`）：先递归 `cp` 到回收区（`errorOnExist`、保留时间戳），成功后再删除源；
  复制失败则源文件保持原样；
- 回收区内目标名带内容无关的路径哈希（`<name>-<sha256:12>`），同名文件不会互相覆盖；
- 恢复时若原路径已被占用，恢复被拒绝，绝不覆盖。

### 审计

每次处置 / 恢复 / 永久删除追加一行到 `<trash>/audit.jsonl`：

```json
{"at":"2026-10-31T03:12:44.918Z","action":"session-tree-trash","sessionId":"session-…","childSessionCount":2,"projectionSessionCount":1,"files":[{"path":"<WORKSPACE>\\out\\report.md","sessionId":"session-…","kind":"file","destination":"…"}],"sessions":[{"sessionId":"session-…","source":"…","destination":"…"}]}
```

`action` 取值：`session-tree-trash`、`files-trash-or-hide`、`session-stop-requested`、
`session-workspace-assigned`、`session-workspace-unassigned`、`trash-restore`、
`trash-permanent-delete`、`trash-permanent-delete-batch`。
回收区视图由该文件重建，删掉它等于放弃可视化管理入口（磁盘内容仍在）。

## 配置

配置通过 `cordis.patch.yml` 注入，默认值从 `DSH_HOME`（否则 `~/.dsh`）推导：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `dshHome` | `$DSH_HOME`，否则 `~/.dsh` | DSH 主目录，同时是受保护根。 |
| `sessionsRoot` | `<dshHome>/sessions` | 会话日志根，删除会话时校验其下路径。 |
| `sessionTitlesRoot` | `<dshHome>/storages/session_projcache/sessions` | 侧边栏标题 / 投影缓存根。 |
| `trashDirectory` | `<dshHome>/trash/session-manager` | 回收区根，`audit.jsonl` 同目录。 |

```yaml
# cordis.patch.yml
- insert:
    - id: session-manage
      name: dsh-session-manage
      config:
        dshHome: !!js dshHomePath()
        trashDirectory: !!js dshHomePath('trash', 'session-manager')

    - id: ui-session-manage
      name: dsh-session-manage/client
```

## HTTP API

服务挂载在 DSH 自身的 loopback WebServer 上，前缀 `/api/dsh-session-manage`（不额外开监听端口）。
请求体上限 512 KiB；业务校验失败统一 `400 {"error":"…"}`，未知路径 `404`；响应 `cache-control: no-store`。
所有破坏性操作都要求 `confirm` 字段与动作串**完全相等**。

| 方法 | 路径 | 请求体 / 查询 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/sessions` | — | 会话元数据列表（含 `pinned`），不扫描文件。 |
| `GET` | `/session` | `?sessionId=` | 单会话详情：文件树 + Skill / MCP 记录。 |
| `GET` | `/workspaces` | — | 当前已打开的 DSH 工作区列表。 |
| `GET` | `/trash` | — | 回收区条目（含文件树、`restorable`、所属会话）。 |
| `POST` | `/sessions/delete` | `{ sessionId, confirm }` | 确认串 `DELETE SESSION <sessionId>`；连带子会话与现存文件移入回收区。 |
| `POST` | `/sessions/stop` | `{ sessionId, confirm }` | 确认串 `STOP SESSION <sessionId>`；停止该会话树中的活动会话。 |
| `POST` | `/sessions/pin` | `{ sessionId, pinned }` | 收藏 / 取消收藏。 |
| `POST` | `/sessions/assign-workspace` | `{ sessionId, workspaceId }` | 归入工作区（先 attach 再 detach 原工作区）。 |
| `POST` | `/sessions/unassign-workspace` | `{ sessionId }` | 改为未分组。 |
| `POST` | `/files/delete` | `{ sessionId, paths[], confirm }` | 确认串 `DELETE FILES <sessionId>`；现存条目入回收区，缺失条目仅隐藏。 |
| `POST` | `/files/reveal` | `{ sessionId, path }` | 在资源管理器中定位（仅 Windows）。 |
| `POST` | `/trash/reveal` | `{}` | 打开回收区目录（仅 Windows）。 |
| `POST` | `/trash/reveal-entry` | `{ id }` | 在资源管理器中定位回收区条目（仅 Windows）。 |
| `POST` | `/trash/restore` | `{ id, confirm }` | 确认串 `RESTORE <entry-id>`；原路径被占用则拒绝。 |
| `POST` | `/trash/permanently-delete` | `{ id, confirm }` | 确认串 `PURGE <entry-id>`；不可撤销。 |
| `POST` | `/trash/permanently-delete-batch` | `{ ids[], confirm }` | 确认串 `PURGE <count> ITEMS`，一次最多 200 条。 |
| `POST` | `/desktop/restart` | `{}` | 请求 DSH Desktop 立即重启（仅 Electron 宿主可用）。 |

会话删除成功返回 `restartRequired: true`；回收区恢复会话同样返回 `restartRequired: true` —— 重启后
DSH 才会重建侧边栏索引。

## 磁盘布局

```text
<DSH_HOME>/
├─ sessions/<workspace>/<session-id>/session.v*.jsonl.zstd   # 会话日志（只读）
├─ storages/
│  ├─ session_projcache/sessions/<session-id>.json           # 侧边栏标题 / 投影（只读）
│  └─ session-manager-context.json                           # 本插件索引（version 4）
└─ trash/session-manager/
   ├─ audit.jsonl                                            # 审计日志（回收区视图的数据源）
   └─ <ISO 时间戳>/
      ├─ files-<session-id>/<name>-<sha256:12>               # 被移入的文件 / 目录
      └─ sessions-<session-id>/<…>                           # 被移入的会话日志目录
```

`session-manager-context.json` 持久化运行期观察到的文件条目、Skill / MCP 记录、被隐藏的历史条目与收藏列表；
写入采用「临时文件 + rename」，进程被杀不会留下半截索引。

## CLI

```bash
dsh-session-manage list
```

每行输出一个 JSON（`sessionId`、`createdAt`、`cwd`、`logPath`、`uploads`）。
破坏性操作**只**通过 DSH 界面或 HTTP API 提供，且必须携带显式确认串。

## 已知限制

- **`deletable` 不拦截勾选**：证据等级目前只参与计数与展示；勾选范围是本会话扫描到的现存条目，请人工确认来源后再处置。
- **平台**：资源管理器定位 / 打开回收区仅 Windows；其他平台会返回明确错误。
- **重启依赖**：恢复或删除会话后，侧边栏要等 DSH 重启才刷新；`/desktop/restart` 仅在 Electron Desktop 宿主可用，Web/CLI 宿主需手动重启。
- **Skill / MCP 记录**：只在插件运行期间从会话事件采集；历史会话若没留下事件就无法回溯，插件不做推测。
- **扫描上限**：单会话最多 250 个文件条目（超出静默截断）；日志压缩体上限 32 MiB、解码后 96 MiB，超限会话在列表里显示为错误行。
- **投影路径识别**：从投影文本抽取路径只识别 Windows 风格 `X:\…`，非 Windows 工作区在投影来源上可能漏项。
- **会话删除不清理投影缓存**：`session_projcache` 中的对应条目需自行清理。
- **回收区依赖审计**：条目来自 `audit.jsonl`；手工删除审计行会让对应条目失去管理入口。

## 开发

```bash
npm run check    # node --check：lib/index.js、lib/client.js、bin/dsh-session-manager.js
npm test         # node --test test/*.test.js
npm pack
```

测试覆盖（`test/validation.test.js`）：

1. `isInside` 拒绝不同盘符的路径（Windows 跨卷边界）；
2. 上传附件可删，普通工作区引用不可删；
3. 委派子会话不出现在主列表，但计入主会话的绑定数量；
4. 标题优先取侧边栏投影；
5. 投影中带创建声明的路径被识别为会话产物；
6. 无创建声明的投影引用可见但不可删。

### 项目结构

```text
dsh-session-manage/
├─ lib/
│  ├─ index.js               # 宿主插件：会话索引、文件扫描、处置边界、回收区、HTTP API
│  └─ client.js              # 设置页 UI（模块加载器注入，无构建步骤）
├─ bin/
│  └─ dsh-session-manager.js # CLI 入口
├─ test/
│  └─ validation.test.js     # 回归测试
├─ cordis.patch.yml          # Cordis / DSH 注入声明
└─ package.json
```

宿主侧依赖三项服务：`webServer`（注册 API 前缀）、`sessions`（活跃会话判定）、`workspaceRegistry`
（归档 / 反归档会话、工作区归属）。客户端只依赖 `slots` 与 `locale`。
`isInside` 与 `listSessions` 对外导出，供 CLI 与测试复用。

## 发布

1. 调整 `package.json` 版本号；
2. `npm run check && npm test`；
3. `npm pack` 生成 `dsh-session-manage-<version>.tgz`；
4. 提交源码并打同名 tag（`git tag vX.Y.Z && git push --tags`）；
5. 在 GitHub Release 选择该 tag，上传 `.tgz`，写明变更与兼容性。

仓库只提交源码与文档；`node_modules/`、`.npm-cache/`、`*.tgz` 已在 `.gitignore` 中排除。

## License

[MIT](LICENSE)

## English

`dsh-session-manage` adds a **Sessions** panel under Settings in **DSH (DeepSeek Harness)**,
turning "which files did this conversation produce?" into an answerable question and making every
destructive action recoverable.

- Lists primary sessions with sidebar-consistent titles, workspace, log size, pinned state and bound
  subagent count; delegated subagent sessions are folded into their parent instead of cluttering the list.
- File and context scans run only for the session you open — from the zstd session log, the durable
  projection cache, and live events — and render as an expandable tree with per-entry provenance.
- Every destructive action moves data into a DSH-managed trash directory and appends an `audit.jsonl`
  record. The workspace root, `DSH_HOME`, session stores outside `sessionsRoot`, and running sessions are
  refused; cross-volume moves copy first and delete only after a successful copy.
- A visual trash view rebuilds itself from the audit log: restore to the original path (never
  overwriting), restore whole sessions back into the sidebar, or permanently delete single or bulk entries.
- Sessions can be stopped, pinned, re-assigned to another open workspace, or moved to "Unassigned".
- Records Skill / MCP usage observed while the plugin runs.
- Host API is served by DSH's own loopback webserver (`/api/dsh-session-manage`, 512 KiB JSON bodies,
  exact-action confirmation tokens). No network egress, no model calls, no token usage.

Requirements: DSH Host WebServer `>=0.2.1-rc.1 <0.2.2-0`, Cordis `~4.0.5`, Node.js `>=22.15`
(development/packaging only). Explorer integration is Windows-only; a DSH restart is required after
restoring or deleting sessions so the sidebar index matches disk. UI strings are Simplified Chinese.
