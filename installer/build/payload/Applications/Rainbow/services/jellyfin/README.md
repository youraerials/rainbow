# Jellyfin — Media Server

Free, open-source media server with Apple Metal hardware transcoding.

## Why Native (Not Docker)?

Jellyfin runs natively on macOS to access Apple's VideoToolbox (Metal) for hardware-accelerated transcoding. This is not available inside Docker containers on macOS, and makes a significant difference for real-time transcoding performance.

## Access

- Web: `https://media.yourdomain.rainbow.rocks`
- Apps: Jellyfin clients for iOS, Android, Apple TV, Roku, Fire TV, etc.

## Hardware Transcoding

After first login:
1. Go to Dashboard > Playback
2. Set Hardware Acceleration to "Apple VideoToolbox"
3. Enable hardware decoding for H.264, HEVC, VP9

Mac Mini M-series can transcode multiple 4K streams simultaneously.

## Media Libraries

Configure media paths in `config/rainbow.yaml`:
```yaml
services:
  jellyfin:
    media_paths:
      - "~/Movies"
      - "~/Music"
      - "/Volumes/ExternalSSD/media"
```

Then add these paths as libraries in the Jellyfin web UI.

## SSO

Jellyfin supports OIDC via the SSO-Auth plugin:
1. Install "SSO-Auth" from Plugin Catalog in Jellyfin admin
2. Configure with Authentik provider details (stored in Keychain after `setup-providers.sh`)
