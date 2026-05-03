import { useEffect, useRef, useState } from "react";
import { StepProps } from "./types";

interface CheckResult {
  name: string;
  available: boolean;
  domain: string;
  error?: string;
}

export function DomainStep({ state, patch, onContinue, onBack }: StepProps) {
  const [name, setName] = useState(state.domain?.prefix ?? "");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced availability check as the user types.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!name || name.length < 3) {
      setCheck(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch(
          `/api/setup/check/${encodeURIComponent(name)}`,
        );
        const data = (await r.json()) as CheckResult;
        setCheck(data);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [name]);

  async function next() {
    if (!check?.available) return;
    await patch({
      domain: {
        mode: "claim",
        prefix: name,
        zone: "rainbow.rocks",
        apex: `${name}.rainbow.rocks`,
      },
    });
    void onContinue();
  }

  const detail = !name
    ? null
    : name.length < 3
      ? "Name must be at least 3 characters."
      : checking
        ? "Checking…"
        : check?.error
          ? check.error
          : check?.available
            ? `Yours: ${check.domain}`
            : check
              ? `Already claimed.`
              : null;

  const detailClass = check?.available
    ? "is-pass"
    : detail
      ? "is-fail"
      : undefined;

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 03</span>
        <span className="setup-meta-label">Choose your name</span>
      </div>

      <h1>
        Your address on the <em>open web</em>.
      </h1>
      <p className="setup-lede">
        Pick a short name — letters, numbers, and hyphens. Your dashboard
        will live at <code>yourname.rainbow.rocks</code>, your mail at{" "}
        <code>you@yourname.rainbow.rocks</code>, and so on.
      </p>

      <div className="setup-card">
        <div className="setup-field">
          <label className="setup-label" htmlFor="setup-name">
            Subdomain
          </label>
          <div className="setup-input-row">
            <input
              id="setup-name"
              className="setup-input with-suffix"
              type="text"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={63}
              placeholder="aubrey"
              value={name}
              onChange={(e) =>
                setName(e.target.value.toLowerCase().trim())
              }
            />
            <span className="setup-input-suffix">.rainbow.rocks</span>
          </div>
          {detail && (
            <div className="setup-help">
              <span
                className={"setup-status " + (detailClass ?? "")}
                style={{ marginRight: "0.5rem" }}
              >
                {check?.available ? "Available" : checking ? "…" : "Taken"}
              </span>
              {detail}
            </div>
          )}
        </div>

        <p className="fineprint" style={{ marginBottom: 0 }}>
          Your name is yours as long as your Rainbow is running. If you
          ever want to bring your own domain, you can switch over later —
          mail, files, and accounts come with you.
        </p>
      </div>

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
        <button
          type="button"
          className="setup-btn setup-btn-primary"
          disabled={!check?.available}
          onClick={() => void next()}
        >
          Continue →
        </button>
      </div>
    </>
  );
}
