# Seafile — File Sharing & Sync

Efficient file sync and sharing with block-level deduplication.

## Access

- Web: `https://files.yourdomain.rainbow.rocks`
- Desktop sync client: Download from [seafile.com](https://www.seafile.com/en/download/)
- Mobile app: Available on iOS and Android

## Storage

Configure storage location in `config/rainbow.yaml`:
```yaml
services:
  seafile:
    data_path: "/Volumes/ExternalSSD/rainbow/seafile"
```

## SSO

Seafile authenticates via OAuth2 through Authentik. After running the Authentik provider setup, users can log in with their Rainbow account.

## Sync Clients

Configure desktop/mobile sync clients with:
- Server: `https://files.yourdomain.rainbow.rocks`
- Login via OAuth (redirects to Authentik)
