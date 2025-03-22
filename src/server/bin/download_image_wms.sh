#!/bin/bash

LON="$1"
LAT="$2"
BBOX=$(bbox --lon $LON --lat $LAT)
WMS_URL=$(echo $3 | sed "s/{bbox}/$BBOX/")

echo "WMS_URL: $WMS_URL"

IMAGE_FILE="$4"
WMS_CREDENTIALS="$5"

BASEDIR=$(dirname "$0")

mkdir -p $(dirname "$IMAGE_FILE")

USER_AGENT="Mozilla/5.0 QGIS/32809/KDE Flatpak runtime"

# Função para verificar se o arquivo foi baixado com sucesso
check_file() {
    if [ -f "$IMAGE_FILE" ] && [ -s "$IMAGE_FILE" ]; then
        return 0  # Arquivo existe e não está vazio
    else
        return 1  # Arquivo não existe ou está vazio
    fi
}

# Baixa a imagem usando curl
if [ -n "$WMS_CREDENTIALS" ]; then
    # Com credenciais
    curl -f -s -L -H "User-Agent: ${USER_AGENT}" -H "Authorization: Basic $WMS_CREDENTIALS" "$WMS_URL" > "$IMAGE_FILE"
else
    # Sem credenciais
    curl -f -s -L "$WMS_URL" > "$IMAGE_FILE"
fi

# Verifica se o arquivo foi baixado com sucesso
if check_file; then
    echo "Arquivo baixado com sucesso: $IMAGE_FILE"
    # Executa o script Python para processar a imagem
     python3 "$BASEDIR/enhance_img_clahe.py" "$IMAGE_FILE"
else
    echo "Erro: O arquivo não foi baixado ou está vazio: $IMAGE_FILE"
fi
