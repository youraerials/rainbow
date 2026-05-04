import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { HomeView } from "./views/HomeView";
import { ServicesView } from "./views/ServicesView";
import { AppBuilderView } from "./views/AppBuilderView";
import { BackupsView } from "./views/BackupsView";
import { SettingsView } from "./views/SettingsView";
import { DomainsView } from "./views/DomainsView";
import { UpdateBanner } from "./components/UpdateBanner";

const navItems = [
  { path: "/", label: "Home" },
  { path: "/services", label: "Services" },
  { path: "/builder", label: "App Builder" },
  { path: "/backups", label: "Backups" },
  { path: "/domains", label: "Domains" },
  { path: "/settings", label: "Settings" },
];

function Logomark() {
  return (
    <svg
      viewBox="0 0 100 60"
      width={32}
      height={19}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M 10 50 A 40 40 0 0 1 90 50" strokeWidth="4" />
      <path d="M 18 50 A 32 32 0 0 1 82 50" strokeWidth="4" />
      <path d="M 26 50 A 24 24 0 0 1 74 50" strokeWidth="4" />
      <path d="M 34 50 A 16 16 0 0 1 66 50" strokeWidth="4" />
      <path d="M 42 50 A 8 8 0 0 1 58 50" strokeWidth="4" />
    </svg>
  );
}

export function App() {
  return (
    <BrowserRouter basename="/dashboard">
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav style={styles.sidebar}>
          <div style={styles.logo}>
            <span style={styles.logomark}>
              <Logomark />
            </span>
            <span style={styles.wordmark}>rainbow</span>
          </div>

          <div style={styles.nav}>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                style={({ isActive }) => ({
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <div style={styles.sidebarFooter}>
            <a
              href="https://github.com/youraerials/rainbow"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.footerLink}
            >
              GitHub
            </a>
            <a href="/docs" style={styles.footerLink}>
              Docs
            </a>
          </div>
        </nav>

        <main style={styles.main}>
          <UpdateBanner />
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/services" element={<ServicesView />} />
            <Route path="/builder" element={<AppBuilderView />} />
            <Route path="/backups" element={<BackupsView />} />
            <Route path="/domains" element={<DomainsView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    background: "var(--surface)",
    borderRight: "1px solid var(--text)",
    display: "flex",
    flexDirection: "column",
    padding: 0,
    flexShrink: 0,
  },
  logo: {
    padding: "1.4rem 1.25rem 1.25rem",
    borderBottom: "1px solid var(--text)",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    color: "var(--text)",
  },
  logomark: {
    color: "var(--text)",
    display: "inline-flex",
  },
  wordmark: {
    fontFamily: "var(--font-display)",
    fontStyle: "italic",
    fontSize: "1.55rem",
    fontWeight: 500,
    letterSpacing: "-0.03em",
    color: "var(--text)",
    fontVariationSettings: '"opsz" 60, "SOFT" 80, "WONK" 0',
  },
  nav: {
    flex: 1,
    padding: "1rem 0",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  navItem: {
    display: "block",
    padding: "0.75rem 1.25rem",
    color: "var(--text-dim)",
    textDecoration: "none",
    fontSize: "0.95rem",
    fontFamily: "var(--font-body)",
    borderLeft: "3px solid transparent",
    transition: "all 200ms var(--ease-out)",
  },
  navItemActive: {
    color: "var(--text)",
    borderLeftColor: "var(--text)",
    background: "var(--surface-hover)",
    fontWeight: 500,
  },
  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: "1rem",
  },
  footerLink: {
    color: "var(--text-dim)",
    textDecoration: "none",
    fontSize: "0.78rem",
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    fontWeight: 500,
  },
  main: {
    flex: 1,
    padding: "clamp(2rem, 4vw, 3rem)",
    overflowY: "auto",
    maxWidth: 1280,
  },
};
