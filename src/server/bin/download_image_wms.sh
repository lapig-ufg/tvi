#!/bin/bash

LON="$1"
LAT="$2"
BBOX=$(bbox --lon $LON --lat $LAT)
WMS_URL=$(echo $3 | sed "s/{bbox}/$BBOX/")

IMAGE_FILE="$4"
WMS_CREDENTIALS="$5"

BASEDIR=$(dirname "$0")

mkdir -p $(dirname "$IMAGE_FILE")

USER_AGENT="Mozilla/5.0 QGIS/32809/KDE Flatpak runtime"

# Check if WMS_CREDENTIALS is not empty, null, or undefined
if [ -n "$WMS_CREDENTIALS" ]; then
    # If credentials are provided, encode them and add the Authorization header to the curl command
#    ENCODED_CREDENTIALS=$(echo -n "$WMS_CREDENTIALS" | base64)
#    echo "curl -s -H \"User-Agent: ${USER_AGENT}\" -H \"Authorization: Basic ${WMS_CREDENTIALS}\" \"${WMS_URL}\" > \"${IMAGE_FILE}\""

    curl -s -H "User-Agent: ${USER_AGENT}" -H "Authorization: Basic $WMS_CREDENTIALS" "$WMS_URL" > "$IMAGE_FILE"
else
    # If no credentials are provided, proceed without the Authorization header
    curl -s "$WMS_URL" > "$IMAGE_FILE"
fi

python3 "$BASEDIR/enhance_img_clahe.py" "$IMAGE_FILE"
