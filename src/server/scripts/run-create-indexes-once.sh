#!/bin/bash

# Script para executar a criação de índices apenas uma vez

echo "================================================"
echo "Script de criação de índices do MongoDB para TVI"
echo "================================================"
echo ""

# Verificar se os índices já foram criados
INDEXES_CHECK=$(mongo tvi --quiet --eval "db.campaign.getIndexes().length")

if [ "$INDEXES_CHECK" -gt "1" ]; then
    echo "✅ Os índices já foram criados anteriormente."
    echo "   Não é necessário executar novamente."
    exit 0
fi

echo "🔨 Criando índices no MongoDB..."
echo ""

# Executar o script de criação de índices
mongo tvi scripts/create-indexes-mongo-shell.js

echo ""
echo "✅ Script concluído!"
echo ""
echo "ℹ️  Para verificar os índices criados, execute:"
echo "   mongo tvi --eval \"db.campaign.getIndexes()\""
echo "   mongo tvi --eval \"db.points.getIndexes()\""
echo "   mongo tvi --eval \"db.users.getIndexes()\""