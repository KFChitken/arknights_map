#!/usr/bin/env bash
# Starts two builds side by side for scripts/i18n/screens.mjs: the one before at :3201 and
# this one at :3202, each on its own copy of the same database, with demo players and two
# signed-in players (sessions shots-token-0001, a player of a month; shots-token-0002, a
# newcomer). Both must be built first (`npx next build` in each folder).
#
#   scripts/i18n/screens-setup.sh <folder of the build before> [<folder of this build>]
#   scripts/i18n/screens-setup.sh stop
#
# Needs Postgres with PostGIS at localhost:5432 (user roach, as docker-compose.yml has it).
set -euo pipefail

PG="postgres://roach:roach@localhost:5432"
export PGPASSWORD=roach
psql_() { psql -h localhost -U roach -v ON_ERROR_STOP=1 -q "$@"; }
LOGS="${TMPDIR:-/tmp}/zhoup-shots"
mkdir -p "$LOGS"

# the servers rename their processes, so they are kept track of by number
stop() {
  for f in "$LOGS"/*.pid; do
    [ -e "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  done
  sleep 1
}
if [ "${1:-}" = stop ]; then stop; exit 0; fi

BASE="$(cd "$1" && pwd)"
NOW="$(cd "${2:-.}" && pwd)"
stop

# the standalone server needs these beside it, as the Dockerfile copies them
for d in "$BASE" "$NOW"; do
  cp -r "$d/.next/static" "$d/.next/standalone/.next/"
  cp -r "$d/public" "$d/drizzle" "$d/.next/standalone/"
done

serve() { # folder port database role
  (
    cd "$1/.next/standalone"
    exec env PORT="$2" HOSTNAME=127.0.0.1 NODE_ENV=production DEMO=1 DATABASE_URL="$PG/$3" \
      AUTH_SECRET=screens-only-secret-0123456789abcdef WEB_ROLE="$4" OPERATOR_AVATARS=off AMIYA_PICTURE=off \
      PERLICA_PICTURE=off TALULAH_PICTURE=off MINGHE_PICTURE=off PARTY_MUSIC=off node server.js >"$LOGS/$2.log" 2>&1
  ) &
  echo $! >"$LOGS/$2.pid"
}

# the database: migrated and given its demo players by the build before, as its own main process
psql_ -d postgres -c "drop database if exists roach_shots_tpl with (force)" -c "create database roach_shots_tpl"
serve "$BASE" 3200 roach_shots_tpl ""
for _ in $(seq 60); do
  n=$(psql -h localhost -U roach -d roach_shots_tpl -At -c "select count(*) from users where demo_key is not null" 2>/dev/null || echo 0)
  [ "${n:-0}" -gt 1000 ] && break
  sleep 1
done
sleep 3
stop

# two players signed in: 阿白 (t1), a month old, and 小林 (t2), a newcomer
sid() { node -e "process.stdout.write(require('crypto').createHash('sha256').update('$1').digest('base64url'))"; }
psql_ -d roach_shots_tpl <<SQL
update users set email = 'a@shots.local', age_confirmed_at = now(), policy_accepted_at = now(),
  public_place_accepted_at = now(), created_at = now() - interval '30 days' where demo_key = 't1';
update users set email = 'b@shots.local', age_confirmed_at = now(), policy_accepted_at = now(),
  public_place_accepted_at = now(), created_at = now() - interval '1 day' where demo_key = 't2';
insert into sessions (id, user_id, expires_at, method)
  select '$(sid shots-token-0001)', id, now() + interval '300 days', 'dev' from users where demo_key = 't1';
insert into sessions (id, user_id, expires_at, method)
  select '$(sid shots-token-0002)', id, now() + interval '300 days', 'dev' from users where demo_key = 't2';
SQL

for db in roach_shots_a roach_shots_b; do
  psql_ -d postgres -c "drop database if exists $db with (force)" -c "create database $db template roach_shots_tpl"
done

# as helpers, which run none of the timed jobs: nothing changes either database but the screens' own steps
serve "$BASE" 3201 roach_shots_a helper
serve "$NOW" 3202 roach_shots_b helper
for p in 3201 3202; do
  for _ in $(seq 30); do curl -sf "http://127.0.0.1:$p/icon.svg" >/dev/null && break; sleep 1; done
done
echo "Before at http://127.0.0.1:3201, this build at http://127.0.0.1:3202 (logs in $LOGS)"
