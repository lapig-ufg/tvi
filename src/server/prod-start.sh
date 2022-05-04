#!/bin/bash
export NODE_ENV=prod; export NODE_NO_WARNINGS=1; nohup node --no-deprecation app-tvi-cluster.js &> app.out &
