# CryptPad — Collaborative Documents

Privacy-first collaborative document editing. All content is encrypted client-side.

## Access

- Documents: `https://docs.yourdomain.rainbow.rocks`
- Sandbox (required for security): `https://docs-sandbox.yourdomain.rainbow.rocks`

## Features

- Rich text documents
- Spreadsheets
- Presentations
- Kanban boards
- Whiteboards
- Code/markdown editor
- Polls and forms

## Architecture

CryptPad requires two domains:
1. **Main domain** (`docs.domain`) — serves the application
2. **Sandbox domain** (`docs-sandbox.domain`) — isolates user content for security

Both are configured automatically by the Rainbow config generator.

## Encryption

All document content is encrypted in the browser before being sent to the server. The server never sees unencrypted content. This means:
- The admin cannot read user documents
- Backups contain encrypted data
- Sharing requires explicit key exchange

## Admin

To manage CryptPad as admin, you need to add your public signing key to the config. After first login:
1. Go to Settings > Account
2. Copy your "Public Signing Key"
3. Add it to `config/rainbow.yaml` under `services.cryptpad` (or update the admin key in the generated config)
