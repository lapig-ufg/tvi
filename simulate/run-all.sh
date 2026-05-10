#!/usr/bin/env bash
# simulate/run-all.sh
# Orquestra a simulação end-to-end (Fases A → E) em uma única execução.
# NÃO faz cleanup do banco ao final — preserva todos os dados em tvi_sim
# e mantém o servidor TVI rodando em background para inspeção manual.
#
# Pré-requisitos:
#   - Mongo 4.4 em container docker tvi-sim-mongo, porta 27019
#     (subir com: docker run -d --name tvi-sim-mongo -p 27019:27017 \
#                              -v tvi-sim-mongo-data:/data/db mongo:4.4)
#   - Mongo 6.x driver instalado em /tmp/test-mongo-deps (npm i mongodb@6)
#   - mongosh disponível
#   - Node 18+
#
# Para começar do zero, primeiro rode: bash simulate/cleanup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIMULATE="$ROOT/simulate"
SERVER_LOG="/tmp/tvi-sim-server.log"

PORT="${TVI_SIM_PORT:-3000}"
MONGO_PORT="${TVI_SIM_MONGO_PORT:-27019}"

echo "==========================================================="
echo "TVI SIMULAÇÃO END-TO-END"
echo "  servidor TVI    : http://localhost:${PORT}"
echo "  Mongo simulação : mongodb://localhost:${MONGO_PORT}/tvi_sim"
echo "==========================================================="

# (1) container mongo OK?
if ! docker ps --filter name=tvi-sim-mongo --filter status=running --format '{{.Names}}' | grep -q tvi-sim-mongo; then
    echo "[run-all] ERRO: container tvi-sim-mongo não está rodando."
    echo "[run-all] Inicie com: docker start tvi-sim-mongo"
    echo "[run-all]    ou:     docker run -d --name tvi-sim-mongo -p 27019:27017 \\"
    echo "[run-all]              -v tvi-sim-mongo-data:/data/db mongo:4.4"
    exit 1
fi
echo "[run-all] (1/8) container Mongo 4.4 ativo"

# (2) setup fixtures
echo "[run-all] (2/8) setup fixtures (campanha + 500 pontos + super-admin)"
node "$SIMULATE/setup-test-campaign.js"

# (3) install validator
echo "[run-all] (3/8) instalar schema validator em points"
mongosh "mongodb://localhost:${MONGO_PORT}/tvi_sim" --quiet --file "$SIMULATE/install-validator.mongosh.js" | tail -3

# (4) start server (background) se ainda não estiver rodando
if ! /usr/bin/curl -sf -m 2 "http://localhost:${PORT}/login" > /dev/null 2>&1; then
    echo "[run-all] (4/8) subindo servidor TVI em background (log $SERVER_LOG)"
    cd "$ROOT/src/server"
    rm -f "$SERVER_LOG"
    NODE_OPTIONS='--openssl-legacy-provider' \
    NODE_ENV=dev MONGO_HOST=localhost MONGO_PORT="${MONGO_PORT}" MONGO_DATABASE=tvi_sim \
    ALLOWED_ORIGINS="http://localhost:${PORT}" ALLOWED_HOSTS="localhost:${PORT}" \
        node app-tvi-cluster.js > "$SERVER_LOG" 2>&1 &
    SERVER_PID=$!
    disown 2>/dev/null || true
    cd - > /dev/null

    # aguardar até 30s
    for i in $(seq 1 30); do
        if /usr/bin/curl -sf -m 1 "http://localhost:${PORT}/login" > /dev/null 2>&1; then
            echo "[run-all]   server up depois de ${i}s (PID $SERVER_PID)"
            break
        fi
        sleep 1
    done
else
    echo "[run-all] (4/8) servidor TVI já está respondendo em ${PORT}"
fi

# (5) gerar blocos
echo "[run-all] (5/8) gerar blocos (200 = 100 × 2 rounds)"
bash "$SIMULATE/generate-blocks.sh" | tail -3

# (6) Fase A — 50 agentes
echo "[run-all] (6/8) Fase A: 50 agentes concorrentes"
node "$SIMULATE/inspector-agents.js" --port="${PORT}" --inspectors-count=50 | tail -25

# (7) Fase C — timeout
echo "[run-all] (7/8) Fase C: timeout + release log"
node "$SIMULATE/timeout-scenario.js" | tail -15

# (7b) Fase D — ownership shadow
echo "[run-all] (7/8) Fase D: ownership shadow (modo sombra)"
node "$SIMULATE/ownership-shadow-test.js" | tail -15

# (8) Fase E — verificação consolidada
echo "[run-all] (8/8) Fase E: verificação final consolidada"
node "$SIMULATE/verify-final-state.js"

echo ""
echo "==========================================================="
echo "SIMULAÇÃO CONCLUÍDA — DADOS PRESERVADOS"
echo "  servidor TVI    : http://localhost:${PORT}  (deixado rodando)"
echo "  banco           : mongodb://localhost:${MONGO_PORT}/tvi_sim"
echo "  results JSON    : $SIMULATE/results/"
echo "  server log      : $SERVER_LOG"
echo "  cookies agentes : /tmp/sim-cookies-*.txt"
echo ""
echo "Para inspecionar:"
echo "  bash $SIMULATE/inspect-results.sh"
echo "  mongosh \"mongodb://localhost:${MONGO_PORT}/tvi_sim\""
echo ""
echo "Para apagar tudo e recomeçar:"
echo "  bash $SIMULATE/cleanup.sh"
echo "==========================================================="
