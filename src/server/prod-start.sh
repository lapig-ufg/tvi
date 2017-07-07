#!/bin/bash
export NODE_ENV=prod; nohup node app-tvi-cluster.js &> app.out &
