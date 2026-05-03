import { useEffect, useState, FormEvent } from "react";

interface AppMetadata {
  slug: string;
  name: string;
  description: string | null;
  prompt: string | null;
  generatedAt: string;
  generatedBy: string | null;
  model: string | null;
}

interface KeyStatus {
  configured: boolean;
  suffix: string | null;
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

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [appsResp, keyResp] = await Promise.all([
        fetch("/api/apps"),
        fetch("/api/admin/anthropic-key"),
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
                <span style={{ fontWeight: 600 }}>{app.name}</span>
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
                  onClick={() => handleDelete(app.slug)}
                  style={styles.deleteBtn}
                  title="Delete app"
                >
                  Delete
                </button>
              </div>
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
};
