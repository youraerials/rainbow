# Immich — Photos & Videos

Self-hosted photo and video management with ML-powered search, face recognition, and mobile app support.

## Architecture

Immich runs as two Docker containers:
- `immich-server` — Main API and web interface (port 2283)
- `immich-machine-learning` — ML model for face detection, object recognition, CLIP search

Both share a PostgreSQL database and Redis cache with other Rainbow services.

## Storage

Photos are stored at the path configured in `config/rainbow.yaml`:

```yaml
services:
  immich:
    upload_path: "./infrastructure/immich/upload"
    # For large libraries, use an external drive:
    # upload_path: "/Volumes/ExternalSSD/rainbow/photos"
```

The upload path is mounted into the container. Original files are preserved — Immich generates thumbnails and encoded versions alongside them.

## Mobile Apps

Install the Immich mobile app (iOS/Android) and configure:
- Server URL: `https://photos.yourdomain.rainbow.rocks`
- Login via OAuth (Rainbow SSO) or create a local account

Auto-upload works over both WiFi and cellular when configured.

## Machine Learning

ML features (face recognition, smart search, object tagging) run locally on your Mac Mini. On Apple Silicon, the ML container uses CPU inference. For large libraries (100k+ photos), initial processing may take several hours.

To disable ML (saves ~2-4GB RAM):
```yaml
services:
  immich:
    enable_ml: false
```

## Backup

Immich upload directory is included in Rainbow's Restic backup. The database is backed up via `pg_dump` in the pre-backup hook.

## SSO

Immich uses OAuth2/OIDC via Authentik. After running `services/authentik/setup-providers.sh`, Immich will show a "Login with Rainbow" button.
