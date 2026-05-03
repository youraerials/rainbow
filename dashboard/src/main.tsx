import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { SetupApp } from "./setup/SetupApp";

// Two top-level apps share this bundle: the dashboard (when Rainbow is
// fully provisioned) and the setup wizard (during first-run install,
// served by the rainbow-setup container). The web tier exposes
// /api/mode so we can pick which one to render before mounting.
async function bootstrap() {
  let mode = "dashboard";
  try {
    const r = await fetch("/api/mode", { credentials: "same-origin" });
    if (r.ok) {
      const data = (await r.json()) as { mode?: string };
      if (data.mode === "setup") mode = "setup";
    }
  } catch {
    // If /api/mode is unreachable we assume dashboard mode and let the
    // normal auth redirects take over. The setup container always has
    // /api/mode answering, so a network failure here shouldn't be
    // setup-mode anyway.
  }

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      {mode === "setup" ? <SetupApp /> : <App />}
    </StrictMode>,
  );
}

void bootstrap();
