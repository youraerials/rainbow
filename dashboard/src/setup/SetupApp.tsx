import { useEffect, useState, useCallback } from "react";
import "./setup.css";
import { Logo } from "./Logo";
import { STEPS, StepKey, SetupState } from "./types";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PreflightStep } from "./steps/PreflightStep";
import { DomainStep } from "./steps/DomainStep";
import { AdminStep } from "./steps/AdminStep";
import { ServicesStep } from "./steps/ServicesStep";
import { StorageStep } from "./steps/StorageStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ProvisionStep } from "./steps/ProvisionStep";
import { DoneStep } from "./steps/DoneStep";

export function SetupApp() {
  const [state, setState] = useState<SetupState>({ step: 0 });
  const [loading, setLoading] = useState(true);

  // Load existing state on mount so refresh resumes where we were.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/setup/state");
        if (r.ok) {
          const data = (await r.json()) as SetupState;
          if (!cancelled) setState(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback(async (delta: Partial<SetupState>) => {
    const r = await fetch("/api/setup/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
    });
    if (r.ok) {
      const data = (await r.json()) as SetupState;
      setState(data);
      return data;
    }
    throw new Error(`state PATCH failed (${r.status})`);
  }, []);

  const goto = useCallback(
    async (step: number) => {
      await patch({ step });
    },
    [patch],
  );

  const stepKey: StepKey = STEPS[Math.max(0, Math.min(state.step, STEPS.length - 1))].key;

  const stepProps = {
    state,
    patch,
    onContinue: () => goto(state.step + 1),
    onBack: state.step > 0 ? () => goto(state.step - 1) : undefined,
  };

  return (
    <div className="setup-app">
      <header className="setup-masthead">
        <div className="setup-masthead-rule" aria-hidden="true" />
        <nav className="setup-nav">
          <span className="setup-wordmark">
            <Logo size={38} />
            <span className="setup-wordmark-text">rainbow</span>
          </span>
          <span className="setup-step-counter">
            № {String(Math.min(state.step + 1, STEPS.length)).padStart(2, "0")} ·{" "}
            {STEPS[Math.min(state.step, STEPS.length - 1)].title}
          </span>
        </nav>
      </header>

      <main className="setup-page">
        {loading ? (
          <div className="setup-meta">
            <span className="setup-meta-label">Loading…</span>
          </div>
        ) : (
          <>
            {stepKey === "welcome" && <WelcomeStep {...stepProps} />}
            {stepKey === "preflight" && <PreflightStep {...stepProps} />}
            {stepKey === "domain" && <DomainStep {...stepProps} />}
            {stepKey === "admin" && <AdminStep {...stepProps} />}
            {stepKey === "services" && <ServicesStep {...stepProps} />}
            {stepKey === "storage" && <StorageStep {...stepProps} />}
            {stepKey === "review" && <ReviewStep {...stepProps} />}
            {stepKey === "provision" && <ProvisionStep {...stepProps} />}
            {stepKey === "done" && <DoneStep {...stepProps} />}
          </>
        )}
      </main>
    </div>
  );
}
