#!/bin/bash

LAYER="$1"
WINDOW="$2"
IMAGE_FILE="$3"

GDALTMS_URL="http://localhost:5000/source/$LAYER"
GDAL_PARAMS="-of PNG -co WORLDFILE=YES -tr 30 30 -projwin $WINDOW"
CONVER_PARAMS="-auto-level -auto-gamma -channel RGB -contrast-stretch 0.5%x0.5%"

mkdir -p $(dirname $IMAGE_FILE)
curl -s $GDALTMS_URL | gdal_translate $GDAL_PARAMS /vsistdin/ /vsistdout/ | convert - $CONVER_PARAMS $IMAGE_FILE