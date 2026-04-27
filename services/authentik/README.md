# Authentik — Identity & SSO

Authentik provides single sign-on (SSO) across all Rainbow services.

## How It Works

1. Authentik runs as a Docker service (server + worker)
2. Each Rainbow service is registered as an OAuth2/OIDC application
3. Users log in once at `auth.yourdomain.rainbow.rocks` and are authenticated everywhere
4. Client credentials are stored in the macOS Keychain

## Setup

After first boot:

```bash
# Wait for Authentik to be healthy
rainbow logs authentik-server

# Run the provider setup script
./services/authentik/setup-providers.sh

# Regenerate configs with OAuth credentials
rainbow config apply

# Restart services to pick up new config
rainbow restart
```

## Service Integration

| Service | Auth Method | Notes |
|---------|-----------|-------|
| Immich | Native OIDC | Set in Immich admin > Authentication |
| Seafile | Native OAuth2 | Configured via seahub_settings.py |
| Jellyfin | OIDC Plugin | Requires SSO-Auth plugin |
| CryptPad | Forward Auth | Caddy handles auth before proxying |
| Stalwart | OIDC | Configured in Stalwart config |
| Dashboard | Native OIDC | Built-in auth flow |

## Admin Access

- URL: `https://auth.yourdomain.rainbow.rocks`
- Default admin: `akadmin`
- Password: stored in Keychain as `rainbow-authentik-bootstrap-password`
