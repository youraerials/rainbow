import { FormEvent, useState } from "react";
import { StepProps } from "./types";

export function AdminStep({ state, patch, onContinue, onBack }: StepProps) {
  const [email, setEmail] = useState(state.admin?.email ?? "");
  const [name, setName] = useState(state.admin?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("That doesn't look like an email.");
      return;
    }
    setError(null);
    await patch({ admin: { email: email.trim(), name: name.trim() } });
    void onContinue();
  }

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 04</span>
        <span className="setup-meta-label">First user</span>
      </div>

      <h1>
        Who's using <em>this Rainbow</em>?
      </h1>
      <p className="setup-lede">
        We'll create your administrator account — the one you'll sign in
        with at the dashboard.
      </p>

      <form onSubmit={submit} className="setup-card">
        <div className="setup-field">
          <label className="setup-label" htmlFor="setup-name">Name</label>
          <input
            id="setup-name"
            className="setup-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aubrey"
            required
          />
        </div>
        <div className="setup-field">
          <label className="setup-label" htmlFor="setup-email">Email</label>
          <input
            id="setup-email"
            className="setup-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <div className="setup-help">
            Used as your login and as the contact address for important
            notifications. You'll set your password during the first sign-in.
          </div>
        </div>
        {error && <div className="setup-error">{error}</div>}

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
          <button type="submit" className="setup-btn setup-btn-primary">
            Continue →
          </button>
        </div>
      </form>
    </>
  );
}
