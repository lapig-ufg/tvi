// Script para otimizar consultas específicas do sistema TVI
// Contém índices adicionais baseados nos padrões de uso identificados

print("Iniciando otimizações avançadas...");

// Conectar ao banco
db = db.getSiblingDB('tvi');

print("Criando índices compostos otimizados para consultas frequentes...");

// Índice otimizado para consulta de progresso de campanhas
// Usado em: CampaignCrud.list() para calcular totalPoints e completedPoints
try {
    db.points.createIndex({ 
        "campaign": 1, 
        "userName": 1 
    }, { 
        name: "campaign_progress_optimized",
        background: true 
    });
    print("✓ Índice otimizado: points.campaign + userName (para progresso)");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Índice para consultas de paginação eficiente na listagem de campanhas
try {
    db.campaign.createIndex({ 
        "createdAt": -1,
        "_id": -1 
    }, { 
        name: "campaign_pagination_optimized",
        background: true 
    });
    print("✓ Índice otimizado: campaigns.createdAt + _id (para paginação)");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Índice sparse para campanhas com arquivos GeoJSON
try {
    db.campaign.createIndex({ 
        "geojsonFile": 1 
    }, { 
        name: "campaign_geojson_sparse",
        sparse: true,
        background: true 
    });
    print("✓ Índice sparse: campaigns.geojsonFile");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Índice para consultas de pontos por status de cache
try {
    db.points.createIndex({ 
        "campaign": 1,
        "cached": 1,
        "enhance_in_cache": 1
    }, { 
        name: "points_cache_status",
        background: true 
    });
    print("✓ Índice otimizado: points.campaign + cached + enhance_in_cache");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Índice para consultas geoespaciais avançadas
try {
    db.points.createIndex({ 
        "campaign": 1,
        "biome": 1,
        "uf": 1,
        "countyCode": 1
    }, { 
        name: "points_geographic_hierarchy",
        background: true 
    });
    print("✓ Índice hierárquico: points.campaign + biome + uf + countyCode");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Índice para inspeções ativas
try {
    db.points.createIndex({ 
        "campaign": 1,
        "underInspection": 1,
        "userName": 1
    }, { 
        name: "points_active_inspections",
        background: true 
    });
    print("✓ Índice otimizado: points.campaign + underInspection + userName");
} catch (e) {
    print("Erro ou já existe:", e.message);
}

// Configurar opções de performance para as coleções
print("\nOtimizando configurações de performance...");

// Verificar se há estatísticas de uso para otimizar
try {
    print("\n📊 Análise de uso das coleções:");
    
    var campaignStats = db.campaign.stats();
    print("Campaigns - Tamanho: " + (campaignStats.size / 1024).toFixed(2) + " KB");
    print("Campaigns - Índices: " + (campaignStats.totalIndexSize / 1024).toFixed(2) + " KB");
    
    var pointsStats = db.points.stats();
    print("Points - Tamanho: " + (pointsStats.size / 1024).toFixed(2) + " KB");
    print("Points - Índices: " + (pointsStats.totalIndexSize / 1024).toFixed(2) + " KB");
    
} catch (e) {
    print("Erro ao obter estatísticas:", e.message);
}

// Sugestões de otimização baseadas no código analisado
print("\n💡 Sugestões de otimização implementadas:");
print("1. Índice composto campaign + userName para cálculos de progresso rápidos");
print("2. Índice de paginação otimizado para listagem de campanhas");
print("3. Índice sparse para campanhas com arquivos GeoJSON");
print("4. Índice para status de cache dos pontos");
print("5. Índice hierárquico geográfico para filtros regionais");
print("6. Índice para inspeções ativas");

print("\n⚡ Dicas de performance para as consultas:");
print("• Use .limit() em todas as consultas paginadas");
print("• Evite .count() em coleções grandes, use .estimatedDocumentCount()");
print("• Use projeção para retornar apenas campos necessários");
print("• Para consultas $where, considere reescrever usando operadores nativos");

print("\n🎯 Consultas mais otimizadas agora:");
print("• Listagem paginada de campanhas ordenada por data");
print("• Contagem de pontos por campanha");
print("• Cálculo de progresso de campanhas");
print("• Consultas geográficas por região");
print("• Filtros por status de inspeção");

print("\n✅ Otimizações concluídas com sucesso!");