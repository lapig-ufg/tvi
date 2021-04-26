#!/bin/bash

GDALTMS_URL="$1"
WINDOW="$2"
IMAGE_FILE="$3"
TYPE="$4"

BASEDIR=$(dirname "$0")

GDAL_PARAMS="-of PNG -co WORLDFILE=YES -ot Byte -tr 30 30 -projwin $WINDOW"
CONVER_PARAMS="-auto-level -auto-gamma -channel RGB -contrast-stretch 0.5%x0.5%"

mkdir -p $(dirname $IMAGE_FILE)

if [ "$TYPE" == "magick" ]; then
	curl -s $GDALTMS_URL | gdal_translate $GDAL_PARAMS /vsistdin/ /vsistdout/ | convert - $CONVER_PARAMS $IMAGE_FILE
else
	curl -s $GDALTMS_URL | gdal_translate $GDAL_PARAMS /vsistdin/ $IMAGE_FILE
	python3 $BASEDIR/enhance_img_clahe.py $IMAGE_FILE
fi
