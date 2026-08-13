#!/bin/bash
# ZingBee Ultra - Development Server Launcher
# Starts all services: PostgreSQL (Docker) + API + LiveKit agent + 3 clients
#
# Usage:
#   ./run-dev.sh          # Start everything
#   ./run-dev.sh api      # Start only the API
#   ./run-dev.sh red-team # Start only red-team client
#   ./run-dev.sh stop     # Stop all running services
#
# Database restore control (env var RESTORE_DB):
#   RESTORE_DB=auto  ./run-dev.sh   # (default) restore only if DB is empty; keep existing data
#   RESTORE_DB=force ./run-dev.sh   # drop the DB and reload from the latest db/ backup
#   RESTORE_DB=skip  ./run-dev.sh   # never drop/restore; only apply idempotent migrations

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Interpreter: prefer python3, fall back to python (Windows/Git Bash ships only `python`).
PYTHON="${PYTHON:-$(command -v python3 || command -v python)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PIDFILE="$ROOT_DIR/.dev-pids"

# Port assignments
API_PORT=9000
RED_TEAM_PORT=3000
ACADEMY_PORT=3001
ADMIN_PORT=3002

# ── Dependency checks ──────────────────────────────────────────────

ensure_postgres() {
    # Check if PostgreSQL is already reachable on port 5432
    if pg_isready -h localhost -p 5432 -q 2>/dev/null; then
        echo -e "${GREEN}PostgreSQL already running on port 5432${NC}"
        return 0
    fi

    # Check if Docker is available
    if ! docker info >/dev/null 2>&1; then
        echo -e "${YELLOW}WARNING: Docker is not running — skipping PostgreSQL.${NC}"
        echo -e "${YELLOW}  Start Docker Desktop and re-run, or launch PostgreSQL manually.${NC}"
        return 0
    fi

    echo -e "${CYAN}Starting PostgreSQL via Docker Compose...${NC}"
    docker compose -f "$ROOT_DIR/pipelines/docker-compose.yml" up -d db

    # Wait for healthy (up to 30s)
    local tries=0
    while ! pg_isready -h localhost -p 5432 -q 2>/dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -ge 30 ]; then
            echo -e "${YELLOW}WARNING: PostgreSQL failed to start within 30s — continuing without it.${NC}"
            return 0
        fi
        sleep 1
    done
    echo -e "${GREEN}PostgreSQL is ready${NC}"
}

apply_post_restore_sql() {
    local sql
    for sql in "$ROOT_DIR"/db/0*.sql; do
        [ -f "$sql" ] || continue
        echo -e "${CYAN}Applying post-restore SQL: $(basename "$sql")...${NC}"
        psql -h localhost -p 5432 -U postgres -d zingbee-ultra -v ON_ERROR_STOP=1 -q -f "$sql"
    done
}

restore_db() {
    # Whether to DROP the existing schema and reload from a db/ backup.
    #   RESTORE_DB=auto  (default) -> restore ONLY if the DB is empty/missing;
    #                                 leave an already-populated DB untouched.
    #   RESTORE_DB=force            -> always drop & reload (the old behavior).
    #   RESTORE_DB=skip             -> never drop/restore; just apply migrations.
    local mode
    case "${RESTORE_DB:-auto}" in
        force|always|1|yes|true)  mode=force ;;
        skip|never|0|no|false|none) mode=skip ;;
        *)                         mode=auto ;;
    esac

    if [ "$mode" = "skip" ]; then
        echo -e "${YELLOW}RESTORE_DB=skip — leaving existing database untouched (no drop/restore).${NC}"
        apply_post_restore_sql
        return 0
    fi

    # How much data is already there? (0 if DB/table is missing)
    local existing
    existing=$(psql -h localhost -p 5432 -U postgres -d zingbee-ultra -tAc \
        "SELECT count(*) FROM users" 2>/dev/null || echo "0")
    [ "$existing" -ge 0 ] 2>/dev/null || existing=0

    if [ "$mode" = "auto" ] && [ "$existing" -gt 0 ]; then
        echo -e "${GREEN}Database already populated ($existing users) — skipping restore.${NC}"
        echo -e "${CYAN}  (run with RESTORE_DB=force to drop and reload from the latest db/ backup)${NC}"
        apply_post_restore_sql
        return 0
    fi

    # Find the latest backup.sql file in the db/ folder (by modification time)
    local latest
    latest=$(ls -t "$ROOT_DIR"/db/*backup*.sql 2>/dev/null | head -1)
    if [ -z "$latest" ]; then
        echo -e "${YELLOW}No backup SQL file found in db/ — skipping restore.${NC}"
        apply_post_restore_sql
        return 0
    fi

    if [ "$existing" -gt 0 ]; then
        echo -e "${YELLOW}RESTORE_DB=force — dropping existing data ($existing users) and reloading.${NC}"
    fi
    echo -e "${CYAN}Restoring database from $(basename "$latest")...${NC}"
    # Ensure the database exists
    psql -h localhost -p 5432 -U postgres -tc \
        "SELECT 1 FROM pg_database WHERE datname = 'zingbee-ultra'" 2>/dev/null \
        | grep -q 1 \
        || psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE \"zingbee-ultra\";" -q 2>&1
    # Drop all objects inside the database (avoids DROP DATABASE recovery delay)
    psql -h localhost -p 5432 -U postgres -d zingbee-ultra -q -c \
        "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>&1 || true
    # Restore from backup (strip pg_dump meta-cmds / newer GUCs for cross-version restores)
    sed '/\\restrict/d; /\\unrestrict/d; /transaction_timeout/d' "$latest" \
        | psql -h localhost -p 5432 -U postgres -d zingbee-ultra -q 2>&1 | tail -1
    # Verify restore succeeded
    local count
    count=$(psql -h localhost -p 5432 -U postgres -d zingbee-ultra -tAc "SELECT count(*) FROM users" 2>/dev/null || echo "0")
    if [ "$count" -gt 0 ] 2>/dev/null; then
        echo -e "${GREEN}Database restored from $(basename "$latest") ($count users)${NC}"
    else
        echo -e "${RED}Database restore may have failed — check db/ backup file${NC}"
    fi
    apply_post_restore_sql
}

ensure_node_modules() {
    local dir="$1"
    local name="$(basename "$dir")"
    if [ ! -d "$dir/node_modules" ]; then
        echo -e "${YELLOW}Installing npm dependencies for ${name}...${NC}"
        (cd "$dir" && npm install --no-fund --no-audit --loglevel=warn)
    fi
}

ensure_python_deps() {
    local req="$ROOT_DIR/api/requirements.txt"
    if [ ! -f "$req" ]; then
        return 0
    fi
    # Quick check: try importing livekit as a canary for missing deps
    if ! "$PYTHON" -c "import livekit" 2>/dev/null; then
        echo -e "${YELLOW}Installing Python dependencies...${NC}"
        "$PYTHON" -m pip install -q -r "$req"
    fi
}

# ── Service management ─────────────────────────────────────────────

stop_all() {
    echo -e "${YELLOW}Stopping all dev services...${NC}"
    if [ -f "$PIDFILE" ]; then
        while read -r pid name; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null && echo -e "  Stopped ${name} (pid $pid)"
            fi
        done < "$PIDFILE"
        rm -f "$PIDFILE"
    fi
    # Kill any orphaned Next.js processes from this project
    pkill -9 -f "next dev.*${ROOT_DIR##*/}/clients/" 2>/dev/null || true
    pkill -9 -f "next-server.*${ROOT_DIR##*/}/clients/" 2>/dev/null || true
    # Force kill any stragglers on our ports
    sleep 1
    for port in $API_PORT $RED_TEAM_PORT $ACADEMY_PORT $ADMIN_PORT; do
        pids=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill -9 2>/dev/null || true
        fi
    done
    sleep 1
    echo -e "${GREEN}All services stopped.${NC}"
}

# Helper: resolve next binary for a client directory
next_cmd() {
    local dir="$1"
    if [ -x "$dir/node_modules/.bin/next" ]; then
        echo "$dir/node_modules/.bin/next"
    else
        echo "npx next"
    fi
}

start_api() {
    echo -e "${CYAN}Starting API on port $API_PORT...${NC}"
    (cd "$ROOT_DIR/api" && "$PYTHON" web_ui.py --port $API_PORT) &
    echo "$! api" >> "$PIDFILE"
}

start_livekit() {
    echo -e "${CYAN}Starting LiveKit agent...${NC}"
    (cd "$ROOT_DIR/api/livekit" && "$PYTHON" livekit_agent.py dev) &
    echo "$! livekit" >> "$PIDFILE"
}

start_red_team() {
    ensure_node_modules "$ROOT_DIR/clients/red-team"
    echo -e "${CYAN}Starting Red Team client on port $RED_TEAM_PORT...${NC}"
    (cd "$ROOT_DIR/clients/red-team" && $(next_cmd "$ROOT_DIR/clients/red-team") dev --port $RED_TEAM_PORT) &
    echo "$! red-team" >> "$PIDFILE"
}

start_academy() {
    ensure_node_modules "$ROOT_DIR/clients/academy"
    echo -e "${CYAN}Starting Academy client on port $ACADEMY_PORT...${NC}"
    (cd "$ROOT_DIR/clients/academy" && $(next_cmd "$ROOT_DIR/clients/academy") dev --port $ACADEMY_PORT) &
    echo "$! academy" >> "$PIDFILE"
}

start_admin() {
    ensure_node_modules "$ROOT_DIR/clients/admin"
    echo -e "${CYAN}Starting Admin client on port $ADMIN_PORT...${NC}"
    (cd "$ROOT_DIR/clients/admin" && $(next_cmd "$ROOT_DIR/clients/admin") dev --port $ADMIN_PORT) &
    echo "$! admin" >> "$PIDFILE"
}

# ── Handle arguments ───────────────────────────────────────────────

# Register cleanup trap early so Ctrl+C during startup also cleans up
trap "stop_all; exit 0" SIGINT SIGTERM

SERVICE="${1:-all}"

case "$SERVICE" in
    stop)
        stop_all
        exit 0
        ;;
    api)
        stop_all 2>/dev/null
        ensure_postgres
        restore_db
        ensure_python_deps
        start_api
        ;;
    red-team)
        start_red_team
        ;;
    academy)
        start_academy
        ;;
    admin)
        start_admin
        ;;
    livekit)
        ensure_python_deps
        start_livekit
        ;;
    all)
        stop_all 2>/dev/null
        rm -f "$PIDFILE"

        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  ZingBee Ultra - Dev Server Launcher   ${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""

        # 1. Infrastructure: PostgreSQL
        ensure_postgres

        # 2. Restore latest DB backup
        restore_db

        # 3. Python dependencies (for API + LiveKit)
        ensure_python_deps

        # 4. Node dependencies (install in parallel)
        echo -e "${CYAN}Checking npm dependencies for all clients...${NC}"
        ensure_node_modules "$ROOT_DIR/clients/red-team" &
        pid1=$!
        ensure_node_modules "$ROOT_DIR/clients/academy" &
        pid2=$!
        ensure_node_modules "$ROOT_DIR/clients/admin" &
        pid3=$!

        failed=0
        for pid in $pid1 $pid2 $pid3; do
            wait "$pid" || { echo -e "${RED}npm install failed (pid $pid)${NC}"; failed=1; }
        done
        if [ "$failed" -ne 0 ]; then
            echo -e "${RED}Aborting: one or more npm installs failed${NC}"
            exit 1
        fi
        echo -e "${GREEN}All dependencies ready${NC}"
        echo ""

        # 5. Start services
        start_api
        start_livekit
        start_red_team
        sleep 2
        start_academy
        sleep 2
        start_admin

        echo ""
        echo -e "${GREEN}All services started:${NC}"
        echo -e "  PostgreSQL:     ${CYAN}localhost:5432${NC}"
        echo -e "  API:            ${CYAN}https://localhost:${API_PORT}${NC}"
        echo -e "  LiveKit Agent:  ${CYAN}running${NC}"
        echo -e "  Red Team:       ${CYAN}http://localhost:${RED_TEAM_PORT}${NC}"
        echo -e "  Academy:        ${CYAN}http://localhost:${ACADEMY_PORT}${NC}"
        echo -e "  Admin:          ${CYAN}http://localhost:${ADMIN_PORT}${NC}"
        echo ""
        echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
        echo ""
        ;;
    *)
        echo "Usage: ./run-dev.sh [api|livekit|red-team|academy|admin|stop|all]"
        exit 1
        ;;
esac

# Wait for all background processes
wait
