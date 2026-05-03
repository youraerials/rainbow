import { useState } from "react";
import { StepProps } from "./types";
import { DEFAULT_SERVICES } from "../types";

export function ServicesStep({ state, patch, onContinue, onBack }: StepProps) {
  const [services, setServices] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const k of Object.keys(DEFAULT_SERVICES)) {
      initial[k] = state.services?.[k] ?? DEFAULT_SERVICES[k].default;
    }
    return initial;
  });

  function toggle(key: string) {
    setServices((s) => ({ ...s, [key]: !s[key] }));
  }

  async function next() {
    await patch({ services });
    void onContinue();
  }

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 05</span>
        <span className="setup-meta-label">Services</span>
      </div>

      <h1>
        Pick what you want <em>turned on</em>.
      </h1>
      <p className="setup-lede">
        Disabled services don't pull or run, saving disk and CPU. You can
        flip any of these on later from the dashboard.
      </p>

      <ul className="setup-checklist">
        {Object.entries(DEFAULT_SERVICES).map(([key, info]) => (
          <li key={key}>
            <div>
              <div className="check-name">{info.label}</div>
              <div className="check-detail">{info.description}</div>
            </div>
            <button
              type="button"
              className={"setup-chip" + (services[key] ? " is-active" : "")}
              onClick={() => toggle(key)}
            >
              {services[key] ? "Enabled" : "Skip"}
            </button>
          </li>
        ))}
      </ul>

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
          onClick={() => void next()}
        >
          Continue →
        </button>
      </div>
    </>
  );
}
