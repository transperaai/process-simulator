#!/usr/bin/env bash
# Run SQL on the production Supabase project via the Management API.
#   bash packages/db/scripts/prod-sql.sh -f file.sql
#   bash packages/db/scripts/prod-sql.sh -c "select 1"
# Needs SUPABASE_ACCESS_TOKEN (already set in the cloud environment).
set -euo pipefail
PROJECT_REF="${SUPABASE_PROJECT_REF:-vgsjkpwvxkpqvyazwcyq}"
case "${1:-}" in
  -f) sql="$(cat "$2")" ;;
  -c) sql="$2" ;;
  *) echo "Usage: $0 -f file.sql | -c \"sql\"" >&2; exit 2 ;;
esac
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
jq -n --arg q "$sql" '{query:$q}' | curl -sS --fail-with-body -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" --data @-
