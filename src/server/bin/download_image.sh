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


#/home/leandro/Projects/tvi/src/server/bin/download_image.sh "http://tvi.lapig.iesa.ufg.br/source/L5_1991_DRY?campaign=mapbiomas_100k_etapa04" "-5017534.247515638 -2593694.629961764 -5009534.247515638 -2601694.629961764" L5_1991_DRY.png
#/home/leandro/Projects/tvi/src/server/bin/download_image.sh "http://tvi.lapig.iesa.ufg.br/source/L8_2016_DRY?campaign=mapbiomas_100k_etapa04"  "-4912174.247515638 -2266370.61354541 -4904174.247515638 -2274370.61354541" L8_2016_DRY.png
#/home/leandro/Projects/tvi/src/server/bin/download_image.sh "http://tvi.lapig.iesa.ufg.br/source/L5_2006_DRY?campaign=mapbiomas_100k_etapa04" "-6045544.247515638 -2851315.5841258336 -6037544.247515638 -2859315.5841258336" L5_2006_DRY.png
#/home/leandro/Projects/tvi/src/server/bin/download_image.sh "http://tvi.lapig.iesa.ufg.br/source/L5_1992_DRY?campaign=mapbiomas_100k_etapa04" "-5383654.247515639 -2830504.0989739136 -5375654.247515639 -2838504.0989739136" L5_1992_DRY.png