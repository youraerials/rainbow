import { StepProps } from "./types";

export function WelcomeStep({ onContinue }: StepProps) {
  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 01</span>
        <span className="setup-meta-label">Welcome</span>
      </div>

      <h1>
        Take back your <em>digital life</em>.
      </h1>
      <p className="setup-lede">
        We're going to set Rainbow up on this Mac — your photos, mail,
        files, documents, and media, hosted on hardware <em>you own</em>.
        About ten minutes. No accounts to sign up for, except the one
        you'll create.
      </p>

      <div className="setup-card">
        <h3>What this installer will do</h3>
        <ol style={{ paddingLeft: "1.2rem", color: "var(--ink-mid)" }}>
          <li>Check your Mac meets the requirements.</li>
          <li>
            Pick a name — your Rainbow lives at{" "}
            <code>yourname.rainbow.rocks</code> (or your own domain later).
          </li>
          <li>Configure the services you want.</li>
          <li>Pull the container images and bring everything online.</li>
          <li>Hand you off to your dashboard with a fresh admin account.</li>
        </ol>
        <p
          className="fineprint"
          style={{ marginTop: "1rem", marginBottom: 0 }}
        >
          You can leave at any point — we save your progress.
        </p>
      </div>

      <div className="setup-actions">
        <span />
        <button
          type="button"
          className="setup-btn setup-btn-primary"
          onClick={() => void onContinue()}
        >
          Begin →
        </button>
      </div>
    </>
  );
}
