#!/usr/bin/env bash
# simulate/cleanup.sh
# ÚNICO script da simulação que apaga dados.
# Mata o servidor de simulação (porta 3001) e dropa o banco tvi_sim.
# Pede confirmação interativa antes de qualquer ação destrutiva.

set -euo pipefail

DB_NAME="${TVI_SIM_DB:-tvi_sim}"
PORT="${TVI_SIM_PORT:-3000}"
MONGO_PORT="${TVI_SIM_MONGO_PORT:-27019}"

echo "=========================================================="
echo "CLEANUP DA SIMULAÇÃO TVI"
echo "  Banco MongoDB que será DROPADO: ${DB_NAME} (porta ${MONGO_PORT})"
echo "  Porta do servidor TVI que será MORTA: ${PORT}"
echo "  (Container Docker tvi-sim-mongo NÃO é removido por este script)"
echo "=========================================================="
echo ""
echo "Esta ação é IRREVERSÍVEL. Toda evidência da simulação"
echo "(audit log, release log, sessões, pontos, blocos) será perdida."
echo ""
read -r -p "Digite 'CLEANUP' (em maiúsculas) para confirmar: " ANSWER
if [[ "$ANSWER" != "CLEANUP" ]]; then
    echo "Cancelado."
    exit 1
fi

echo ""
echo "[cleanup] Procurando processos do servidor de simulação na porta ${PORT}..."
PIDS=$(lsof -ti tcp:"${PORT}" 2>/dev/null || true)
if [[ -n "${PIDS}" ]]; then
    echo "[cleanup] Matando PIDs: ${PIDS}"
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 ${PIDS} 2>/dev/null || true
else
    echo "[cleanup] Nenhum processo na porta ${PORT}"
fi

echo ""
echo "[cleanup] Dropando banco ${DB_NAME} no Mongo ${MONGO_PORT}..."
mongosh "mongodb://localhost:${MONGO_PORT}/${DB_NAME}" --quiet --eval 'db.dropDatabase()' || {
    echo "[cleanup] ERRO ao dropar banco. Verifique se mongo está acessível em localhost:${MONGO_PORT}."
    exit 1
}

echo ""
echo "[cleanup] Limpando cookies temporários e logs do servidor..."
rm -f /tmp/sim-cookies-*.txt /tmp/tvi-sim-server.log

echo ""
echo "[cleanup] OK. Para reiniciar a simulação: node simulate/setup-test-campaign.js"
