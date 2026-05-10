#!/usr/bin/env bash
# simulate/generate-blocks.sh
# Faz login admin e dispara POST /api/campaigns/:id/generate-blocks no
# servidor TVI da simulação (porta 3000 por padrão). Idempotente:
# se o backend retornar 409 (blocos já existem), considera sucesso.

set -euo pipefail

PORT="${TVI_SIM_PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
CAMPAIGN_ID="${TVI_SIM_CAMPAIGN:-simulation_test_campaign}"
BLOCK_SIZE="${TVI_SIM_BLOCK_SIZE:-5}"
TIMEOUT_MIN="${TVI_SIM_TIMEOUT_MIN:-480}"
ADMIN_USER="${TVI_SIM_ADMIN_USER:-admin}"
ADMIN_PASS="${TVI_SIM_ADMIN_PASS:-admin123}"

ORIGIN="${BASE_URL}"
COOKIE_JAR="/tmp/sim-cookies-admin.txt"

echo "[generate-blocks] login admin em ${BASE_URL}/api/admin/login"
LOGIN_RESP=$(/usr/bin/curl -sS -c "${COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN}" \
    -X POST "${BASE_URL}/api/admin/login" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")

if ! echo "${LOGIN_RESP}" | grep -q '"success":true'; then
    echo "[generate-blocks] LOGIN ADMIN FALHOU: ${LOGIN_RESP}"
    exit 1
fi
echo "[generate-blocks] admin OK"

echo "[generate-blocks] gerando blocos para campanha ${CAMPAIGN_ID} (blockSize=${BLOCK_SIZE} timeoutMin=${TIMEOUT_MIN})"
GEN_RESP=$(/usr/bin/curl -sS -b "${COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN}" \
    -X POST "${BASE_URL}/api/campaigns/${CAMPAIGN_ID}/generate-blocks" \
    -d "{\"blockSize\":${BLOCK_SIZE},\"timeoutMinutes\":${TIMEOUT_MIN}}")

echo "[generate-blocks] resposta: ${GEN_RESP}"

if echo "${GEN_RESP}" | grep -q '"success":true'; then
    echo "[generate-blocks] OK"
    exit 0
fi

if echo "${GEN_RESP}" | grep -qi 'já possui blocos'; then
    echo "[generate-blocks] blocos já existiam (409); tratado como OK (idempotente)"
    exit 0
fi

echo "[generate-blocks] FALHA inesperada"
exit 1
