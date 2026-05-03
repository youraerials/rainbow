// The 5-arc rainbow logomark from the brand site, monochrome (currentColor).
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg
      className="setup-logomark"
      viewBox="0 0 100 60"
      fill="none"
      stroke="currentColor"
      width={size}
      height={(size * 60) / 100}
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
