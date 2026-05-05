import { useEffect, useState, FormEvent } from "react";

interface AppMetadata {
  slug: string;
  name: string;
  description: string | null;
  prompt: string | null;
  generatedAt: string;
  generatedBy: string | null;
  model: string | null;
  isHome: boolean;
}

interface KeyStatus {
  configured: boolean;
  suffix: string | null;
}

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function AppBuilderView() {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  // Per-tool tester state: which tool's tester is open, current inputs,
  // pending request flag, last response text.
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolRunning, setToolRunning] = useState(false);
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Edit-an-existing-app state. `editingSlug` is the slug of the app
  // whose inline editor is currently open; null means no editor open.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  async function refresh() {
    try {
      const [appsResp, keyResp, toolsResp] = await Promise.all([
        fetch("/api/apps"),
        fetch("/api/admin/anthropic-key"),
        fetch("/api/mcp/tools"),
      ]);
      if (appsResp.ok) {
        const data = await appsResp.json();
        setApps(Array.isArray(data.apps) ? data.apps : []);
        setLoadError(null);
      } else if (appsResp.status === 503) {
        setLoadError("Database not configured — apps API is offline.");
      } else {
        setLoadError(`Failed to load apps (HTTP ${appsResp.status}).`);
      }
      if (keyResp.ok) {
        setKeyStatus(await keyResp.json());
      }
      if (toolsResp.ok) {
        const data = await toolsResp.json();
        setTools(Array.isArray(data.tools) ? data.tools : []);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Auto-derive slug from name until the user edits it manually.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  function resetForm() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setPrompt("");
    setGenError(null);
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (generating) return;
    if (!name.trim() || !prompt.trim()) {
      setGenError("Name and prompt are required.");
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setGenError(
        "Slug must be lowercase letters, digits, '-' or '_' (start with a letter/digit), max 64 chars.",
      );
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const resp = await fetch("/api/apps/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setGenError(data.error ?? `Generation failed (HTTP ${resp.status}).`);
        return;
      }
      // The API returns the created app metadata (plus URL).
      resetForm();
      setShowForm(false);
      await refresh();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(slug: string) {
    if (!confirm(`Delete app "${slug}"? This removes its files and data.`)) return;
    const resp = await fetch(`/api/apps/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    if (resp.ok) {
      await refresh();
    } else {
      const data = await resp.json().catch(() => ({}));
      alert(data.error ?? `Delete failed (HTTP ${resp.status}).`);
    }
  }

  function openToolTester(tool: ToolInfo) {
    if (openTool === tool.name) {
      setOpenTool(null);
      return;
    }
    setOpenTool(tool.name);
    setToolResult(null);
    setToolError(null);
    // Pre-populate the form with empty strings for each known property.
    const initial: Record<string, string> = {};
    for (const k of Object.keys(tool.inputSchema.properties ?? {})) initial[k] = "";
    setToolArgs(initial);
  }

  // Convert a user-typed string back to the right JSON Schema type.
  // Skips empty strings unless the param is required (so "no value" =>
  // undefined, letting the tool's defaults / optionals kick in).
  function coerceArg(
    raw: string,
    propSchema: { type?: string; enum?: unknown[] } | undefined,
    required: boolean,
  ): unknown | undefined {
    if (raw === "" && !required) return undefined;
    const t = propSchema?.type;
    if (t === "number" || t === "integer") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (t === "boolean") return raw === "true" || raw === "1" || raw === "on";
    if (t === "array") {
      // Accept either JSON array literal or comma-separated.
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          /* fall through */
        }
      }
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (t === "object") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  async function runTool(tool: ToolInfo) {
    setToolRunning(true);
    setToolResult(null);
    setToolError(null);
    try {
      const props = tool.inputSchema.properties ?? {};
      const required = new Set(tool.inputSchema.required ?? []);
      const argsObj: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(props)) {
        const v = coerceArg(toolArgs[name] ?? "", schema, required.has(name));
        if (v !== undefined) argsObj[name] = v;
      }
      const r = await fetch("/api/mcp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tool.name, arguments: argsObj }),
      });
      const data = (await r.json()) as { content?: Array<{ text?: string }>; isError?: boolean; error?: string };
      if (!r.ok) {
        setToolError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      const text = data.content?.map((c) => c.text ?? "").join("\n") ?? "(no content)";
      // Pretty-print JSON-looking results.
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON, leave as-is */
      }
      if (data.isError) {
        setToolError(text);
      } else {
        setToolResult(pretty);
      }
    } catch (err) {
      setToolError(err instanceof Error ? err.message : String(err));
    } finally {
      setToolRunning(false);
    }
  }

  function openEditor(slug: string) {
    if (editingSlug === slug) {
      setEditingSlug(null);
      setEditInstruction("");
      setEditError(null);
      setEditSuccess(null);
      return;
    }
    setEditingSlug(slug);
    setEditInstruction("");
    setEditError(null);
    setEditSuccess(null);
  }

  async function handleEdit(e: FormEvent, slug: string) {
    e.preventDefault();
    if (editing) return;
    if (!editInstruction.trim()) {
      setEditError("Describe what you'd like changed.");
      return;
    }
    setEditing(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      const resp = await fetch(`/api/apps/${encodeURIComponent(slug)}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: editInstruction.trim() }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
        changedFiles?: { path: string }[];
      };
      if (!resp.ok) {
        setEditError(data.error ?? `Edit failed (HTTP ${resp.status}).`);
        return;
      }
      const list = data.changedFiles?.map((f) => f.path).join(", ") ?? "";
      setEditSuccess(
        list ? `Updated ${list}.` : "Updated.",
      );
      setEditInstruction("");
      await refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  }

  async function handleToggleHome(slug: string, currentlyHome: boolean) {
    const resp = await fetch(`/api/apps/${encodeURIComponent(slug)}/home`, {
      method: currentlyHome ? "DELETE" : "POST",
    });
    if (resp.ok) {
      await refresh();
    } else {
      const data = await resp.json().catch(() => ({}));
      alert(data.error ?? `Update failed (HTTP ${resp.status}).`);
    }
  }

  const hasKey = keyStatus?.configured === true;

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>App Builder</h1>
          <p style={{ color: "var(--text-dim)", marginTop: 4 }}>
            Describe an app in plain English. Claude writes a static page that
            can call Rainbow's MCP tools and persist data per app.
          </p>
        </div>
        <button
          style={hasKey ? styles.createBtn : styles.createBtnDisabled}
          onClick={() => setShowForm((s) => !s)}
          disabled={!hasKey}
          title={hasKey ? "" : "Set an Anthropic API key in Settings first"}
        >
          {showForm ? "Cancel" : "Build New App"}
        </button>
      </div>

      {!hasKey && (
        <div style={styles.warning}>
          No Anthropic API key configured. Add one in{" "}
          <a href="/settings" style={styles.warningLink}>
            Settings
          </a>{" "}
          to enable app generation.
        </div>
      )}

      {loadError && <div style={styles.error}>{loadError}</div>}

      {tools.length > 0 && (
        <div style={styles.toolsPanel}>
          <button
            type="button"
            style={styles.toolsToggle}
            onClick={() => setToolsExpanded((v) => !v)}
          >
            <span>
              {tools.length} MCP {tools.length === 1 ? "tool" : "tools"} available
              {" "}
              <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
                — what Claude can use in apps you build
              </span>
            </span>
            <span style={styles.toolsToggleChevron}>
              {toolsExpanded ? "▾" : "▸"}
            </span>
          </button>
          {toolsExpanded && (
            <ul style={styles.toolsList}>
              {tools.map((t) => {
                const propEntries = Object.entries(t.inputSchema.properties ?? {});
                const required = new Set(t.inputSchema.required ?? []);
                const isOpen = openTool === t.name;
                return (
                  <li key={t.name} style={styles.toolItem}>
                    <div style={styles.toolItemHeader}>
                      <div>
                        <code style={styles.toolName}>{t.name}</code>
                        {t.description && (
                          <span style={styles.toolDesc}> — {t.description}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openToolTester(t)}
                        style={isOpen ? styles.tryBtnActive : styles.tryBtn}
                      >
                        {isOpen ? "Close" : "Try"}
                      </button>
                    </div>
                    {propEntries.length > 0 && !isOpen && (
                      <ul style={styles.paramList}>
                        {propEntries.map(([pname, pschema]) => (
                          <li key={pname} style={styles.paramItem}>
                            <code>{pname}</code>
                            <span style={styles.paramType}>
                              {": "}{String(pschema.type ?? "any")}
                              {required.has(pname) ? "" : " (optional)"}
                            </span>
                            {pschema.description && (
                              <span style={styles.paramDesc}> — {pschema.description}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {isOpen && (
                      <div style={styles.testerBox}>
                        {propEntries.length === 0 ? (
                          <p style={styles.subtle}>No arguments. Click Run.</p>
                        ) : (
                          propEntries.map(([pname, pschema]) => {
                            const isRequired = required.has(pname);
                            const t_ = pschema.type ?? "any";
                            const placeholder =
                              t_ === "array"
                                ? "comma-separated, or [JSON, array]"
                                : t_ === "boolean"
                                  ? "true | false"
                                  : t_ === "object"
                                    ? '{ "json": "object" }'
                                    : `${t_}${isRequired ? "" : " (optional)"}`;
                            return (
                              <div key={pname} style={styles.testerField}>
                                <label style={styles.testerLabel}>
                                  <code>{pname}</code>
                                  <span style={styles.paramType}>
                                    {" "}{String(t_)}{isRequired ? " *" : ""}
                                  </span>
                                  {pschema.description && (
                                    <span style={styles.paramDesc}> — {pschema.description}</span>
                                  )}
                                </label>
                                {t_ === "boolean" ? (
                                  <select
                                    style={styles.testerInput}
                                    value={toolArgs[pname] ?? ""}
                                    onChange={(e) =>
                                      setToolArgs((prev) => ({ ...prev, [pname]: e.target.value }))
                                    }
                                  >
                                    <option value="">{isRequired ? "—" : "(omit)"}</option>
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                  </select>
                                ) : Array.isArray(pschema.enum) ? (
                                  <select
                                    style={styles.testerInput}
                                    value={toolArgs[pname] ?? ""}
                                    onChange={(e) =>
                                      setToolArgs((prev) => ({ ...prev, [pname]: e.target.value }))
                                    }
                                  >
                                    <option value="">{isRequired ? "—" : "(omit)"}</option>
                                    {pschema.enum.map((v) => (
                                      <option key={String(v)} value={String(v)}>
                                        {String(v)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={t_ === "number" || t_ === "integer" ? "number" : "text"}
                                    style={styles.testerInput}
                                    placeholder={placeholder}
                                    value={toolArgs[pname] ?? ""}
                                    onChange={(e) =>
                                      setToolArgs((prev) => ({ ...prev, [pname]: e.target.value }))
                                    }
                                  />
                                )}
                              </div>
                            );
                          })
                        )}
                        <div style={styles.testerActions}>
                          <button
                            type="button"
                            onClick={() => runTool(t)}
                            disabled={toolRunning}
                            style={toolRunning ? styles.runBtnDisabled : styles.runBtn}
                          >
                            {toolRunning ? "Running…" : "Run"}
                          </button>
                        </div>
                        {toolError && (
                          <pre style={styles.testerError}>{toolError}</pre>
                        )}
                        {toolResult !== null && (
                          <pre style={styles.testerResult}>{toolResult}</pre>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {showForm && hasKey && (
        <form onSubmit={handleGenerate} style={styles.form}>
          <div style={styles.formRow}>
            <label style={styles.label} htmlFor="app-name">
              Name
            </label>
            <input
              id="app-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Family Recipe Book"
              style={styles.input}
              required
              maxLength={120}
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.label} htmlFor="app-slug">
              Slug{" "}
              <span style={styles.labelHint}>(URL: /apps/{slug || "…"}/)</span>
            </label>
            <input
              id="app-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="recipes"
              style={styles.input}
              required
              maxLength={64}
              pattern="[a-z0-9][a-z0-9_-]{0,63}"
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.label} htmlFor="app-description">
              Short description{" "}
              <span style={styles.labelHint}>(optional)</span>
            </label>
            <input
              id="app-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary shown on the gallery card."
              style={styles.input}
              maxLength={240}
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.label} htmlFor="app-prompt">
              What should the app do?
            </label>
            <textarea
              id="app-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Build a page where my family can add and search recipes. Each recipe needs a title, ingredients, steps, and a photo. Save them so they persist."
              style={styles.textarea}
              required
              rows={6}
            />
          </div>
          {genError && <div style={styles.error}>{genError}</div>}
          <div style={styles.formActions}>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              disabled={generating}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={generating ? styles.createBtnDisabled : styles.createBtn}
              disabled={generating}
            >
              {generating ? "Generating (10–60s)…" : "Generate"}
            </button>
          </div>
        </form>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 16px" }}>
        Your Apps
      </h2>

      {apps.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={{ fontSize: 16, color: "var(--text-dim)" }}>No apps yet.</p>
          <p style={{ fontSize: 14, color: "var(--text-dim)", marginTop: 8 }}>
            {hasKey
              ? 'Click "Build New App" to create your first one.'
              : "Set your Anthropic API key in Settings to start building."}
          </p>
          <div style={styles.examples}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Example prompts:
            </p>
            <ul style={{ fontSize: 13, color: "var(--text-dim)", paddingLeft: 20 }}>
              <li>A photo grid that pulls recent shots from Immich.</li>
              <li>A family recipe book everyone can edit.</li>
              <li>A status page showing which Rainbow services are healthy.</li>
              <li>A simple link-in-bio page with my social accounts.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div style={styles.appGrid}>
          {apps.map((app) => (
            <div key={app.slug} style={styles.appCard}>
              <div style={styles.appCardHeader}>
                <span style={{ fontWeight: 600 }}>
                  {app.name}
                  {app.isHome && (
                    <span style={styles.homeBadge} title="Served at the root of your domain">
                      home
                    </span>
                  )}
                </span>
                <code style={styles.slugTag}>{app.slug}</code>
              </div>
              {app.description && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-dim)",
                    marginTop: 8,
                  }}
                >
                  {app.description}
                </p>
              )}
              <div style={styles.appCardFooter}>
                <a
                  href={`/apps/${encodeURIComponent(app.slug)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.appLink}
                >
                  Open
                </a>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {new Date(app.generatedAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleHome(app.slug, app.isHome)}
                  style={app.isHome ? styles.homeBtnActive : styles.homeBtn}
                  title={app.isHome ? "Stop serving this at the root of your domain" : "Serve this at the root of your domain"}
                >
                  {app.isHome ? "Unset home" : "Set as home"}
                </button>
                <button
                  type="button"
                  onClick={() => openEditor(app.slug)}
                  style={editingSlug === app.slug ? styles.editBtnActive : styles.editBtn}
                  title="Describe a change to apply to this app"
                  disabled={!hasKey}
                >
                  {editingSlug === app.slug ? "Close edit" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(app.slug)}
                  style={styles.deleteBtn}
                  title="Delete app"
                >
                  Delete
                </button>
              </div>
              {editingSlug === app.slug && (
                <form onSubmit={(e) => handleEdit(e, app.slug)} style={styles.editForm}>
                  {app.prompt && (
                    <div style={styles.editContext}>
                      <div style={styles.editContextLabel}>Original brief</div>
                      <div style={styles.editContextBody}>{app.prompt}</div>
                    </div>
                  )}
                  <label style={styles.editLabel} htmlFor={`edit-${app.slug}`}>
                    Describe what to change
                  </label>
                  <textarea
                    id={`edit-${app.slug}`}
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    rows={4}
                    placeholder="The page won't scroll on long content — fix the overflow so the body scrolls vertically."
                    style={styles.editTextarea}
                    disabled={editing}
                    autoFocus
                  />
                  {editError && <div style={styles.editError}>{editError}</div>}
                  {editSuccess && <div style={styles.editSuccess}>{editSuccess}</div>}
                  <div style={styles.editFormRow}>
                    <button
                      type="button"
                      onClick={() => openEditor(app.slug)}
                      style={styles.secondaryBtn}
                      disabled={editing}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      style={editing ? styles.createBtnDisabled : styles.createBtn}
                      disabled={editing || !editInstruction.trim()}
                    >
                      {editing ? "Applying…" : "Apply change"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    gap: 16,
  },
  createBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  createBtnDisabled: {
    background: "var(--surface)",
    color: "var(--text-dim)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "not-allowed",
    flexShrink: 0,
  },
  secondaryBtn: {
    background: "transparent",
    color: "var(--text-dim)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    cursor: "pointer",
  },
  warning: {
    background: "rgba(234,179,8,0.08)",
    border: "1px solid rgba(234,179,8,0.25)",
    borderRadius: "var(--radius)",
    padding: "12px 16px",
    fontSize: 14,
    marginBottom: 16,
  },
  warningLink: {
    color: "var(--accent)",
    textDecoration: "none",
  },
  error: {
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: "var(--radius)",
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--text)",
    marginBottom: 12,
  },
  form: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 20,
    marginBottom: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text)",
  },
  labelHint: {
    fontSize: 12,
    color: "var(--text-dim)",
    fontWeight: 400,
  },
  input: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
  },
  textarea: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical",
  },
  formActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  emptyState: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 32,
    textAlign: "center",
  },
  examples: {
    marginTop: 24,
    padding: 16,
    background: "var(--bg)",
    borderRadius: "var(--radius)",
    textAlign: "left",
  },
  appGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 12,
  },
  appCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 16,
  },
  appCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  slugTag: {
    fontSize: 11,
    color: "var(--text-dim)",
    background: "var(--bg)",
    padding: "2px 6px",
    borderRadius: 4,
  },
  appCardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  },
  appLink: {
    color: "var(--accent)",
    fontSize: 13,
    textDecoration: "none",
    fontWeight: 500,
  },
  deleteBtn: {
    background: "transparent",
    color: "var(--text-dim)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  homeBtn: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  homeBtnActive: {
    background: "var(--text)",
    color: "var(--surface)",
    border: "1px solid var(--text)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  editBtn: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  editBtnActive: {
    background: "var(--surface-hover)",
    color: "var(--text)",
    border: "1px solid var(--text)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  editForm: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  editContext: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    padding: "10px 12px",
    fontSize: 13,
  },
  editContextLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--text-dim)",
    marginBottom: 6,
  },
  editContextBody: {
    color: "var(--text-dim)",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.5,
  },
  editLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.06em",
    color: "var(--text)",
  },
  editTextarea: {
    fontFamily: "var(--font-body)",
    fontSize: 14,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    resize: "vertical" as const,
    minHeight: 90,
  },
  editError: {
    color: "var(--red, #a64242)",
    fontSize: 13,
  },
  editSuccess: {
    color: "var(--green, #4f7a4d)",
    fontSize: 13,
  },
  editFormRow: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },
  homeBadge: {
    marginLeft: 8,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: "var(--text)",
    color: "var(--surface)",
    padding: "2px 6px",
    borderRadius: 2,
  },
  toolsPanel: {
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 0,
    marginBottom: 16,
    background: "var(--surface)",
  },
  toolsToggle: {
    width: "100%",
    background: "transparent",
    border: "none",
    padding: "0.85rem 1rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
    color: "var(--text)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 600,
    textAlign: "left",
  },
  toolsToggleChevron: {
    color: "var(--text-dim)",
    fontSize: 12,
  },
  toolsList: {
    listStyle: "none",
    padding: "0 1rem 1rem",
    margin: 0,
    borderTop: "1px solid var(--border)",
  },
  toolItem: {
    padding: "0.75rem 0",
    borderBottom: "1px solid var(--border, #00000010)",
    fontSize: 13,
  },
  toolName: {
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: 13,
    color: "var(--text)",
    fontWeight: 600,
  },
  toolDesc: {
    color: "var(--text-dim)",
  },
  paramList: {
    listStyle: "none",
    padding: 0,
    margin: "0.4rem 0 0 1rem",
  },
  paramItem: {
    fontSize: 12,
    color: "var(--text-dim)",
    margin: "0.15rem 0",
  },
  paramType: {
    color: "var(--text-dim)",
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
  },
  paramDesc: {
    color: "var(--text-dim)",
  },
  toolItemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "0.75rem",
  },
  tryBtn: {
    fontSize: 11,
    padding: "3px 10px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    borderRadius: 3,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
  tryBtnActive: {
    fontSize: 11,
    padding: "3px 10px",
    border: "1px solid var(--text)",
    background: "var(--text)",
    color: "var(--surface)",
    borderRadius: 3,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
  testerBox: {
    marginTop: "0.6rem",
    padding: "0.75rem",
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface-hover, #00000008)",
  },
  testerField: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    marginBottom: "0.6rem",
  },
  testerLabel: {
    fontSize: 12,
  },
  testerInput: {
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: 12,
    padding: "0.4rem 0.55rem",
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface)",
    color: "var(--text)",
  },
  testerActions: {
    marginTop: "0.4rem",
  },
  runBtn: {
    fontSize: 12,
    padding: "0.4rem 1rem",
    border: "1px solid var(--text)",
    background: "var(--text)",
    color: "var(--surface)",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 600,
  },
  runBtnDisabled: {
    fontSize: 12,
    padding: "0.4rem 1rem",
    border: "1px solid var(--border)",
    background: "var(--border)",
    color: "var(--text-dim)",
    borderRadius: 3,
    cursor: "not-allowed",
    fontFamily: "inherit",
  },
  testerError: {
    marginTop: "0.6rem",
    padding: "0.5rem 0.75rem",
    background: "var(--error-bg, #b0002012)",
    border: "1px solid var(--error, #b00020)",
    borderRadius: 3,
    color: "var(--error, #b00020)",
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  testerResult: {
    marginTop: "0.6rem",
    padding: "0.5rem 0.75rem",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: 11,
    overflowX: "auto",
    whiteSpace: "pre",
    maxHeight: 320,
    overflowY: "auto",
  },
  subtle: {
    color: "var(--text-dim)",
    fontSize: 12,
    margin: 0,
  },
};
