#!/bin/sh
# Start the live server. With Azure storage configured: restore the database from its continuous copy (first start
# of a new replica), then run the app under Litestream so every change is copied out within about a second.
set -e
mkdir -p "${KL_DATA_DIR:-/data}"
APP="uvicorn app:app --app-dir /app/backend --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"

if [ -n "$LITESTREAM_AZURE_ACCOUNT_NAME" ]; then
  litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists /data/kshetralekha.sqlite
  exec litestream replicate -config /etc/litestream.yml -exec "$APP"
fi

echo "No Azure storage configured: running without the continuous database copy (local testing only)." >&2
exec $APP
