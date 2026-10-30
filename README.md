<div align="center">

# dsh-session-manage

**DSH Desktop 会话、文件与上下文管理插件**

在 DSH 设置左侧栏中集中查看主会话、会话文件、Skill/MCP 使用记录，并以可审计、可恢复的方式处理会话关联文件。

`DSH Desktop` · `本地运行` · `不调用模型` · `可恢复删除`

</div>

---

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 主会话列表 | 显示会话 ID、侧边栏同名标题、工作区、创建时间、日志位置与子会话数量；子会话不会单独占用列表。 |
| 延迟扫描 | 打开某一行会话时才扫描该会话的文件和上下文，避免首次进入设置页时扫描全部工作区。 |
| 文件树 | 以树状方式展示该会话发现的文件/目录；工作区根目录（如 `E:\work`）不会显示，只显示其下项目。 |
| 文件操作 | 勾选单项/多项、全选、右键打开资源管理器、复制完整路径、移入 DSH 回收区。 |
| 会话操作 | 打开、收藏或取消收藏会话；删除主会话时会处理关联子会话。 |
| Skill / MCP 记录 | 插件运行期间从会话事件中持续记录使用过的 Skill、MCP 服务、工具详情和调用次数。 |
| 回收与审计 | 不直接递归擦除文件；移动记录会写入审计日志，可手动从回收目录恢复。 |
| 无模型开销 | 插件只读取本机 DSH 元数据和文件系统，不发送提示词、不调用模型、不消耗 token。 |

## 截图

建议在发布仓库后将界面截图放到 `docs/images/`，并在此处引用：

```md
![会话管理界面](docs/images/session-list.png)
![文件树与右键菜单](docs/images/file-menu.png)
```

## 安全与删除策略

> [!IMPORTANT]
> “删除”始终优先采用移动到 DSH 专用回收区的方式，而不是直接物理擦除。

- DSH 主目录（默认 `%USERPROFILE%\.dsh`）与工作区根目录均受保护，不会被作为文件树条目删除。
- 仅处理当前会话可确认关联、且通过边界校验的文件和目录。
- 普通工作区引用如果无法确认由会话创建，会保留为可见条目，但不会被当作可删除产物。
- 正在运行的会话、或其他运行中会话正在使用的路径会被拒绝处理。
- 回收位置：`%USERPROFILE%\.dsh\trash\session-manager\`
- 审计日志：`%USERPROFILE%\.dsh\trash\session-manager\audit.jsonl`

删除操作仍可能影响你的项目文件。执行前请确认文件树、会话归属和右键菜单显示的名称；需要恢复时，请从上述回收目录手动移回原位置。

## 兼容性

| 项目 | 要求 |
| --- | --- |
| DSH Host WebServer | `>= 0.2.1-rc.1 < 0.2.2-0` |
| Node.js（本地开发/打包） | `>= 22.15.0` |
| 平台 | DSH Desktop；资源管理器打开功能仅支持 Windows |

## 安装

### 方式一：安装已打包的本地插件（Windows Desktop）

在项目目录运行：

```powershell
cd E:\work\dsh-session-manager
dsh plugin --profile desktop add file:E:\work\dsh-session-manager\dsh-session-manage-0.3.9.tgz
```

安装完成后，**完全退出并重新启动 DSH Desktop**。然后依次打开：

```text
设置 → 左侧栏「会话管理」
```

> 如果你的版本使用其他 Profile，将命令中的 `desktop` 替换为相应 Profile 名称。

### 方式二：从源码构建后安装

```powershell
cd E:\work\dsh-session-manager
npm.cmd run check
npm.cmd test
npm.cmd pack
dsh plugin --profile desktop add file:E:\work\dsh-session-manager\dsh-session-manage-0.3.9.tgz
```

## 使用说明

### 会话列表

1. 打开 **设置 → 会话管理**。
2. 首页只加载主会话的 ID、名称、工作区、创建时间和日志，避免无意义地扫描所有会话。
3. 单击任意有效会话行进入详情；右键会话可打开或收藏。
4. 使用顶部搜索框匹配会话 ID、名称、工作区或日志路径。

### 文件树与右键菜单

1. 进入会话后，插件扫描本会话的可识别文件关联。
2. 文件树只显示名称，不显示工作区根目录或冗长绝对路径。
3. 单击目录名称可展开/收起子目录。
4. 右键文件或目录可执行：
   - 在资源管理器中打开（文件将被定位选中）；
   - 复制完整路径；
   - 移入 DSH 回收区。
5. 可用复选框处理多个项目；不存在的历史条目只会从插件记录隐藏，不会修改 DSH 原始日志。

### Skill / MCP 记录

插件在自身运行期间监听 DSH 会话事件并持久化观察到的 Skill/MCP 调用。对于 DSH 没有保留工具事件的历史会话，插件不会猜测或伪造记录。

## 开发与验证

```powershell
cd E:\work\dsh-session-manager
npm.cmd run check
npm.cmd test
npm.cmd pack
```

| 命令 | 用途 |
| --- | --- |
| `npm.cmd run check` | 检查宿主代码、客户端代码和 CLI 入口的 JavaScript 语法。 |
| `npm.cmd test` | 运行会话筛选、标题读取、文件关联和删除边界回归测试。 |
| `npm.cmd pack` | 生成可安装的 `dsh-session-manage-<version>.tgz`。 |

## 项目结构

```text
dsh-session-manager/
├─ lib/
│  ├─ index.js                 # DSH 宿主插件：会话索引、文件扫描、删除边界、HTTP API
│  └─ client.js                # 设置页 UI、文件树、右键菜单、交互状态
├─ bin/
│  └─ dsh-session-manager.js   # CLI 入口
├─ test/
│  └─ validation.test.js       # 回归测试
├─ cordis.patch.yml            # Cordis / DSH 注入声明
├─ package.json                # 插件元数据、兼容性和脚本
└─ README.md
```

## 发布到 GitHub 与 Release

建议只提交源码和文档，**不要**提交 `node_modules`、`.npm-cache` 或历史 `.tgz` 包。每个正式版本在 GitHub Release 中上传一个新生成的 `.tgz` 文件即可。

推荐 Release 资产：

```text
dsh-session-manage-<version>.tgz    # 用户安装的插件包
Source code (zip)                   # GitHub 自动生成
Source code (tar.gz)                # GitHub 自动生成
```

### 维护者流程

1. 更新 `package.json` 中的版本号。
2. 运行 `npm.cmd run check` 与 `npm.cmd test`。
3. 运行 `npm.cmd pack` 生成安装包。
4. 提交源码、创建同名 Git tag（例如 `v0.3.9`）。
5. 在 GitHub 创建 Release，选择该 tag，上传本次生成的 `.tgz`，并写明变更与兼容性。

## 许可证

发布前请在仓库根目录添加 `LICENSE`。个人开源项目通常选择：

- **MIT**：限制最少、易于复用；
- **Apache-2.0**：包含专利授权条款；
- **GPL-3.0**：要求衍生作品继续以 GPL 开源。

在未添加许可证前，其他人默认没有明确的复制、修改和分发授权。

## 贡献

欢迎通过 Issue 报告兼容性问题、文件扫描遗漏和 UI 建议。提交 Pull Request 前，请先运行：

```powershell
npm.cmd run check
npm.cmd test
```
