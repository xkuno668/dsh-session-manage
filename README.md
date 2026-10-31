<div align="center">

# dsh-session-manage

**DSH Desktop 的会话、文件与上下文管理插件**

在 DSH 设置左侧栏集中查看主会话、会话关联文件、Skill / MCP 使用记录，并以「可审计、可恢复」的方式处理会话及其产物文件。

![version](https://img.shields.io/badge/version-0.5.4-4f46e5)
![node](https://img.shields.io/badge/node-%3E%3D22.15-339933)
![platform](https://img.shields.io/badge/platform-DSH%20Desktop%20%C2%B7%20Web-0ea5e9)
![license](https://img.shields.io/badge/license-MIT-111827)

本地运行 · 不调用模型 · 不消耗 token · 删除即移入回收区

</div>

---

## 目录

- [为什么需要它](#为什么需要它)
- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [删除语义与安全边界](#删除语义与安全边界)
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
这些文件只增不减：会话日志、被会话读过或写过的产物文件、回收区里的历史条目都会一直留在磁盘上。

DSH 本身不提供「这个会话动了哪些文件」的视图。`dsh-session-manage` 补上这一层：

- 以**会话**为单位而不是以**目录**为单位回答「谁产生了这些文件」；
- 处置动作统一走「移入 DSH 回收区 + 写审计」，而不是不可逆的擦除；
- 所有扫描都在本机完成，插件不读取提示词、不调用模型。

## 功能

| 能力 | 说明 |
| --- | --- |
| 主会话列表 | 会话 ID、侧边栏同源标题、工作区、创建时间、日志路径与体积、绑定的子会话数量。被 `parentSession` / `origin: "subagent"` 标记的委派会话不单独占行，其计数归到主会话。 |
| 延迟扫描 | 列表只解码日志头部与标题投影；文件与上下文扫描仅在你点开某一行会话时进行，避免一进设置页就扫全部工作区。 |
| 搜索 | 按会话 ID、标题、工作区、日志路径即时过滤。 |
| 收藏 | 会话可标记收藏（★ 已收藏），状态持久化到本地索引。 |
| 文件树 | 递归展示会话边界内发现的文件与目录，可展开/收起，工作区根目录本身绝不显示为条目。每行给出「作用」「来源」「状态 / 体积」。 |
| 文件处置 | 复选框多选、全选、右键菜单：在资源管理器中定位、复制完整路径、移入回收区。目录按整棵子树处理，父子同时选中时自动去重。 |
| 会话删除 | 连带其子会话、以及只存在于投影中的子代理会话；日志目录与扫描到的现存文件一并移入回收区，并归档侧边栏引用。 |
| Skill / MCP 记录 | 插件运行期间从会话事件里持续记录用到的 Skill、MCP 服务、工具详情与调用次数。 |
| 回收与审计 | 每次移动写入 `audit.jsonl`；回收区可按时间目录人工还原，也可一键在资源管理器中打开。 |
| 清单导出 | 把当前可见会话列表导出为 JSON，便于归档或对外说明。 |
| 零模型开销 | 只读本机元数据与文件系统。 |

界面语言为简体中文；设置项注册在 `settings.section`，与 DSH 其他一级设置入口并列。

## 安装

### 前置条件

| 项目 | 要求 |
| --- | --- |
| DSH Host WebServer | `>= 0.2.1-rc.1 < 0.2.2-0` |
| DSH Cordis | `~4.0.5` |
| React（客户端运行时） | `^18.2.0` |
| Node.js（仅本地开发 / 打包需要） | `>= 22.15.0` |
| 平台 | DSH Desktop / Web；「在资源管理器中打开」仅 Windows |

### 方式一：安装 GitHub Release 里的插件包

从 [Releases](https://github.com/xkuno668/dsh-session-manage/releases) 下载当前版本的
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

安装完成后**完全退出并重新启动 DSH**（宿主插件与客户端 bundle 都在启动期装载），再打开
`设置 → 会话管理`。

> Profile 名称按你实际使用的环境替换，例如 `desktop` / `web`。

## 使用

### 会话列表

1. 打开 **设置 → 会话管理**。
2. 顶部搜索框过滤；`↻ 刷新` 重新读取；`打开回收区` 直接定位到回收目录；`导出 JSON` 导出当前过滤结果。
3. 单击会话行进入详情；右键可「打开会话」或「收藏 / 取消收藏」。

### 会话详情

1. 头部给出 Session ID、标题、工作区、创建时间、绑定子会话数、日志路径。
2. `Skill / MCP 使用记录`：类型、名称、工具 / 详情、调用次数。
3. `会话文件`：树状列表，点击目录名展开或收起；右键可定位、复制路径、移入回收区。
4. 勾选后点 `处理选中项目 (n)`：现存条目移入回收区，不存在的历史条目仅从本插件视图隐藏（不改写 DSH 原始日志）。
5. `删除会话` 会先弹确认框，说明将连同子会话与扫描到的现存文件一起移入回收区。

## 删除语义与安全边界

> [!IMPORTANT]
> 「删除」= 移动到 DSH 专用回收区，不是物理擦除。回收区与源文件应在**同一磁盘卷**上（移动使用同卷原子 `rename`）。

### 证据等级

插件把每个条目标记为四种来源，等级越高，说明「由本会话产生」的证据越强：

| `source` | 含义 | `deletable` |
| --- | --- | --- |
| `session-context` | 运行期事件里出现路径字段，且该事件是写 / 创建类动作，文件创建时间晚于会话创建时间 | ✅ |
| `dsh-upload` | 位于 `<cwd>/.dsh-uploads` 的 DSH 上传附件 | ✅ |
| `session-projection-created` | 持久化投影（`turnOutline`）里出现绝对路径且带创建声明，文件创建时间晚于会话创建时间 | ✅ |
| `session-projection` / `workspace-reference` / `session-tree` | 仅被会话读到 / 提到，或在会话边界内被扫到 | ❌ |

`deletable` 目前用于计数与展示；勾选范围以「本会话扫描到的现存条目」为准（见[已知限制](#已知限制)）。

### 受保护对象（任何情况下都拒绝处置）

- 会话的工作区根目录本身；
- `<DSH_HOME>` 内的任意路径（DSH 运行时数据）；
- 其他**正在运行**的会话所用工作区内的路径；
- 运行中的会话，其文件与会话本身都不可删除（先停止会话再刷新）。

### 审计

每次处置追加一行到 `<trash>/audit.jsonl`：

```json
{"at":"2026-10-31T03:12:44.918Z","action":"session-tree-trash","sessionId":"session-…","childSessionCount":2,"projectionSessionCount":1,"files":[{"path":"<WORKSPACE>\\out\\report.md","sessionId":"session-…","kind":"file","destination":"…"}],"sessions":[{"sessionId":"session-…","source":"…","destination":"…"}]}
```

`action` 取值：`session-tree-trash`、`files-trash-or-hide`。

## 配置

配置通过 `cordis.patch.yml` 注入，默认值从 `DSH_HOME`（或 `~/.dsh`）推导：

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

服务由 DSH 自身的 loopback WebServer 承载，前缀 `/api/dsh-session-manage`（不额外开监听端口）。
请求体上限 512 KiB，仅接受 JSON；响应 `cache-control: no-store`。

| 方法 | 路径 | 请求体 / 查询 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/sessions` | — | 会话元数据列表（含 `pinned`），不扫描文件。 |
| `GET` | `/session` | `?sessionId=` | 单个会话详情：文件树与 Skill / MCP 记录。 |
| `POST` | `/sessions/delete` | `{ sessionId, confirm }` | `confirm` 必须精确等于 `DELETE SESSION <sessionId>`。 |
| `POST` | `/files/delete` | `{ sessionId, paths[], confirm }` | `confirm` 必须精确等于 `DELETE FILES <sessionId>`。 |
| `POST` | `/files/reveal` | `{ sessionId, path }` | 在资源管理器中定位（仅 Windows）。 |
| `POST` | `/trash/reveal` | `{}` | 打开回收区目录（仅 Windows）。 |
| `GET` | `/trash` | — | 读取插件回收区的可恢复条目。 |
| `POST` | `/trash/restore` | `{ id, confirm }` | 恢复条目；恢复会话后提示重启 DSH 以重建侧边栏索引。 |
| `POST` | `/trash/permanently-delete` | `{ id, confirm }` | 永久删除回收区条目；不可恢复。 |
| `POST` | `/desktop/restart` | `{}` | 请求 DSH Desktop 立即重启；仅 Desktop Electron 宿主可用。 |
| `POST` | `/sessions/pin` | `{ sessionId, pinned }` | 收藏 / 取消收藏。 |

业务校验失败统一返回 `400 {"error":"…"}`，未知路径返回 `404`。删除会话成功后返回
`restartRequired: true` —— 建议重启 DSH，让侧边栏索引与磁盘状态对齐。

## 磁盘布局

```text
<DSH_HOME>/
├─ sessions/<workspace>/<session-id>/session.v*.jsonl.zstd   # 会话日志（只读）
├─ storages/
│  ├─ session_projcache/sessions/<session-id>.json           # 侧边栏标题 / 投影（只读）
│  └─ session-manager-context.json                           # 本插件索引（version 4）
└─ trash/session-manager/
   ├─ audit.jsonl                                            # 审计日志
   └─ <ISO 时间戳>/files-<session-id>/<name>-<sha256:12>     # 被移动的文件 / 目录
      <ISO 时间戳>/sessions-<session-id>/<…>                 # 被移动的会话日志目录
```

`session-manager-context.json` 保存运行期观察到的文件条目、Skill / MCP 记录、被隐藏的历史条目与收藏列表；
写入采用「临时文件 + rename」，进程被杀不会留下半截索引。

## CLI

```bash
dsh-session-manage list
```

输出每行一个 JSON（`sessionId`、`createdAt`、`cwd`、`logPath`、`uploads`）。
破坏性操作**只**通过 DSH 界面提供，且必须携带显式确认串。

## 已知限制

- **跨卷移动**：源文件与回收区位于不同盘符时，插件会先完整复制到回收区，成功后才删除源文件；可用空间不足会使操作失败且保留源文件。
- **`deletable` 不拦截勾选**：证据等级目前只参与计数与展示，勾选范围是本会话扫描到的现存条目。请按「来源」「作用」列人工确认后再处置。
- **平台**：资源管理器定位 / 打开回收区仅 Windows；其他平台这两个入口会返回错误。
- **Skill / MCP 记录**：只在插件运行期间从会话事件采集；历史会话若没留下事件，无法回溯，插件不会猜测。
- **扫描上限**：单会话最多 250 个文件条目（超出静默截断）；日志压缩体上限 32 MiB、解码后 96 MiB，超限的会话在列表里显示为无效行。
- **投影路径识别**：从投影文本抽取绝对路径时只识别 Windows 风格 `X:\…`，非 Windows 工作区在投影来源上可能漏项。
- **无一键还原**：回收区、带哈希的目标名与审计日志都已就位，但还原需要按 `audit.jsonl` 手工移回。
- **会话删除不清理投影缓存**：`session_projcache` 中的条目需自行清理。

## 开发

```bash
npm run check    # node --check：lib/index.js、lib/client.js、bin/dsh-session-manager.js
npm test         # node --test test/*.test.js
npm pack
```

测试覆盖的行为（`test/validation.test.js`）：

1. 上传文件可删，普通工作区引用不可删；
2. 委派子会话不出现在主列表，但计入主会话绑定数量；
3. 标题优先取侧边栏投影；
4. 投影里带创建声明的路径被识别为会话产物，且同一行多个路径都能解析；
5. 无创建声明的投影引用可见但不可删。

### 项目结构

```text
dsh-session-manage/
├─ lib/
│  ├─ index.js               # 宿主插件：会话索引、文件扫描、删除边界、HTTP API
│  └─ client.js              # 设置页 UI（经 __ModuleLoader__ 注入，无构建步骤）
├─ bin/
│  └─ dsh-session-manager.js # CLI 入口
├─ test/
│  └─ validation.test.js     # 回归测试
├─ cordis.patch.yml          # Cordis / DSH 注入声明
└─ package.json
```

宿主侧依赖三项服务：`webServer`（注册 API 前缀）、`sessions`（活跃会话判定、归档侧边栏引用）、
`workspaceRegistry`。客户端只依赖 `slots` 与 `locale`。

## 发布

1. 调整 `package.json` 版本号；
2. `npm run check && npm test`；
3. `npm pack` 生成 `dsh-session-manage-<version>.tgz`；
4. 提交源码并打同名 tag（`git tag vX.Y.Z && git push --tags`）；
5. 在 GitHub Release 选择该 tag，上传生成的 `.tgz`，写明变更与兼容性。

仓库只提交源码与文档；`node_modules/`、`.npm-cache/`、`*.tgz` 已在 `.gitignore` 中排除。

## 回收区与收藏区

### 可视化回收区

会话列表顶部的 **♻ 回收区** 会打开插件内的回收区视图。会话作为根节点，显示会话 ID、名称、创建时间；其下以可展开文件树展示该会话移入回收区的文件和目录。

- **恢复原位置**：恢复前检查原路径是否已存在，绝不覆盖已有文件或目录。
- **恢复会话**：恢复会话日志目录后，会调用 DSH `workspaceRegistry.unarchiveSession()` 并提示重启；重启后由 DSH 重新读取索引，在侧边栏恢复会话。
- **永久删除**：需要两次确认；文件或目录会从 DSH 回收区物理删除，无法撤销。
- **保护范围**：操作只接受回收区审计记录中的路径，拒绝任何回收区外路径。

### 收藏区

会话列表顶部的 **★ 收藏** 打开独立分类，只显示已收藏的主会话。可在该分类中直接进入会话，或通过会话右键菜单取消收藏。

## License

[MIT](LICENSE)

## English

`dsh-session-manage` is a plugin for **DSH (DeepSeek Harness) Desktop** that adds a
*Sessions* panel under Settings.

- Lists primary sessions with sidebar-consistent titles, workspace, log size and bound subagent count;
  delegated subagent sessions are folded into their parent instead of cluttering the list.
- Scans file references only for the session you open — from the zstd session log, the durable
  projection cache, and live events — and renders them as an expandable tree.
- Every destructive action is a **move into a DSH-managed trash directory** with an appended
  `audit.jsonl` record; the workspace root, `DSH_HOME`, and paths used by other running sessions are refused.
- Records Skill / MCP usage observed during the plugin's lifetime.
- Host API is served by DSH's own loopback webserver (`/api/dsh-session-manage`), 512 KiB JSON bodies,
  exact-action confirmation tokens. No network egress, no model calls, no token usage.
Requirements: DSH Host WebServer `>=0.2.1-rc.1 <0.2.2-0`, Cordis `~4.0.5`, Node.js `>=22.15`
(dev/packaging only). Explorer integration is Windows-only, and the trash directory must live on the
same volume as the files it receives. UI strings are Simplified Chinese.
