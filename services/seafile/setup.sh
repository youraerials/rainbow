#!/usr/bin/env bash
#
# setup.sh — Post-start initializer for Seafile.
#
# The seafile-mc image's default entrypoint (/scripts/enterpoint.sh) only
# starts nginx and then idles. The actual seafile-controller + seahub
# processes only start when /scripts/start.py is run, which also installs
# their runit service definitions under /etc/service/. Because we replace
# the container on every `make start`, /etc/service/ resets and we have to
# re-invoke start.py each time.
#
# Re-runnable: start.py is idempotent. If services are already running the
# script just confirms and exits.

set -euo pipefail

CONTAINER=rainbow-seafile
LOG="[seafile-setup]"

log() { echo "$LOG $*"; }
err() { echo "$LOG $*" >&2; }

# Wait for the container's nginx to be up — that's the "Nginx ready" log
# line that signals the entrypoint has progressed past the initial setup.
log "Waiting for $CONTAINER nginx..."
for _ in $(seq 1 30); do
    if container logs "$CONTAINER" 2>&1 | grep -q "Nginx ready"; then
        log "  Nginx is ready"
        break
    fi
    sleep 2
done

# If seahub is already supervised, we're done.
if container exec "$CONTAINER" sv status seahub 2>/dev/null | grep -q '^run:'; then
    log "  seahub already running — nothing to do"
    exit 0
fi

log "Running /scripts/start.py to register and start seafile + seahub..."
# start.py blocks until the services are up. Capture exit status.
if ! container exec "$CONTAINER" python3 /scripts/start.py 2>&1 | tail -10; then
    err "start.py exited non-zero — check 'container logs $CONTAINER' and Seafile's MariaDB connectivity"
    exit 1
fi

log "Done. Seafile is reachable at https://${RAINBOW_HOST_PREFIX:-}files.${RAINBOW_ZONE:-}"
