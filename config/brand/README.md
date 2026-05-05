# Rainbow brand pack

Light-touch CSS that pulls each bundled service toward Rainbow's paper/ink
look — warm cream background, near-black ink, Fraunces (display) +
Bricolage Grotesque (body), almost-square corners.

The goal is **brand recognition, not visual unification**. Each app
keeps its own layout, components, and behavior; we only retint the
surfaces a user sees most: background, accent, body font, primary
buttons.

## Files

| File | How it gets applied |
|------|---------------------|
| `_base.css` | Reference — shared tokens. Each service file already inlines what it needs. |
| `immich.css` | Pushed to Immich via `system-config.theme.customCss` by `services/brand/apply.sh` |
| `authentik.css` | Pushed to Authentik via `brands.<default>.branding_custom_css` by `services/brand/apply.sh` |
| `jellyfin.css` | Pushed to Jellyfin via `Branding/Configuration.CustomCss` by `services/brand/apply.sh` |
| `cryptpad.css` | NOT auto-applied — first attempt crashed Apple Container's apiserver (see Caveats). Sits unused for now. |

## Auto-apply

`services/brand/apply.sh` is invoked at the end of `start_minimum` in
`services/orchestrator.sh`. It pushes each CSS into the matching
service's admin API, skipping any service whose credentials aren't
yet in Keychain (so it's safe on first run before
`services/{immich,jellyfin,authentik}/setup.sh` have populated them).

To re-apply after editing CSS:

```bash
./services/brand/apply.sh
```

For CryptPad the file is baked into a named volume by the init
container, so changing the CSS requires `make stop && make start` (or
deleting the `rainbow-cryptpad-customize` volume) to re-init.

## Caveats

- **Survives upgrades** — yes for Immich/Authentik/Jellyfin (stored in
  their DB). CryptPad: survives container recreate, gets re-stamped
  whenever the volume is deleted.
- **Custom CSS is best-effort** — when an upstream dramatically
  reshuffles selectors, some rules will silently no-op. Visit each
  service after a major version bump and trim what's broken.
- **Dark mode** — these files target each service's default light
  theme. If a user picks the app's own dark mode the override falls
  back to the app's defaults (we don't fight built-in theme switching).
- **CryptPad — currently unwired.** The plan was to seed a customize
  volume from the image's `customize.dist/` (translations, images,
  ckeditor, hundreds of files) and drop our `customize.css` on top.
  Apple Container's apiserver crashed during the `cp -r` with a
  NIOHTTP2 StreamClosed — virtiofs throughput on that many small
  files exceeded what the apiserver tolerates. Reverted in 0.1.31.
  The CSS file is preserved here for a future re-attempt with a
  different mounting strategy (e.g. baking it into a derived image,
  or a single-file bind mount once Apple Container's file mounts
  stabilize).

## Adding a service

To add a new service to the pack:

1. Open the service in a browser, inspect the body / primary buttons /
   headers, and note its CSS custom properties (most modern apps
   expose at least `--primary` / `--accent` / `--bg`).
2. Copy `_base.css` into a new `<service>.css` file.
3. Add overrides keyed to that service's selectors. Keep it short —
   3-5 selectors usually carries 80% of the brand feel.
4. Add an `apply_<service>` function to `services/brand/apply.sh` if
   the service exposes a custom-CSS API field; otherwise wire it via
   a file mount in the orchestrator like CryptPad.
5. Add a row to the table above and document the apply path.
