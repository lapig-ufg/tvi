#!/usr/bin/env bash
# Backup diário do banco MongoDB do TVI (Tier 3.1 — 2026-05-09).
#
# Implementa a etapa operacional do plano de defesa contra perda de
# inspeções (clever-dreaming-pudding.md §3.1). Cria um dump compacto
# (gzip) por dia, com retenção local de 30 dias. O sync para storage
# offsite (S3 versioned ou equivalente) deve ser feito via cron separado
# ou rclone configurado pela equipe de infraestrutura.
#
# Variáveis de ambiente esperadas (defaults entre parênteses):
#   MONGO_URI       URI completa do MongoDB de origem (mongodb://localhost:27017)
#   MONGO_DB        Nome do banco a fazer dump                (tvi)
#   BACKUP_DIR      Diretório local de saída                  (/var/backups/tvi)
#   RETAIN_DAYS     Dias de retenção local                    (30)
#   USE_DOCKER      "1" para rodar mongodump via docker       (0)
#   DOCKER_IMAGE    Imagem docker do mongo                    (mongo:7)
#
# Uso recomendado em cron (crontab -e como o usuário responsável):
#
#   # Backup diário às 03:00 — gera tvi-YYYYMMDD.archive.gz e remove
#   # arquivos com mais de RETAIN_DAYS dias automaticamente.
#   0 3 * * * /opt/tvi/devops/scripts/backup-tvi-daily.sh >> /var/log/tvi-backup.log 2>&1
#
# Para verificar a integridade de um arquivo gerado:
#   mongorestore --archive=/var/backups/tvi/tvi-YYYYMMDD.archive.gz \
#                --gzip --dryRun --nsInclude='tvi.*'

set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
MONGO_DB="${MONGO_DB:-tvi}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tvi}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
USE_DOCKER="${USE_DOCKER:-0}"
DOCKER_IMAGE="${DOCKER_IMAGE:-mongo:7}"

TS="$(date +%Y%m%d-%H%M)"
OUT="${BACKUP_DIR}/${MONGO_DB}-${TS}.archive.gz"
LATEST_LINK="${BACKUP_DIR}/${MONGO_DB}-latest.archive.gz"

echo "[$(date -Iseconds)] backup start uri=${MONGO_URI} db=${MONGO_DB} out=${OUT}"

mkdir -p "${BACKUP_DIR}"

if [[ "${USE_DOCKER}" == "1" ]]; then
    docker run --rm --network host \
        -v "${BACKUP_DIR}:/backup" \
        "${DOCKER_IMAGE}" \
        mongodump --uri="${MONGO_URI}" --db="${MONGO_DB}" \
                  --gzip --archive="/backup/$(basename "${OUT}")"
else
    mongodump --uri="${MONGO_URI}" --db="${MONGO_DB}" \
              --gzip --archive="${OUT}"
fi

# Atualizar symlink "latest" (atomic via rename)
TMP_LINK="${LATEST_LINK}.tmp"
ln -sf "$(basename "${OUT}")" "${TMP_LINK}"
mv -f "${TMP_LINK}" "${LATEST_LINK}"

# Limpeza por retenção (remove apenas .archive.gz com mtime > RETAIN_DAYS)
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${MONGO_DB}-*.archive.gz" -mtime +"${RETAIN_DAYS}" -print -delete | wc -l)

SIZE=$(du -h "${OUT}" | awk '{print $1}')
echo "[$(date -Iseconds)] backup ok size=${SIZE} retain_deleted=${DELETED}"
