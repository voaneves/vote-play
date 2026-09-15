#!/usr/bin/env bash
# Aplica migrations + seed num Postgres descartável e roda a suíte de testes.
#
#   ./supabase/tests/run.sh [porta]
#
# Precisa de postgresql-16 (ou superior) instalado. Sobe um servidor próprio,
# só em socket unix — não encosta em nenhum Postgres que você já tenha rodando,
# nem no projeto remoto do Supabase.
set -euo pipefail

PORT="${1:-5433}"
PGDATA="${PGDATA:-/tmp/voteplay-pgdata}"
SOCK="/tmp/voteplay-pgrun"
LOG="/tmp/voteplay-pg.log"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(dirname "$HERE")"

if [ -z "$BIN" ]; then
  echo "Postgres não encontrado em /usr/lib/postgresql/*/bin" >&2
  exit 1
fi

export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres

start_server() {
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA" "$SOCK"
  # "-h ''" desliga o listener TCP: só socket, zero risco de colidir de porta
  local opts="-p $PORT -k $SOCK -h ''"
  if [ "$(id -u)" = "0" ]; then
    # o Postgres recusa rodar como root (comum em container)
    chown -R postgres:postgres "$PGDATA" "$SOCK"
    su postgres -c "$BIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
    su postgres -c "$BIN/pg_ctl -D $PGDATA -l $LOG -o \"$opts\" start" >/dev/null
  else
    "$BIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
    "$BIN/pg_ctl" -D "$PGDATA" -l "$LOG" -o "$opts" start >/dev/null
  fi
  sleep 2
}

if ! pg_isready -q 2>/dev/null; then
  start_server
fi

if ! pg_isready -q 2>/dev/null; then
  echo "não foi possível subir o Postgres; veja $LOG" >&2
  tail -5 "$LOG" >&2 || true
  exit 1
fi

dropdb --if-exists voteplay_test
createdb voteplay_test

psql -q -d voteplay_test -v ON_ERROR_STOP=1 -f "$HERE/00_supabase_stub.sql" >/dev/null
for f in "$SUPA"/migrations/*.sql; do
  psql -q -d voteplay_test -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -q -d voteplay_test -v ON_ERROR_STOP=1 -f "$SUPA/seed.sql" >/dev/null

fail=0
for t in "$HERE"/[01][0-9]_*.sql; do
  name="$(basename "$t")"
  if out="$(psql -d voteplay_test -v ON_ERROR_STOP=1 -f "$t" 2>&1)"; then
    echo "$out" | grep -o 'NOTICE:.*' | sed "s|NOTICE:  |  ✓ |"
  else
    echo "  ✗ FALHOU: $name"
    echo "$out" | grep -E 'ERROR|CONTEXT' | head -5 | sed 's|^|      |'
    fail=1
  fi
done

if [ "$fail" = "0" ]; then
  echo ""
  echo "Suíte completa passou."
fi
exit $fail
