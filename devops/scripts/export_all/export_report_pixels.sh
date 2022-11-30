#!/bin/bash

mongo --quiet 172.18.0.6:27017/tvi --eval "var campaign = '$1'" export_mongo.js > csv/$1.csv