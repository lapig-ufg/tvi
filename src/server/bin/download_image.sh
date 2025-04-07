#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# USO:  ./get_tile.sh <GDALTMS_URL> "<minX maxY maxX minY>" <saida.png> [magick|gdal]
###############################################################################
[[ $# -lt 3 ]] && {
  echo "Uso: $0 GDALTMS_URL \"minX maxY maxX minY\" IMG_SAIDA [magick|gdal]" >&2
  exit 1
}

GDALTMS_URL="$1"
WINDOW="$2"
IMAGE_FILE="$3"
TYPE="${4:-gdal}"

#-------------------- Parâmetros ajustáveis --------------------
PIX_SIZE=30
TIMEOUT="${TIMEOUT:-120}"          # seg. p/ cada request
MAX_RETRY="${MAX_RETRY:-5}"
RETRY_DELAY="${RETRY_DELAY:-3}"

#-------------------- Flags de ambiente GDAL -------------------
export GDAL_HTTP_TIMEOUT="$TIMEOUT"
export GDAL_HTTP_MAX_RETRY="$MAX_RETRY"
export GDAL_HTTP_RETRY_DELAY="$RETRY_DELAY"
export GDAL_HTTP_ZERO_BLOCK_CODES=429
export CPL_CURL_CONNECTTIMEOUT=30

GDAL_PARAMS=(
  -of PNG
  -co WORLDFILE=YES
  -ot Byte
  -tr "$PIX_SIZE" "$PIX_SIZE"
  -projwin $WINDOW
  --config GDAL_HTTP_TIMEOUT "$TIMEOUT"
  --config GDAL_HTTP_MAX_RETRY "$MAX_RETRY"
  --config GDAL_HTTP_RETRY_DELAY "$RETRY_DELAY"
)

CONVERT_PARAMS="-auto-level -auto-gamma -channel RGB -contrast-stretch 0.5%x0.5%"

mkdir -p "$(dirname "$IMAGE_FILE")"

#-------------------- Verifica se curl tem --retry-all-errors ----
if curl --help 2>&1 | grep -q -- '--retry-all-errors'; then
  CURL_RETRY_ALL_ERRORS='--retry-all-errors'
else
  CURL_RETRY_ALL_ERRORS=''
fi

#-------------------- Função de download + gdal -----------------
download_and_translate() {
  local OUT="$1"        # /vsistdout/  ou  arquivo final

  # 1ª tentativa: stream direto via /vsistdin/
  if ! curl -sSL --retry "$MAX_RETRY" --retry-delay "$RETRY_DELAY" $CURL_RETRY_ALL_ERRORS \
          --connect-timeout 30 --max-time "$TIMEOUT" \
          "$GDALTMS_URL" \
      | gdal_translate "${GDAL_PARAMS[@]}" /vsistdin/ "$OUT"; then

    echo "⚠️  Falha usando /vsistdin/. Tentando fallback com arquivo temporário…" >&2

    # 2ª tentativa: salva XML em tmp e chama gdal_translate sobre ele
    local TMPXML
    TMPXML=$(mktemp /tmp/gdal_wms_XXXXXX.xml)
    curl -sSL --retry "$MAX_RETRY" --retry-delay "$RETRY_DELAY" $CURL_RETRY_ALL_ERRORS \
         --connect-timeout 30 --max-time "$TIMEOUT" \
         -o "$TMPXML" "$GDALTMS_URL"

    gdal_translate "${GDAL_PARAMS[@]}" "$TMPXML" "$OUT"
    rm -f "$TMPXML"
  fi
}

#-------------------- Pipeline principal ------------------------
if [[ "$TYPE" == "magick" ]]; then
  # GDAL → ImageMagick
  download_and_translate /vsistdout/ \
  | convert - $CONVERT_PARAMS "$IMAGE_FILE"
else
  # GDAL + pós‑processamento em Python
  download_and_translate "$IMAGE_FILE"
  python3 "$(dirname "$0")/enhance_img_clahe.py" "$IMAGE_FILE"
fi
