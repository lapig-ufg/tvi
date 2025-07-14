// Script para ser executado no MongoDB shell
// Para executar: mongo tvi scripts/create-indexes-mongo-shell.js

print("Iniciando criação de índices...");

// Conectar ao banco
db = db.getSiblingDB('tvi');

print("Criando índices para a coleção campaigns...");

// Índices para campaigns
try {
    db.campaign.createIndex({ "_id": -1 });
    print("✓ Índice criado: campaigns._id (desc)");
} catch (e) {
    print("Erro ao criar índice campaigns._id:", e.message);
}

try {
    db.campaign.createIndex({ "_id": -1, "createdAt": -1 });
    print("✓ Índice criado: campaigns._id + createdAt (desc)");
} catch (e) {
    print("Erro ao criar índice campaigns composto:", e.message);
}

print("\nCriando índices para a coleção points...");

// Índices para points (principais otimizações)
try {
    db.points.createIndex({ "campaign": 1 });
    print("✓ Índice criado: points.campaign");
} catch (e) {
    print("Erro ao criar índice points.campaign:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "userName": 1 });
    print("✓ Índice criado: points.campaign + userName");
} catch (e) {
    print("Erro ao criar índice points.campaign + userName:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "index": 1 });
    print("✓ Índice criado: points.campaign + index");
} catch (e) {
    print("Erro ao criar índice points.campaign + index:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "dateImport": -1 });
    print("✓ Índice criado: points.campaign + dateImport (desc)");
} catch (e) {
    print("Erro ao criar índice points.campaign + dateImport:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "underInspection": 1 });
    print("✓ Índice criado: points.campaign + underInspection");
} catch (e) {
    print("Erro ao criar índice points.campaign + underInspection:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "lat": 1, "lon": 1 });
    print("✓ Índice criado: points.campaign + lat + lon");
} catch (e) {
    print("Erro ao criar índice points geoespacial:", e.message);
}

try {
    db.points.createIndex({ "biome": 1, "uf": 1, "county": 1 });
    print("✓ Índice criado: points.biome + uf + county");
} catch (e) {
    print("Erro ao criar índice points região:", e.message);
}

try {
    db.points.createIndex({ "campaign": 1, "path": 1, "row": 1 });
    print("✓ Índice criado: points.campaign + path + row");
} catch (e) {
    print("Erro ao criar índice points tiles:", e.message);
}

print("\nCriando índices para a coleção users...");

// Índices para users
try {
    db.users.createIndex({ "username": 1 }, { unique: true });
    print("✓ Índice criado: users.username (unique)");
} catch (e) {
    print("Erro ao criar índice users.username:", e.message);
}

try {
    db.users.createIndex({ "role": 1 });
    print("✓ Índice criado: users.role");
} catch (e) {
    print("Erro ao criar índice users.role:", e.message);
}

try {
    db.users.createIndex({ "username": 1, "role": 1 });
    print("✓ Índice criado: users.username + role");
} catch (e) {
    print("Erro ao criar índice users composto:", e.message);
}

print("\n📊 Estatísticas dos índices criados:");

print("\nCAMPAIGNS:");
db.campaign.getIndexes().forEach(function(index) {
    var keys = Object.keys(index.key).map(function(k) {
        return k + ":" + index.key[k];
    }).join(", ");
    print("  - " + index.name + ": {" + keys + "}");
});

print("\nPOINTS:");
db.points.getIndexes().forEach(function(index) {
    var keys = Object.keys(index.key).map(function(k) {
        return k + ":" + index.key[k];
    }).join(", ");
    print("  - " + index.name + ": {" + keys + "}");
});

print("\nUSERS:");
db.users.getIndexes().forEach(function(index) {
    var keys = Object.keys(index.key).map(function(k) {
        return k + ":" + index.key[k];
    }).join(", ");
    print("  - " + index.name + ": {" + keys + "}");
});

// Mostrar estatísticas de performance
print("\n📈 Estatísticas das coleções:");
print("Campaigns: " + db.campaign.count() + " documentos");
print("Points: " + db.points.count() + " documentos");
print("Users: " + db.users.count() + " documentos");

print("\n🎉 Criação de índices finalizada!");