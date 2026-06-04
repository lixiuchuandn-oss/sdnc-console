#!/usr/bin/env bash
# Retry npm ci on transient registry/network failures (e.g. ECONNRESET in GitHub Actions).
set -u

max_attempts="${NPM_CI_MAX_ATTEMPTS:-3}"

for attempt in $(seq 1 "$max_attempts"); do
  if npm ci; then
    exit 0
  fi
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "npm ci failed after ${max_attempts} attempt(s)" >&2
    exit 1
  fi
  delay=$((attempt * 15))
  echo "npm ci failed (attempt ${attempt}/${max_attempts}), retrying in ${delay}s..." >&2
  sleep "$delay"
done
