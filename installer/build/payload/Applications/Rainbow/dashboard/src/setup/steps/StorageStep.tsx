import { StepProps } from "./types";

// Placeholder for now — defaults under ~/Library/Application Support/Rainbow
// are sensible for the vast majority of users. We can surface per-service
// path overrides in a "Customize storage" expansion later.
export function StorageStep({ onContinue, onBack }: StepProps) {
  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 06</span>
        <span className="setup-meta-label">Storage</span>
      </div>

      <h1>
        Your data lives <em>here</em>.
      </h1>
      <p className="setup-lede">
        Photos, mail, files, and service state will be stored under{" "}
        <code>~/Library/Application Support/Rainbow/</code>. That's the
        default home — the same place Time Machine backs up by default.
      </p>

      <div className="setup-card">
        <p style={{ marginBottom: 0 }}>
          You can move any service's data to an external drive or NAS
          later from the dashboard. For now we'll use the defaults.
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
          onClick={() => void onContinue()}
        >
          Continue →
        </button>
      </div>
    </>
  );
}
