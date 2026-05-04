import { useEffect, useRef, useState } from "react";
import { StepProps } from "./types";

interface PhaseEvent {
  type:
    | "phase-start"
    | "phase-log"
    | "phase-done"
    | "phase-error"
    | "complete"
    | "fatal";
  phase?: string;
  description?: string;
  line?: string;
  stream?: "stdout" | "stderr";
  message?: string;
  domain?: string;
  dashboardUrl?: string;
}

interface PhaseRecord {
  phase: string;
  description: string;
  status: "pending" | "running" | "done" | "error";
  log: { line: string; stream?: string }[];
}

const DRY_RUN = false;

export function ProvisionStep({ state, onContinue, onBack }: StepProps) {
  const [phases, setPhases] = useState<PhaseRecord[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ domain: string; url: string } | null>(
    null,
  );
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [phases]);

  function applyEvent(ev: PhaseEvent) {
    setPhases((prev) => {
      const next = prev.slice();
      const idx = ev.phase ? next.findIndex((p) => p.phase === ev.phase) : -1;
      if (ev.type === "phase-start" && ev.phase) {
        if (idx < 0) {
          next.push({
            phase: ev.phase,
            description: ev.description ?? ev.phase,
            status: "running",
            log: [],
          });
        } else {
          next[idx] = { ...next[idx], status: "running" };
        }
      } else if (ev.type === "phase-log" && ev.phase && ev.line && idx >= 0) {
        next[idx] = {
          ...next[idx],
          log: [...next[idx].log, { line: ev.line, stream: ev.stream }],
        };
      } else if (ev.type === "phase-done" && ev.phase && idx >= 0) {
        next[idx] = { ...next[idx], status: "done" };
      } else if (ev.type === "phase-error" && ev.phase && idx >= 0) {
        next[idx] = { ...next[idx], status: "error" };
      }
      return next;
    });
  }

  async function run() {
    if (!state.domain?.prefix || !state.admin?.email) {
      setError("Missing domain or admin info — go back and fix.");
      return;
    }

    const r = await fetch(`/api/setup/provision/stream${DRY_RUN ? "?dryRun=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.domain.prefix,
        ownerEmail: state.admin.email,
      }),
    });
    if (!r.ok || !r.body) {
      setError(`Stream request failed (HTTP ${r.status})`);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = r.body.getReader();

    try {
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseSse(block);
          if (!ev) continue;
          if (ev.type === "complete") {
            setCompleted({
              domain: ev.domain ?? "",
              url: ev.dashboardUrl ?? "",
            });
            setDone(true);
            continue;
          }
          if (ev.type === "fatal") {
            setError(ev.message ?? "Setup stopped.");
            setDone(true);
            continue;
          }
          applyEvent(ev);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDone(true);
    }
  }

  // Auto-start on entry. Strict-mode protection — useEffect runs twice in
  // dev; ref guard prevents double-firing the (irreversible) provision.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 08</span>
        <span className="setup-meta-label">Installing</span>
      </div>

      <h1>
        Bringing your <em>Rainbow</em> online.
      </h1>
      <p className="setup-lede">
        {DRY_RUN
          ? "Dry run — claiming the subdomain, minting secrets, and rendering configs. Stops before bringing the stack up."
          : "This usually takes between three and ten minutes — most of the time is pulling the container images."}
      </p>

      <ul className="setup-checklist">
        {phases.map((p) => (
          <li key={p.phase}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="check-name">{p.description}</div>
              {p.log.length > 0 && (
                <div
                  className="setup-log"
                  ref={p.status === "running" ? logRef : undefined}
                  style={{ marginTop: "0.5rem", maxHeight: "12rem" }}
                >
                  {p.log.slice(-50).map((l, i) => (
                    <div
                      key={i}
                      className={"log-line" + (l.stream === "stderr" ? " stderr" : "")}
                    >
                      {l.line}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span
              className={
                "setup-status " +
                (p.status === "done"
                  ? "is-pass"
                  : p.status === "error"
                    ? "is-fail"
                    : "")
              }
            >
              {p.status === "running"
                ? "In progress"
                : p.status === "done"
                  ? "Done"
                  : p.status === "error"
                    ? "Failed"
                    : "Pending"}
            </span>
          </li>
        ))}
      </ul>

      {error && <div className="setup-error">{error}</div>}
      {completed && (
        <div className="setup-card" style={{ marginTop: "1.5rem" }}>
          <h3>All done.</h3>
          <p>
            Your Rainbow is live at <code>{completed.domain}</code>. Click
            below to sign in for the first time.
          </p>
        </div>
      )}

      <div className="setup-actions">
        {/* Back is only useful after a failure — during provision the
            user can't undo what's already happened on Cloudflare. */}
        {onBack && (error || (done && !completed)) ? (
          <button
            type="button"
            className="setup-btn setup-btn-ghost"
            onClick={() => void onBack()}
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="setup-btn setup-btn-primary"
          onClick={() => void onContinue()}
          disabled={!completed}
        >
          {completed
            ? "Continue →"
            : error
              ? "Setup stopped"
              : done
                ? "Stopped"
                : "Working…"}
        </button>
      </div>
    </>
  );
}

function parseSse(block: string): PhaseEvent | null {
  const lines = block.split("\n");
  let event = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event || dataLines.length === 0) return null;
  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    return parsed as PhaseEvent;
  } catch {
    return null;
  }
}
