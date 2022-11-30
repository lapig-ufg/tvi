#!/bin/bash

LON="$1"
LAT="$2"

BBOX=$(bbox --lon $LON  --lat $LAT)
WMS_URL=$(echo $3 | sed  "s/{bbox}/$BBOX/")

IMAGE_FILE="$4"

BASEDIR=$(dirname "$0")

mkdir -p $(dirname $IMAGE_FILE)

curl -s $WMS_URL > $IMAGE_FILE

python3 $BASEDIR/enhance_img_clahe.py $IMAGE_FILE
