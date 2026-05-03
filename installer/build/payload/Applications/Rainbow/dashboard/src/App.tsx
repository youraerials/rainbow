import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { HomeView } from "./views/HomeView";
import { ServicesView } from "./views/ServicesView";
import { AppBuilderView } from "./views/AppBuilderView";
import { BackupsView } from "./views/BackupsView";
import { SettingsView } from "./views/SettingsView";
import { DomainsView } from "./views/DomainsView";

const navItems = [
  { path: "/", label: "Home", icon: "H" },
  { path: "/services", label: "Services", icon: "S" },
  { path: "/builder", label: "App Builder", icon: "A" },
  { path: "/backups", label: "Backups", icon: "B" },
  { path: "/domains", label: "Domains", icon: "D" },
  { path: "/settings", label: "Settings", icon: "G" },
];

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav style={styles.sidebar}>
          <div style={styles.logo}>
            <span style={styles.logoText}>rainbow</span>
            <span style={styles.version}>v0.1.0</span>
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
                <span style={styles.navIcon}>{item.icon}</span>
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
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    padding: "16px 0",
    flexShrink: 0,
  },
  logo: {
    padding: "0 20px 20px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--accent)",
    letterSpacing: "-0.5px",
  },
  version: {
    fontSize: 11,
    color: "var(--text-dim)",
  },
  nav: {
    flex: 1,
    padding: "12px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: "var(--radius)",
    color: "var(--text-dim)",
    textDecoration: "none",
    fontSize: 14,
    transition: "all 0.15s",
  },
  navItemActive: {
    background: "var(--accent)",
    color: "#fff",
  },
  navIcon: {
    width: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 600,
    background: "rgba(255,255,255,0.1)",
    borderRadius: 4,
  },
  sidebarFooter: {
    padding: "12px 20px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 16,
  },
  footerLink: {
    color: "var(--text-dim)",
    textDecoration: "none",
    fontSize: 12,
  },
  main: {
    flex: 1,
    padding: 32,
    overflowY: "auto",
  },
};
