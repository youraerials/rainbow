import { useEffect, useState } from "react";
import { StepProps } from "./types";

interface PreflightResult {
  macosVersion: string;
  appleSilicon: boolean;
  controlDaemonUp: boolean;
  subdomainWorkerReachable: boolean;
  pass: boolean;
  failures: string[];
}

export function PreflightStep({ onContinue, onBack }: StepProps) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const r = await fetch("/api/setup/preflight", { method: "POST" });
      const data = (await r.json()) as PreflightResult;
      setResult(data);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void run();
  }, []);

  const checks = result
    ? [
        {
          name: "Apple Silicon",
          pass: result.appleSilicon,
          detail: result.appleSilicon
            ? "M-series CPU detected."
            : "Rainbow needs an Apple Silicon Mac.",
        },
        {
          name: "macOS version",
          pass: true,
          detail: result.macosVersion,
        },
        {
          name: "Host control daemon",
          pass: result.controlDaemonUp,
          detail: result.controlDaemonUp
            ? "Reachable on localhost."
            : "Couldn't reach the daemon — was the installer interrupted?",
        },
        {
          name: "Subdomain Worker",
          pass: result.subdomainWorkerReachable,
          detail: result.subdomainWorkerReachable
            ? "rainbow.rocks Worker responded."
            : "Couldn't reach rainbow.rocks. Check your network.",
        },
      ]
    : [];

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 02</span>
        <span className="setup-meta-label">Preflight</span>
      </div>

      <h1>
        A few <em>checks</em> before we begin.
      </h1>
      <p className="setup-lede">
        Rainbow needs an Apple Silicon Mac, a working network connection,
        and the host control daemon already in place from the installer.
      </p>

      {running && !result && (
        <p className="eyebrow">Running preflight…</p>
      )}

      {result && (
        <ul className="setup-checklist">
          {checks.map((c) => (
            <li key={c.name}>
              <div>
                <div className="check-name">{c.name}</div>
                <div className="check-detail">{c.detail}</div>
              </div>
              <span
                className={
                  "setup-status " + (c.pass ? "is-pass" : "is-fail")
                }
              >
                {c.pass ? "Pass" : "Needs attention"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="setup-actions">
        {onBack ? (
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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {result && !result.pass && (
            <button
              type="button"
              className="setup-btn setup-btn-ghost"
              onClick={() => void run()}
              disabled={running}
            >
              Re-check
            </button>
          )}
          <button
            type="button"
            className="setup-btn setup-btn-primary"
            disabled={!result?.pass || running}
            onClick={() => void onContinue()}
          >
            Continue →
          </button>
        </div>
      </div>
    </>
  );
}
