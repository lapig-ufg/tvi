if [ "$#" -lt 4 ]; then
    echo "Uso: $0 <lon> <lat> <wms_template_url> <image_file> [wms_credentials_base64]"
    exit 1
fi

LON="$1"
LAT="$2"
TEMPLATE="$3"
IMAGE_FILE="$4"
WMS_CREDENTIALS="$5"

# Extrai o valor do parâmetro version= da URL
WMS_VERSION=$(echo "$TEMPLATE" | grep -oP '(?<=version=)[^&]*')

# Default para 1.1.0 caso não encontrado
if [ -z "$WMS_VERSION" ]; then
    WMS_VERSION="1.1.0"
fi

echo "[INFO] WMS version detectada: $WMS_VERSION"

# Executa o bbox com a versão correta
BBOX=$(bbox --lon "$LON" --lat "$LAT" --wms_version "$WMS_VERSION") || {
    echo "Erro: comando bbox falhou"
    exit 1
}

WMS_URL="${TEMPLATE/\{bbox\}/$BBOX}"

mkdir -p "$(dirname "$IMAGE_FILE")"

USER_AGENT="Mozilla/5.0 QGIS/32809/KDE Flatpak runtime"

echo "[INFO] URL gerada: $WMS_URL"

if [ -n "$WMS_CREDENTIALS" ]; then
    curl -f -s -L -H "User-Agent: ${USER_AGENT}" -H "Authorization: Basic $WMS_CREDENTIALS" "$WMS_URL" > "$IMAGE_FILE"
else
    curl -f -s -L -H "User-Agent: ${USER_AGENT}" "$WMS_URL" > "$IMAGE_FILE"
fi
