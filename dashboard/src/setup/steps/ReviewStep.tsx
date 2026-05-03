import { StepProps } from "./types";
import { DEFAULT_SERVICES } from "../types";

export function ReviewStep({ state, onContinue, onBack }: StepProps) {
  const enabled = Object.entries(state.services ?? {})
    .filter(([, on]) => on)
    .map(([k]) => DEFAULT_SERVICES[k]?.label ?? k);

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 07</span>
        <span className="setup-meta-label">Review</span>
      </div>

      <h1>
        Almost <em>there</em>.
      </h1>
      <p className="setup-lede">
        Last look before we provision. Hitting <em>Begin install</em> will
        claim your subdomain on rainbow.rocks, render the configs, pull
        the container images, and bring everything online. About five to
        ten minutes.
      </p>

      <ul className="setup-checklist">
        <li>
          <div>
            <div className="check-name">Address</div>
            <div className="check-detail">
              <code>{state.domain?.apex ?? "—"}</code>
            </div>
          </div>
        </li>
        <li>
          <div>
            <div className="check-name">Administrator</div>
            <div className="check-detail">
              {state.admin?.name ?? "—"} · {state.admin?.email ?? "—"}
            </div>
          </div>
        </li>
        <li>
          <div>
            <div className="check-name">Services</div>
            <div className="check-detail">
              {enabled.length > 0 ? enabled.join(" · ") : "None selected"}
            </div>
          </div>
        </li>
        <li>
          <div>
            <div className="check-name">Storage</div>
            <div className="check-detail">
              ~/Library/Application Support/Rainbow/
            </div>
          </div>
        </li>
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
          onClick={() => void onContinue()}
        >
          Begin install →
        </button>
      </div>
    </>
  );
}
