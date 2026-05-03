# Rainbow Brand Site

The marketing site at [rainbow.rocks](https://rainbow.rocks).

Single-page static HTML — no framework, no build step. Served by Cloudflare Pages.

## Structure

```
website/
├── index.html       # The page
├── styles.css       # All styles (Fraunces + Bricolage Grotesque)
├── favicon.svg      # Rainbow disc favicon
├── og-image.svg     # Open Graph social preview
├── _headers         # Cloudflare Pages security & cache headers
├── _redirects       # Short URLs (/download, /docs, etc.)
├── wrangler.toml    # Pages project config
└── scripts/
    ├── dev.sh       # Local dev server (wrangler pages dev)
    └── deploy.sh    # Deploy to Cloudflare Pages
```

## Local development

```bash
./scripts/dev.sh
# Open http://localhost:8788
```

This uses `wrangler pages dev` so headers and redirects work the same as production.

## Deploy

If you've never used wrangler before, log in once:

```bash
npx wrangler@4 login
```

Then deploy:

```bash
./scripts/deploy.sh             # Production (branch=main)
./scripts/deploy.sh --preview   # Preview deploy (unique URL, no production impact)
```

The script:

1. Verifies wrangler auth (prompts you to login if needed)
2. Creates the `rainbow-site` Pages project if it doesn't exist
3. Uploads the static files to Cloudflare's edge
4. Promotes to production unless `--preview` is passed

That's it. No Keychain setup, no API tokens.

### Custom domain (one-time)

After your first deploy, attach `rainbow.rocks` to the Pages project. The simplest path is the Cloudflare dashboard:

> **Workers & Pages → rainbow-site → Custom domains → Set up a custom domain → `rainbow.rocks`**

Cloudflare auto-creates the CNAME if `rainbow.rocks` is on the same account. Done.

If you'd rather automate it from the CLI, `./scripts/deploy.sh --setup-domain` will do it via the API. That path needs three Keychain entries (because the API call needs an account-scoped token, account ID, and zone ID — none of which wrangler exposes directly):

```bash
security add-generic-password -s rainbow-cloudflare-api-token -a rainbow -w '<token>'
security add-generic-password -s rainbow-cloudflare-account-id -a rainbow -w '<account-id>'
security add-generic-password -s rainbow-cloudflare-zone-id -a rainbow -w '<zone-id-for-rainbow.rocks>'
```

Token permissions: `Account.Cloudflare Pages:Edit` + `Zone.DNS:Edit`. The dashboard route is genuinely easier for a one-time setup though.

## Design notes

### Brand identity

The Rainbow logo is intentionally monochrome — five concentric arcs, drawn with `currentColor` so they inherit context. **The platform stays understated. The user's content provides the color.** That principle drives every visual decision on this site.

### Aesthetic

Editorial print-manifesto. Fraunces (variable serif, with `SOFT` and `WONK` axes for personality) over Bricolage Grotesque, on a warm cream paper background `#f4ecd8` with deep warm ink `#1a1612`.

Every accent that *could* be colored is rendered in ink instead — italic + bold emphasis carries the visual hierarchy. Section numbering, large editorial pull-quotes, and the typographic services index reinforce the manifesto feel. The architecture diagram is rendered as ASCII art inside a `<pre>` styled to look like a printed specimen.

### Logomark

The arcs SVG appears at three scales:
- ~38×23 px in the masthead wordmark
- ~32×19 px in the footer
- 100×100 viewBox in the favicon (with `prefers-color-scheme` dark adaptation)

It uses `stroke="currentColor"` so it inherits whatever surrounding text color it sits in — ink on paper here, but it would invert cleanly on a dark surface.

### Performance

~14 KB of HTML + ~13 KB of CSS. No JS framework. One inline `<script>` for OS-aware copy on the download button.
