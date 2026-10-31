// DSH client bundles load through this in-page module loader, not browser ESM.
window.__ModuleLoader__.load({ id: "dsh-session-manage", factory: (require) => {
  const module = { exports: {} };
  const exports = module.exports;
  const React = require("react");
  const { useCallback, useEffect, useMemo, useState } = React;
  const API = "/api/dsh-session-manage";

  async function request(path, options) {
    const response = await fetch(`${API}${path}`, options);
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
    return value;
  }

  function time(value) {
    return value === undefined ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
  }

  function size(value) {
    if (typeof value !== "number") return "—";
    const units = ["B", "KiB", "MiB", "GiB"];
    let index = 0; let amount = value;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function workspacePath(path, cwd) {
    if (typeof path !== "string" || typeof cwd !== "string") return path;
    const normalizedPath = path.replaceAll("\\", "/");
    const normalizedRoot = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
    if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return ".";
    if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return normalizedPath.slice(normalizedRoot.length + 1);
    return path;
  }

  function itemName(path) {
    if (typeof path !== "string") return "—";
    return path.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? path;
  }

  function purposeOf(file, allFiles) {
    const origin = file.source === "session-context" ? "会话实时写入" : file.source === "dsh-upload" ? "DSH 上传附件" : file.source === "session-projection-created" ? "会话生成产物" : file.source === "session-projection" ? "会话上下文引用" : file.source === "session-tree" ? "会话目录内项目" : "会话关联项目";
    if (file.kind === "directory") {
      const descendants = allFiles.filter((item) => item.parentPath === file.path).length;
      return `${origin}目录；包含 ${descendants} 个已扫描子项`;
    }
    const extension = typeof file.path === "string" ? (file.path.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase() : "";
    const kind = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension) ? "图像/图表" : ["md", "txt", "doc", "docx", "pdf"].includes(extension) ? "文档或说明" : ["py", "js", "ts", "ps1", "sh", "bat", "cmd"].includes(extension) ? "脚本或源代码" : ["json", "yaml", "yml", "toml", "ini", "xml"].includes(extension) ? "配置或结构化数据" : ["csv", "xlsx", "xls", "db", "sqlite"].includes(extension) ? "数据文件" : ["log", "jsonl"].includes(extension) ? "日志记录" : "会话关联文件";
    return `${origin}；${kind}`;
  }

  const cell = { padding: "11px 13px", verticalAlign: "top", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(100, 116, 139, .16))" };
  const headerCell = { ...cell, textAlign: "left", color: "var(--dsw-alias-label-secondary, #475569)", fontSize: 11, fontWeight: 650, letterSpacing: ".055em", textTransform: "uppercase", background: "var(--dsw-alias-background-l2, rgba(148, 163, 184, .08))" };
  const table = { width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "1px solid var(--dsw-alias-border-l1, rgba(100, 116, 139, .24))", borderRadius: 14, overflow: "hidden", background: "var(--dsw-alias-background, rgba(255,255,255,.72))", boxShadow: "0 5px 18px rgba(15,23,42,.045)" };
  const panel = { border: "1px solid var(--dsw-alias-border-l1, rgba(100, 116, 139, .22))", borderRadius: 14, padding: 14, background: "linear-gradient(135deg, var(--dsw-alias-background-l2, rgba(248,250,252,.8)), var(--dsw-alias-background, rgba(255,255,255,.5)))", boxShadow: "0 4px 16px rgba(15,23,42,.035)" };
  const badge = { display: "inline-block", marginTop: 5, padding: "2px 8px", borderRadius: 999, fontSize: 11, lineHeight: "17px", fontWeight: 560, background: "var(--dsw-alias-background-l3, #e2e8f0)", color: "var(--dsw-alias-label-secondary, #475569)" };
  const button = { marginRight: 8, borderRadius: 8 };
  const menuStyle = { position: "fixed", zIndex: 30, minWidth: 260, maxWidth: 360, padding: 8, borderRadius: 14, border: "1px solid var(--dsw-alias-border-l1, rgba(100,116,139,.28))", background: "var(--dsw-alias-background, rgba(255,255,255,.96))", boxShadow: "0 18px 42px rgba(15,23,42,.22)", backdropFilter: "blur(14px)" };
  const menuButton = { display: "block", width: "100%", padding: "9px 10px", textAlign: "left", border: 0, borderRadius: 8, background: "transparent", cursor: "pointer" };
  const menuTitle = { padding: "4px 8px 2px", fontSize: 11, lineHeight: "16px", fontWeight: 700, letterSpacing: ".05em", color: "var(--dsw-alias-label-secondary, #64748b)", textTransform: "uppercase" };
  const menuPath = { padding: "3px 8px 8px", color: "var(--dsw-alias-label-secondary, #64748b)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const menuDivider = { height: 1, margin: "4px 4px", background: "var(--dsw-alias-border-l1, rgba(100,116,139,.2))" };
  const hoverColor = "var(--dsw-alias-background-hover, rgba(0, 0, 0, 0.08))";
  const transparentButton = {
    minHeight: 32,
    padding: "6px 10px",
    border: "1px solid var(--dsw-alias-border-l1, rgba(100, 116, 139, .28))",
    borderRadius: 8,
    background: "transparent",
    color: "inherit",
    fontWeight: 520,
    lineHeight: "18px"
  };

  // Native buttons do not receive a consistent hover treatment from every
  // Desktop theme.  Keep it local to the plugin so every actionable item has
  // the same clear, low-risk affordance.
  function HoverButton({ style, disabled, onMouseEnter, onMouseLeave, ...props }) {
    const [hovered, setHovered] = useState(false);
    return React.createElement("button", {
      ...props,
      disabled,
      onMouseEnter: (event) => { setHovered(true); onMouseEnter?.(event); },
      onMouseLeave: (event) => { setHovered(false); onMouseLeave?.(event); },
      style: {
        ...transparentButton,
        ...style,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? .52 : 1,
        background: hovered && !disabled ? hoverColor : "transparent",
        borderColor: hovered && !disabled ? "var(--dsw-alias-border-l2, rgba(71, 85, 105, .48))" : (style?.borderColor ?? transparentButton.border),
        boxShadow: hovered && !disabled ? "inset 0 0 0 1px rgba(71, 85, 105, .10), 0 2px 7px rgba(15,23,42,.08)" : (style?.boxShadow ?? "none"),
        transform: hovered && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease"
      }
    });
  }

  function SessionList({ sessions, busy, onOpen, onPin, onAssignWorkspace, onTrash, onFavorites, favoritesMode = false, onBack }) {
    const [query, setQuery] = useState("");
    const [hoveredLog, setHoveredLog] = useState();
    const [menu, setMenu] = useState();
    const visible = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return needle === "" ? sessions : sessions.filter((session) => [session.sessionId, session.title, session.cwd, session.logPath, session.createdAt].some((value) => String(value ?? "").toLowerCase().includes(needle)));
    }, [sessions, query]);
    const exportInventory = () => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sessions: visible }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `dsh-session-inventory-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
    };
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { ...panel, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 } },
        React.createElement("input", { value: query, disabled: busy, onChange: (event) => setQuery(event.target.value), placeholder: "搜索 ID、会话名称、工作区或日志", "aria-label": "搜索会话", style: { minWidth: 240, flex: "1 1 260px", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1, rgba(100,116,139,.28))", background: "transparent", color: "inherit", outline: "none" } }),
        favoritesMode && React.createElement(HoverButton, { disabled: busy, onClick: onBack }, "← 全部会话"),
        React.createElement(HoverButton, { disabled: busy || visible.length === 0, onClick: exportInventory }, `导出 JSON (${visible.length})`),
        !favoritesMode && React.createElement(HoverButton, { disabled: busy, onClick: onFavorites }, `★ 收藏 (${sessions.filter((session) => session.pinned).length})`),
        React.createElement(HoverButton, { disabled: busy, onClick: onTrash }, "♻ 回收区"),
        React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, favoritesMode ? "仅显示已收藏的工作区主会话。" : "仅显示工作区主会话；单击会话行即可读取该会话的上下文和文件。")
      ),
      React.createElement(React.Fragment, null,
      React.createElement("table", { style: table },
        React.createElement("thead", null, React.createElement("tr", null, ...["Session ID", "会话名称", "工作区", "创建时间", "日志"].map((name) => React.createElement("th", { key: name, style: headerCell }, name)))),
        React.createElement("tbody", null, visible.map((session) => React.createElement("tr", {
          key: session.logPath,
          role: session.sessionId ? "button" : undefined,
          tabIndex: session.sessionId && !busy ? 0 : undefined,
          onClick: session.sessionId && !busy ? () => onOpen(session.sessionId) : undefined,
          onContextMenu: session.sessionId ? (event) => { event.preventDefault(); setMenu({ session, x: event.clientX, y: event.clientY }); } : undefined,
          onKeyDown: session.sessionId && !busy ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(session.sessionId); } } : undefined,
          onMouseEnter: session.sessionId && !busy ? () => setHoveredLog(session.logPath) : undefined,
          onMouseLeave: () => setHoveredLog(undefined),
          title: session.sessionId ? "打开此会话并扫描上下文和文件" : undefined,
          style: session.sessionId && !busy ? {
            cursor: "pointer",
            backgroundColor: hoveredLog === session.logPath ? "var(--dsw-alias-background-hover, rgba(0, 0, 0, 0.08))" : "transparent",
            transition: "background-color 120ms ease"
          } : undefined
        },
          React.createElement("td", { style: { ...cell, fontFamily: "monospace", wordBreak: "break-all" } }, session.sessionId ?? "无效日志", session.active && React.createElement("div", { style: { ...badge, background: "#fee4e2", color: "#b42318", fontFamily: "inherit" } }, "运行中")),
          React.createElement("td", { style: cell }, session.pinned && React.createElement("span", { style: badge }, "★ 已收藏"), session.title ?? "未命名会话", session.childSessionCount > 0 && React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #666)", marginTop: 4 } }, `绑定 ${session.childSessionCount} 个子会话`)),
          React.createElement("td", { style: { ...cell, wordBreak: "break-all" } }, session.cwd ?? "—"),
          React.createElement("td", { style: cell }, time(session.createdAt)),
          React.createElement("td", { style: { ...cell, wordBreak: "break-all" } }, session.logPath, React.createElement("div", null, size(session.logSize)))
        )),
        ),
        menu && React.createElement("div", { style: { ...menuStyle, left: menu.x, top: menu.y } },
          React.createElement("div", { style: menuTitle }, "会话操作"),
          React.createElement("div", { style: menuPath, title: menu.session.title ?? menu.session.sessionId }, menu.session.title ?? menu.session.sessionId),
          React.createElement("div", { style: menuDivider }),
          React.createElement(HoverButton, { style: menuButton, onClick: () => { onOpen(menu.session.sessionId); setMenu(undefined); } }, "↗  打开会话"),
          React.createElement(HoverButton, { style: menuButton, onClick: () => { onAssignWorkspace(menu.session); setMenu(undefined); } }, "⌘  归入工作区"),
          React.createElement(HoverButton, { style: menuButton, onClick: () => { onPin(menu.session.sessionId, !menu.session.pinned); setMenu(undefined); } }, menu.session.pinned ? "☆  取消收藏" : "★  收藏会话")
        ))
      )
    );
  }

  function WorkspacePicker({ selection, busy, onChoose, onUnassign, onClose }) {
    return React.createElement("div", { role: "dialog", "aria-modal": true, style: { position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 20, background: "rgba(15,23,42,.34)", backdropFilter: "blur(3px)" }, onMouseDown: onClose },
      React.createElement("div", { style: { ...panel, width: "min(580px, 100%)", maxHeight: "min(600px, calc(100vh - 40px))", overflow: "auto", background: "var(--dsw-alias-background, rgba(255,255,255,.98))", boxShadow: "0 24px 64px rgba(15,23,42,.3)" }, onMouseDown: (event) => event.stopPropagation() },
        React.createElement("div", { style: { display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12, marginBottom: 8 } },
          React.createElement("div", null, React.createElement("strong", { style: { fontSize: 16 } }, "选择归属工作区"), React.createElement("div", { style: { ...menuPath, padding: "5px 0 0" } }, selection.title ?? selection.sessionId)),
          React.createElement(HoverButton, { disabled: busy, onClick: onClose, "aria-label": "关闭" }, "×")
        ),
        React.createElement("p", { style: { margin: "4px 0 13px", color: "var(--dsw-alias-label-secondary, #64748b)", lineHeight: 1.55 } }, "选择一个当前已打开的 DSH 工作区。会话会从其他工作区移出；“保持未分组”会移除所有工作区归属。"),
        selection.workspaces.length === 0
          ? React.createElement("div", { style: { ...panel, color: "var(--dsw-alias-label-secondary, #64748b)" } }, "当前没有可选择的 DSH 工作区。请先在 DSH 中打开一个工作区。")
          : React.createElement("div", { style: { display: "grid", gap: 7 } }, selection.workspaces.map((workspace) => React.createElement(HoverButton, { key: workspace.id, disabled: busy, onClick: () => onChoose(workspace.id), style: { textAlign: "left", padding: "10px 12px" } },
            React.createElement("div", { style: { fontWeight: 650 } }, `📁  ${workspace.title}`),
            React.createElement("div", { style: { marginTop: 3, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, opacity: .72, wordBreak: "break-all" } }, workspace.path)
          ))),
        React.createElement("div", { style: { ...menuDivider, margin: "13px 0 8px" } }),
        React.createElement(HoverButton, { disabled: busy, onClick: onUnassign, style: { color: "var(--dsw-alias-label-secondary, #475569)" } }, "⊘  保持未分组")
      )
    );
  }

  function TrashFileTree({ node, depth = 0 }) {
    const [expanded, setExpanded] = useState(depth < 1);
    const folder = node.kind === "directory";
    return React.createElement("div", { style: { marginLeft: depth * 16, padding: "3px 0", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, wordBreak: "break-all" } },
      React.createElement("span", { onClick: folder ? () => setExpanded((value) => !value) : undefined, style: { cursor: folder ? "pointer" : "default" } }, `${folder ? (expanded ? "📂" : "📁") : node.kind === "truncated" ? "⋯" : "📄"}  ${node.name}${typeof node.size === "number" ? ` (${size(node.size)})` : ""}`),
      folder && expanded && node.children?.map((child) => React.createElement(TrashFileTree, { key: child.path, node: child, depth: depth + 1 })),
      node.truncated && React.createElement("div", { style: { marginLeft: 16, opacity: .65 } }, "… 文件过多，已停止展开")
    );
  }

  function RestartDialog({ sessionTitle, busy, onLater, onRestart }) {
    return React.createElement("div", { role: "dialog", "aria-modal": true, style: { position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 20, background: "rgba(15,23,42,.38)", backdropFilter: "blur(3px)" } },
      React.createElement("div", { style: { ...panel, width: "min(480px, 100%)", background: "var(--dsw-alias-background, rgba(255,255,255,.98))", boxShadow: "0 24px 64px rgba(15,23,42,.3)" } },
        React.createElement("strong", { style: { fontSize: 17 } }, "会话已恢复，需要重启 DSH"),
        React.createElement("p", { style: { lineHeight: 1.65, color: "var(--dsw-alias-label-secondary, #475569)" } }, `“${sessionTitle ?? "此会话"}”的日志已恢复。DSH 需要完整重启后才会重新读取会话索引并显示到工作区侧边栏。`),
        React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 16 } },
          React.createElement(HoverButton, { disabled: busy, onClick: onLater }, "稍后重启"),
          React.createElement(HoverButton, { disabled: busy, onClick: onRestart, style: { color: "#175cd3" } }, "现在重启 DSH")
        )
      )
    );
  }

  function TrashView({ entries, root, busy, onBack, onRefresh, onRestore, onPermanentDelete, onPermanentDeleteMany, onReveal }) {
    const [hovered, setHovered] = useState();
    const [menu, setMenu] = useState();
    const [selected, setSelected] = useState(new Set());
    useEffect(() => { setSelected((old) => new Set([...old].filter((id) => entries.some((entry) => entry.id === id)))); }, [entries]);
    const selectedEntries = entries.filter((entry) => selected.has(entry.id));
    const toggle = (id) => setSelected((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
    const toggleAll = () => setSelected(new Set(selected.size === entries.length ? [] : entries.map((entry) => entry.id)));
    const groups = useMemo(() => {
      const bySession = new Map();
      for (const entry of entries) {
        const id = entry.groupSessionId ?? entry.sessionId ?? "unlinked";
        if (!bySession.has(id)) bySession.set(id, { id, root: undefined, items: [] });
        const group = bySession.get(id);
        if (entry.restoresSession && (entry.sessionId === id || group.root === undefined)) group.root = entry;
        else group.items.push(entry);
      }
      return [...bySession.values()].sort((left, right) => String(right.root?.trashedAt ?? "").localeCompare(String(left.root?.trashedAt ?? "")));
    }, [entries]);
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { ...panel, display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" } },
        React.createElement(HoverButton, { disabled: busy, onClick: onBack }, "← 返回会话列表"),
        React.createElement("strong", { style: { fontSize: 15 } }, "DSH 回收区 · 会话树"),
        React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #64748b)" } }, `${entries.length} 个可恢复项目`),
        React.createElement(HoverButton, { disabled: busy || selectedEntries.length === 0, onClick: () => onPermanentDeleteMany(selectedEntries) }, `⌫ 永久删除选中项 (${selectedEntries.length})`),
        React.createElement(HoverButton, { disabled: busy || entries.length === 0, onClick: toggleAll }, selected.size === entries.length ? "取消全选" : "全选"),
        React.createElement(HoverButton, { disabled: busy, onClick: onRefresh }, "↻ 刷新")
      ),
      React.createElement("div", { style: { ...panel, marginBottom: 14, color: "var(--dsw-alias-label-secondary, #475569)", lineHeight: 1.65 } }, "每个会话是一个根节点，根节点下为该会话移入回收区的文件和文件夹树。恢复会话后需重启 DSH，才能由 DSH 重新读取工作区侧边栏。"),
      entries.length === 0 ? React.createElement("div", { style: { ...panel, textAlign: "center", padding: 28 } }, "回收区当前没有可管理项目。") : groups.map((group) => {
        const rootEntry = group.root;
        const title = rootEntry?.sessionTitle ?? (group.id === "unlinked" ? "未关联会话的项目" : "未命名会话");
        const created = rootEntry?.sessionCreatedAt;
        return React.createElement("section", { key: group.id, style: { ...panel, marginBottom: 12 } },
          React.createElement("div", { style: { display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" } },
            React.createElement("div", null,
              React.createElement("div", { style: { fontWeight: 720, fontSize: 15 } }, `🗂  ${title}`),
              React.createElement("div", { style: { marginTop: 4, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, opacity: .78 } }, `Session ID: ${group.id}`),
              React.createElement("div", { style: { marginTop: 3, color: "var(--dsw-alias-label-secondary, #64748b)" } }, `创建时间：${created === undefined ? "记录缺失" : time(created)}`)
            ),
            rootEntry && React.createElement("div", { style: { display: "flex", gap: 7, flexWrap: "wrap" } },
              rootEntry.restorable && React.createElement(HoverButton, { disabled: busy, onClick: () => onRestore(rootEntry), style: { color: "#067647" } }, "恢复会话"),
              React.createElement(HoverButton, { disabled: busy, onClick: () => onPermanentDelete(rootEntry), style: { color: "#b42318" } }, "永久删除会话")
            )
          ),
          React.createElement("div", { style: { marginTop: 12, borderTop: "1px solid var(--dsw-alias-border-l1, rgba(100,116,139,.2))", paddingTop: 9 } },
            group.items.length === 0 ? React.createElement("div", { style: { opacity: .65 } }, "此会话没有单独记录的产物文件。") : group.items.map((entry) => React.createElement("div", { key: entry.id, style: { display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", gap: 8, alignItems: "start", padding: "7px 3px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(100,116,139,.12))" } },
              React.createElement("input", { type: "checkbox", disabled: busy, checked: selected.has(entry.id), onChange: () => toggle(entry.id), "aria-label": `选择 ${entry.name}` }),
              React.createElement("div", null, React.createElement(TrashFileTree, { node: entry.tree }), React.createElement("div", { style: { marginTop: 4, fontSize: 11, opacity: .65 } }, `移入时间：${time(entry.trashedAt)}`)),
              React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" } },
                entry.restorable && React.createElement(HoverButton, { disabled: busy, onClick: () => onRestore(entry), style: { color: "#067647" } }, "恢复"),
                React.createElement(HoverButton, { disabled: busy, onClick: () => onReveal(entry) }, "打开"),
                React.createElement(HoverButton, { disabled: busy, onClick: () => onPermanentDelete(entry), style: { color: "#b42318" } }, "删除")
              )
            ))
          )
        );
      })
    );
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { ...panel, display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" } },
        React.createElement(HoverButton, { style: button, disabled: busy, onClick: onBack }, "← 返回会话列表"),
        React.createElement("strong", { style: { fontSize: 15 } }, "DSH 回收区"),
        React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #64748b)" } }, `${entries.length} 个可管理项目`),
        React.createElement(HoverButton, { disabled: busy || selectedEntries.length === 0, onClick: () => onPermanentDeleteMany(selectedEntries) }, `⌫ 永久删除选中项 (${selectedEntries.length})`),
        React.createElement(HoverButton, { disabled: busy || entries.length === 0, onClick: toggleAll }, selected.size === entries.length ? "取消全选" : "全选"),
        React.createElement(HoverButton, { disabled: busy, onClick: onRefresh }, "↻ 刷新")
      ),
      React.createElement("div", { style: { ...panel, marginBottom: 14, color: "var(--dsw-alias-label-secondary, #475569)", lineHeight: 1.65 } },
        React.createElement("strong", null, "可恢复删除"), "：恢复会拒绝覆盖原路径已有内容；恢复会话日志时会同步取消 DSH 侧边栏归档。永久删除不可撤销。",
        React.createElement("div", { style: { marginTop: 5, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, wordBreak: "break-all", opacity: .8 } }, root)
      ),
      entries.length === 0
        ? React.createElement("div", { style: { ...panel, textAlign: "center", padding: 28, color: "var(--dsw-alias-label-secondary, #64748b)" } }, "回收区目前没有可管理项目。")
        : React.createElement(React.Fragment, null, React.createElement("table", { style: table },
          React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", { style: headerCell }, "选择"), ...["项目", "来源", "移入时间", "状态 / 操作"].map((name) => React.createElement("th", { key: name, style: headerCell }, name)))),
          React.createElement("tbody", null, entries.map((entry) => React.createElement("tr", {
            key: entry.id,
            onContextMenu: (event) => { event.preventDefault(); setMenu({ entry, x: event.clientX, y: event.clientY }); },
            onMouseEnter: () => setHovered(entry.id), onMouseLeave: () => setHovered(undefined),
            style: { backgroundColor: hovered === entry.id ? hoverColor : "transparent", transition: "background-color 120ms ease" }
          },
            React.createElement("td", { style: cell }, React.createElement("input", { type: "checkbox", disabled: busy, checked: selected.has(entry.id), onClick: (event) => event.stopPropagation(), onChange: () => toggle(entry.id), "aria-label": `选择 ${entry.name}` })),
            React.createElement("td", { style: { ...cell, minWidth: 170 } }, entry.restoresSession ? `💬  ${entry.sessionTitle ?? entry.name}` : `${entry.kind === "directory" ? "📁" : "📄"}  ${entry.name}`, React.createElement("div", { style: badge }, entry.restoresSession ? `会话 ${entry.sessionId?.slice(0, 8) ?? ""}` : entry.kind === "directory" ? "目录" : size(entry.size))),
            React.createElement("td", { style: { ...cell, maxWidth: 360, wordBreak: "break-all", color: "var(--dsw-alias-label-secondary, #475569)" }, title: entry.restoresSession ? "会话原始路径已隐藏；请使用右键菜单复制。" : entry.source }, entry.restoresSession ? "会话原始位置已隐藏（右键可复制）" : entry.source),
            React.createElement("td", { style: cell }, time(entry.trashedAt), entry.restoresSession ? React.createElement("div", { style: { ...badge, color: "#175cd3", background: "#d1e9ff" } }, "恢复时同步侧边栏") : entry.sessionId && React.createElement("div", { style: badge }, `关联会话 ${entry.sessionId.slice(0, 8)}`)),
            React.createElement("td", { style: { ...cell, minWidth: 240 } },
              entry.restorable ? React.createElement(HoverButton, { style: { ...button, color: "#067647" }, disabled: busy, onClick: () => onRestore(entry) }, "↩ 恢复原位置") : React.createElement("span", { style: { ...badge, color: "#b54708", background: "#fef0c7", marginRight: 8 } }, "原位置已存在"),
              React.createElement(HoverButton, { style: { color: "#b42318" }, disabled: busy, onClick: () => onPermanentDelete(entry) }, "⌫ 永久删除")
            )
          ))),
          ),
          menu && React.createElement("div", { style: { ...menuStyle, left: menu.x, top: menu.y } },
            React.createElement("div", { style: menuTitle }, menu.entry.restoresSession ? "已删除会话" : "回收区项目"),
            React.createElement("div", { style: menuPath, title: menu.entry.restoresSession ? (menu.entry.sessionTitle ?? menu.entry.name) : menu.entry.name }, menu.entry.restoresSession ? `💬  ${menu.entry.sessionTitle ?? menu.entry.name}` : `${menu.entry.kind === "directory" ? "📁" : "📄"}  ${menu.entry.name}`),
            React.createElement("div", { style: menuDivider }),
            React.createElement(HoverButton, { style: menuButton, disabled: busy, onClick: () => { onReveal(menu.entry); setMenu(undefined); } }, "▣  打开回收位置"),
            React.createElement(HoverButton, { style: menuButton, onClick: () => { navigator.clipboard?.writeText(menu.entry.source); setMenu(undefined); } }, "⧉  复制原始路径"),
            React.createElement(HoverButton, { style: menuButton, onClick: () => { navigator.clipboard?.writeText(menu.entry.destination); setMenu(undefined); } }, "⧉  复制回收位置"),
            React.createElement("div", { style: menuDivider }),
            menu.entry.restorable && React.createElement(HoverButton, { style: { ...menuButton, color: "#067647" }, disabled: busy, onClick: () => { onRestore(menu.entry); setMenu(undefined); } }, "↩  恢复原位置"),
            React.createElement(HoverButton, { style: { ...menuButton, color: "#b42318" }, disabled: busy, onClick: () => { onPermanentDelete(menu.entry); setMenu(undefined); } }, "⌫  永久删除")
          )
        )
    );
  }

  function SessionDetail({ session, busy, onBack, onStopSession, onDeleteSession, onDeleteFiles, onReveal }) {
    const [selected, setSelected] = useState(new Set());
    const [expanded, setExpanded] = useState(new Set());
    const [menu, setMenu] = useState();
    const [hoveredPath, setHoveredPath] = useState();
    const [hoveredIntegration, setHoveredIntegration] = useState();
    const isBoundaryRoot = (file) => workspacePath(file.path, file.boundaryRoot ?? session.cwd) === ".";
    const listedFiles = session.files.filter((file) => !isBoundaryRoot(file));
    const removable = listedFiles;
    // The workspace boundary itself is intentionally hidden.  Its immediate
    // children remain first-level entries, so E:\\work is never shown while
    // E:\\work\\report.txt and E:\\work\\output are still accessible.
    const visibleFiles = listedFiles.filter((file) => file.parentPath === undefined || workspacePath(file.parentPath, file.boundaryRoot ?? session.cwd) === "." || expanded.has(file.parentPath));
    const toggle = (path) => setSelected((old) => { const next = new Set(old); next.has(path) ? next.delete(path) : next.add(path); return next; });
    const toggleDirectory = (path) => setExpanded((old) => { const next = new Set(old); next.has(path) ? next.delete(path) : next.add(path); return next; });
    const selectAll = () => setSelected(new Set(selected.size === removable.length ? [] : removable.map((file) => file.path)));
    return React.createElement(React.Fragment, null,
      React.createElement("div", { style: { ...panel, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 } }, React.createElement(HoverButton, { style: button, disabled: busy, onClick: onBack }, "返回会话列表"), React.createElement("strong", null, session.title ?? "未命名会话")),
      React.createElement("dl", { style: { ...panel, display: "grid", gridTemplateColumns: "130px 1fr", gap: "7px 12px", margin: "0 0 16px" } },
        React.createElement("dt", null, "Session ID"), React.createElement("dd", { style: { margin: 0, fontFamily: "monospace", wordBreak: "break-all" } }, session.sessionId),
        React.createElement("dt", null, "会话名称"), React.createElement("dd", { style: { margin: 0 } }, session.title ?? "未命名会话"),
        React.createElement("dt", null, "工作区"), React.createElement("dd", { style: { margin: 0, wordBreak: "break-all" } }, session.cwd ?? "—"),
        React.createElement("dt", null, "创建时间"), React.createElement("dd", { style: { margin: 0 } }, time(session.createdAt)),
        React.createElement("dt", null, "绑定子会话"), React.createElement("dd", { style: { margin: 0 } }, `${session.childSessionCount ?? 0} 个`),
        React.createElement("dt", null, "日志"), React.createElement("dd", { style: { margin: 0, wordBreak: "break-all" } }, session.logPath)
      ),
      React.createElement("div", { style: { ...panel, marginBottom: 12 } },
        React.createElement(HoverButton, { style: button, disabled: busy || selected.size === 0, onClick: () => onDeleteFiles([...selected]) }, `处理选中项目 (${selected.size})`),
        React.createElement(HoverButton, { style: button, disabled: busy || removable.length === 0, onClick: selectAll }, selected.size === removable.length ? "取消全选" : `全选可处理项目 (${removable.length})`),
        session.active && React.createElement(HoverButton, { style: { ...button, color: "#b54708" }, disabled: busy, onClick: onStopSession }, "■ 停止会话"),
        React.createElement(HoverButton, { disabled: busy || session.active, onClick: onDeleteSession }, "删除会话")
      ),
      React.createElement("p", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "仅扫描此会话时读取上下文。选择任意列出的现存工作区文件会将其移入回收区；状态为“不存在”的项目只会从本插件列表隐藏，不会改写 DSH 原始会话记录。"),
      React.createElement("h3", { style: { margin: "18px 0 8px", fontSize: 15, letterSpacing: ".01em" } }, "Skill / MCP 使用记录"),
      session.integrations?.length > 0
        ? React.createElement("table", { style: { ...table, marginBottom: 12 } },
          React.createElement("thead", null, React.createElement("tr", null, ...["类型", "名称", "工具/详情", "调用次数"].map((name) => React.createElement("th", { key: name, style: headerCell }, name)))),
          React.createElement("tbody", null, session.integrations.map((item) => {
            const itemKey = `${item.kind}:${item.name}:${item.detail ?? ""}`;
            return React.createElement("tr", {
              key: itemKey,
              onMouseEnter: () => setHoveredIntegration(itemKey),
              onMouseLeave: () => setHoveredIntegration(undefined),
              style: { backgroundColor: hoveredIntegration === itemKey ? hoverColor : "transparent", transition: "background-color 120ms ease" }
            },
            React.createElement("td", { style: cell }, React.createElement("span", { style: badge }, item.kind === "skill" ? "Skill" : "MCP")),
            React.createElement("td", { style: cell }, item.name),
            React.createElement("td", { style: cell }, item.detail ?? "—"),
            React.createElement("td", { style: cell }, item.callCount ?? 1)
            );
          }))
        )
        : React.createElement("p", { style: { color: "var(--dsw-alias-label-secondary, #666)", marginBottom: 12 } }, "暂无可持久化调用记录。Skill / MCP 仅在本插件运行期间从会话事件中记录；历史会话若未留下事件则无法确认。"),
      React.createElement("h3", { style: { margin: "18px 0 8px", fontSize: 15, letterSpacing: ".01em" } }, `会话文件 (${visibleFiles.length}/${listedFiles.length})`),
      React.createElement(React.Fragment, null,
      React.createElement("table", { style: table },
        React.createElement("thead", null, React.createElement("tr", null, ...["选择", "文件", "作用", "来源", "状态/大小"].map((name) => React.createElement("th", { key: name, style: headerCell }, name)))),
        React.createElement("tbody", null, visibleFiles.map((file) => React.createElement("tr", { key: file.path, onContextMenu: (event) => { event.preventDefault(); setMenu({ file, x: event.clientX, y: event.clientY }); }, onMouseEnter: () => setHoveredPath(file.path), onMouseLeave: () => setHoveredPath(undefined), style: { backgroundColor: hoveredPath === file.path ? hoverColor : "transparent", transition: "background-color 120ms ease" } },
          React.createElement("td", { style: cell }, React.createElement("input", { type: "checkbox", disabled: busy || workspacePath(file.path, session.cwd) === ".", checked: selected.has(file.path), onChange: () => toggle(file.path), title: !file.exists ? "选择后仅从本插件列表移除" : file.kind === "directory" ? "选择后整棵目录移入 DSH 回收区" : "选择后移入 DSH 回收区", "aria-label": `选择 ${file.path}` })),
          React.createElement("td", { style: { ...cell, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12, wordBreak: "break-all", minWidth: 270, paddingLeft: 12 + Math.min(file.treeDepth ?? 0, 8) * 18, cursor: file.kind === "directory" ? "pointer" : "default" }, onClick: file.kind === "directory" ? () => toggleDirectory(file.path) : undefined, title: file.kind === "directory" ? "点击展开或收起目录" : undefined }, `${(file.treeDepth ?? 0) > 0 ? "└─ " : ""}${file.kind === "directory" ? (expanded.has(file.path) ? "📂 " : "📁 ") : "📄 "}${itemName(file.path)}`),
          React.createElement("td", { style: { ...cell, minWidth: 150, color: "var(--dsw-alias-label-secondary, #475569)" } }, purposeOf(file, session.files)),
          React.createElement("td", { style: { ...cell, whiteSpace: "nowrap" } }, React.createElement("span", { style: badge }, file.source === "session-context" ? "实时上下文写入" : file.source === "dsh-upload" ? "DSH 上传" : file.source === "session-projection-created" ? "会话上下文创建" : file.source === "session-projection" ? "会话上下文引用" : "工作区引用")),
          React.createElement("td", { style: { ...cell, whiteSpace: "nowrap" } }, file.exists ? React.createElement(React.Fragment, null, `${file.kind === "directory" ? "目录" : "文件"}${file.kind === "file" ? ` / ${size(file.size)}` : ""}`, React.createElement("div", { style: { ...badge, color: "#067647", background: "#d1fadf" } }, file.kind === "directory" ? "整棵目录可移入回收区" : "可移入回收区")) : React.createElement("span", { style: { ...badge, color: "#b54708", background: "#fef0c7" } }, "不存在：仅移除条目"))
        )),
        ),
        menu && React.createElement("div", { style: { ...menuStyle, left: menu.x, top: menu.y } },
          React.createElement("div", { style: menuTitle }, menu.file.kind === "directory" ? "目录操作" : "文件操作"),
          React.createElement("div", { style: menuPath, title: menu.file.path }, `${menu.file.kind === "directory" ? "📁" : "📄"}  ${itemName(menu.file.path)}`),
          React.createElement("div", { style: menuDivider }),
          React.createElement(HoverButton, { style: menuButton, disabled: !menu.file.exists, onClick: () => { onReveal(menu.file.path); setMenu(undefined); } }, "▣  在资源管理器中打开"),
          React.createElement(HoverButton, { style: menuButton, onClick: () => { navigator.clipboard?.writeText(menu.file.path); setMenu(undefined); } }, "⧉  复制完整路径"),
          React.createElement("div", { style: menuDivider }),
          React.createElement(HoverButton, { style: { ...menuButton, color: "#b42318" }, onClick: () => { onDeleteFiles([menu.file.path]); setMenu(undefined); } }, "⌫  移入 DSH 回收区")
        ))
      )
    );
  }

  function SessionManageSettingsPage() {
    const [sessions, setSessions] = useState([]); const [detail, setDetail] = useState();
    const [trash, setTrash] = useState(); const [workspacePicker, setWorkspacePicker] = useState(); const [restartPrompt, setRestartPrompt] = useState();
    const [favoritesMode, setFavoritesMode] = useState(false);
    const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
    const loadList = useCallback(async () => {
      setBusy(true); setMessage("");
      try { setSessions((await request("/sessions")).sessions); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }, []);
    useEffect(() => { void loadList(); }, [loadList]);
    const open = async (sessionId) => {
      setBusy(true); setMessage("");
      try { setDetail((await request(`/session?sessionId=${encodeURIComponent(sessionId)}`)).session); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    };
    const deleteSession = async () => {
      if (detail === undefined || !window.confirm(`将主会话 ${detail.sessionId}${detail.childSessionCount > 0 ? ` 及其 ${detail.childSessionCount} 个绑定子会话` : ""}的日志，以及扫描到的全部现存普通文件移入 DSH 回收区。即使这是工作区最后一个会话也会删除。继续？`)) return;
      setBusy(true); setMessage("");
      try { await request("/sessions/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: detail.sessionId, confirm: `DELETE SESSION ${detail.sessionId}` }) }); setDetail(undefined); await loadList(); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const stopSession = async () => {
      if (detail === undefined || !window.confirm(`停止主会话 ${detail.sessionId}${detail.childSessionCount > 0 ? ` 及其 ${detail.childSessionCount} 个绑定子会话` : ""}？\n\n停止完成后可刷新并删除会话；停止不会删除日志或工作区文件。`)) return;
      setBusy(true); setMessage("");
      try { await request("/sessions/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: detail.sessionId, confirm: `STOP SESSION ${detail.sessionId}` }) }); await open(detail.sessionId); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const deleteFiles = async (paths) => {
      if (detail === undefined) return;
      const missing = paths.filter((path) => detail.files.find((file) => file.path === path)?.exists === false).length;
      const existing = paths.length - missing;
      if (!window.confirm(`${existing > 0 ? `${existing} 个存在文件将移入 DSH 回收区。` : ""}${missing > 0 ? `${missing} 个不存在项目将仅从本插件列表移除。` : ""}继续？`)) return;
      setBusy(true); setMessage("");
      try { await request("/files/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: detail.sessionId, paths, confirm: `DELETE FILES ${detail.sessionId}` }) }); await open(detail.sessionId); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const reveal = async (path) => { setBusy(true); setMessage(""); try { await request("/files/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: detail.sessionId, path }) }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
    const pin = async (sessionId, pinned) => { setBusy(true); try { await request("/sessions/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, pinned }) }); await loadList(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
    const assignWorkspace = async (session) => {
      setBusy(true); setMessage("");
      try {
        const result = await request("/workspaces");
        setWorkspacePicker({ sessionId: session.sessionId, title: session.title, workspaces: result.workspaces });
      }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    };
    const chooseWorkspace = async (workspaceId) => {
      if (workspacePicker === undefined) return;
      setBusy(true); setMessage("");
      try {
        const result = await request("/sessions/assign-workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: workspacePicker.sessionId, workspaceId }) });
        setMessage(`已将会话归入“${result.workspace?.title ?? "所选工作区"}”。`);
        setWorkspacePicker(undefined);
        await loadList();
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const unassignWorkspace = async () => {
      if (workspacePicker === undefined) return;
      setBusy(true); setMessage("");
      try { await request("/sessions/unassign-workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: workspacePicker.sessionId }) }); setWorkspacePicker(undefined); setMessage("会话已保持在未分组。"); await loadList(); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const loadTrash = async () => {
      setBusy(true); setMessage("");
      try { setTrash(await request("/trash")); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    };
    const restoreTrash = async (entry) => {
      if (!window.confirm(`恢复“${entry.restoresSession ? (entry.sessionTitle ?? entry.name) : entry.name}”到原位置？\n${entry.source}`)) return;
      setBusy(true); setMessage("");
      try { const result = await request("/trash/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id, confirm: `RESTORE ${entry.id}` }) }); if (result.restartRequired) setRestartPrompt({ sessionTitle: entry.sessionTitle ?? entry.name }); await loadTrash(); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const restartNow = async () => {
      setBusy(true); setMessage("");
      try { await request("/desktop/restart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const permanentlyDeleteTrash = async (entry) => {
      if (!window.confirm(`永久删除“${entry.name}”？\n\n此操作不可恢复，且会递归删除目录中的所有内容。`)) return;
      if (!window.confirm("请再次确认：该项目将从 DSH 回收区永久移除。")) return;
      setBusy(true); setMessage("");
      try { await request("/trash/permanently-delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id, confirm: `PURGE ${entry.id}` }) }); await loadTrash(); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const permanentlyDeleteTrashMany = async (entries) => {
      if (entries.length === 0) return;
      if (!window.confirm(`永久删除选中的 ${entries.length} 个回收区项目？\n\n其中目录会递归删除，操作不可恢复。`)) return;
      if (!window.confirm("请再次确认：所有选中项目将从 DSH 回收区永久移除。")) return;
      setBusy(true); setMessage("");
      try { await request("/trash/permanently-delete-batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: entries.map((entry) => entry.id), confirm: `PURGE ${entries.length} ITEMS` }) }); await loadTrash(); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
    };
    const revealTrashEntry = async (entry) => {
      setBusy(true); setMessage("");
      try { await request("/trash/reveal-entry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id }) }); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    };
    return React.createElement("section", { style: { padding: 18, overflow: "auto", height: "100%", fontSize: 13, background: "radial-gradient(circle at top right, rgba(99,102,241,.08), transparent 32%), var(--dsw-alias-background, transparent)" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } }, React.createElement("strong", { style: { fontSize: 17, letterSpacing: ".01em" } }, trash !== undefined ? "DSH 回收区" : favoritesMode ? "收藏会话" : "会话管理"), !detail && trash === undefined && React.createElement(HoverButton, { disabled: busy, onClick: () => void loadList() }, "↻  刷新")),
      message && React.createElement("p", { role: "alert", style: { margin: "0 0 12px", padding: "9px 11px", borderRadius: 10, border: "1px solid #fecdca", background: "#fef3f2", color: "#b42318" } }, message),
      workspacePicker && React.createElement(WorkspacePicker, { selection: workspacePicker, busy, onChoose: (id) => void chooseWorkspace(id), onUnassign: () => void unassignWorkspace(), onClose: () => setWorkspacePicker(undefined) }),
      restartPrompt && React.createElement(RestartDialog, { sessionTitle: restartPrompt.sessionTitle, busy, onLater: () => setRestartPrompt(undefined), onRestart: () => void restartNow() }),
      trash !== undefined
        ? React.createElement(TrashView, { entries: trash.entries, root: trash.root, busy, onBack: () => setTrash(undefined), onRefresh: () => void loadTrash(), onRestore: (entry) => void restoreTrash(entry), onPermanentDelete: (entry) => void permanentlyDeleteTrash(entry), onPermanentDeleteMany: (entries) => void permanentlyDeleteTrashMany(entries), onReveal: (entry) => void revealTrashEntry(entry) })
        : detail === undefined
          ? React.createElement(SessionList, { sessions: favoritesMode ? sessions.filter((session) => session.pinned) : sessions, busy, favoritesMode, onBack: () => setFavoritesMode(false), onFavorites: () => setFavoritesMode(true), onOpen: (id) => { setFavoritesMode(false); void open(id); }, onPin: (id, pinned) => void pin(id, pinned), onAssignWorkspace: (session) => void assignWorkspace(session), onTrash: () => void loadTrash() })
          : React.createElement(SessionDetail, { session: detail, busy, onBack: () => setDetail(undefined), onStopSession: () => void stopSession(), onDeleteSession: () => void deleteSession(), onDeleteFiles: (paths) => void deleteFiles(paths), onReveal: (path) => void reveal(path) })
    );
  }

  const inject = ["slots", "locale"];
  function apply(ctx) {
    // `settings.section` owns the first-level navigation entries in the
    // Settings dialog's left rail (the same seat used by Pentester in this
    // Desktop profile). Do not register a plugins.bundle.config page as well:
    // that would create a duplicate, nested entry under Plugins.
    ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: "dsh-session-manage",
      order: 95,
      label: () => "会话管理"
    }, SessionManageSettingsPage));
  }
  exports.inject = inject; exports.apply = apply; return module.exports;
}});
