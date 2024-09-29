#!/bin/bash
export NODE_ENV=prod
export NODE_NO_WARNINGS=1

# Iniciar o app e redirecionar a saída para o stdout
nohup node --no-deprecation app-tvi-cluster.js > /dev/stdout 2> /dev/stderr &