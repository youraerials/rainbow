import { StepProps } from "./types";

export function DoneStep({ state }: StepProps) {
  const apex = state.domain?.apex ?? "your-rainbow.rainbow.rocks";
  const dashboardUrl = `https://${apex}/`;

  return (
    <>
      <div className="setup-meta">
        <span className="setup-meta-num">№ 09</span>
        <span className="setup-meta-label">Welcome home</span>
      </div>

      <h1>
        Your Rainbow is <em>yours</em>.
      </h1>
      <p className="setup-lede">
        Everything's running. Click through to your dashboard at{" "}
        <code>{apex}</code> and sign in with the email you provided. Set
        your password on first sign-in.
      </p>

      <div className="setup-card">
        <h3>What's next</h3>
        <ul style={{ paddingLeft: "1.2rem", color: "var(--ink-mid)" }}>
          <li>Sign in to your dashboard.</li>
          <li>
            Visit your webmail at <code>{state.domain?.prefix}-webmail.rainbow.rocks</code>{" "}
            and your photos at <code>{state.domain?.prefix}-photos.rainbow.rocks</code>.
          </li>
          <li>
            Configure your outbound mail relay if you want to send email
            from your domain — the dashboard's Settings page walks you
            through it.
          </li>
        </ul>
      </div>

      <div className="setup-actions">
        <span />
        <a className="setup-btn setup-btn-primary" href={dashboardUrl}>
          Open dashboard →
        </a>
      </div>
    </>
  );
}
