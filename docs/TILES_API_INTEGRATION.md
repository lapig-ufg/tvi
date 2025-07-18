# Integração com a Nova API de Tiles - TVI Backend

## Visão Geral

Este documento descreve a integração do backend do TVI com a nova API de Tiles local. A integração foi projetada para permitir uma migração gradual do sistema legado (tiles.lapig.iesa.ufg.br) para a nova API local.

## Configuração

### Variáveis de Ambiente

Configure as seguintes variáveis de ambiente para habilitar a nova API:

```bash
export TILES_API_URL=http://0.0.0.0:8080
export TILES_API_USERNAME=admin
export TILES_API_PASSWORD=sua_senha_segura
```

### Configuração no config.js

A configuração da API de tiles é automaticamente carregada em `src/server/config.js`:

```javascript
tilesApi: {
    baseUrl: process.env.TILES_API_URL || "http://0.0.0.0:8080",
    auth: {
        username: process.env.TILES_API_USERNAME || "admin",
        password: process.env.TILES_API_PASSWORD || "password"
    },
    endpoints: {
        // Todos os endpoints mapeados
    },
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000
}
```

## Arquitetura da Integração

### 1. Serviço de Tiles (tilesApiService.js)

Localização: `src/server/services/tilesApiService.js`

Este serviço encapsula toda a comunicação com a nova API de tiles:

- **Autenticação**: HTTP Basic Auth automática
- **Retry Logic**: Tentativas automáticas em caso de falha
- **Métodos disponíveis**:
  - Capabilities (getCapabilities, getCapabilitiesLegacy)
  - Tiles (getLandsatTile, getSentinelTile)
  - Timeseries (getLandsatTimeseries, getSentinelTimeseries, getModisTimeseries, getNddiTimeseries)
  - Cache Management (getCacheStats, clearCache, warmupCache, etc.)

### 2. Controladores Refatorados

Todos os controladores foram refatorados para suportar tanto a API legada quanto a nova:

#### cacheManager-refactored.js
- Mantém funcionalidade existente
- Adiciona novos endpoints para gerenciamento de cache
- Flag `useNewApi` para controlar qual API usar
- Novos métodos:
  - `/api/cache/stats` - Estatísticas de cache
  - `/api/cache/point/start` - Iniciar cache para um ponto
  - `/api/cache/campaign/start` - Iniciar cache para uma campanha
  - `/api/cache/clear` - Limpar cache com filtros

#### landsat-capabilities-refactored.js / sentinel-capabilities-refactored.js
- Busca capabilities da nova API quando configurada
- Fallback automático para API legada
- Filtros aprimorados para coleções

#### timeseries-refactored.js
- Suporta novos tipos de timeseries (Sentinel-2, MODIS)
- Parâmetros de data (data_inicio, data_fim)
- Identificação automática da fonte (new-api/legacy)

### 3. Autenticação (cacheApiAuth.js)

Localização: `src/server/middleware/auth/cacheApiAuth.js`

Middleware de autenticação para endpoints protegidos:

- Verifica credenciais contra MongoDB (coleção users)
- Suporta senhas em plain text ou SHA256
- Requer role `super-admin` ou type `admin`
- HTTP Basic Auth

### 4. Rotas (cacheApi.js)

Localização: `src/server/routes/cacheApi.js`

Define todas as rotas para gerenciamento de cache:

```javascript
// Endpoints públicos (funcionalidade existente)
app.get('/service/cache/uncached-points', ...)
app.post('/service/cache/simulate', ...)

// Endpoints protegidos (nova API)
app.get('/api/cache/stats', auth.requireCacheApiAuth, ...)
app.post('/api/cache/point/start', auth.requireCacheApiAuth, ...)
app.post('/api/cache/campaign/start', auth.requireCacheApiAuth, ...)
```

### 5. Job smartCacheProcessor Atualizado

Localização: `src/server/middleware/jobs-refactored.js`

O job foi atualizado para suportar a nova API:

- Nova configuração `useNewApi` no MongoDB
- Quando habilitado, envia pontos para fila da nova API
- Mantém compatibilidade com método legado
- Emite eventos WebSocket para acompanhamento em tempo real

## Processo de Migração

### 1. Teste em Desenvolvimento

1. Configure as variáveis de ambiente
2. Substitua os controladores originais pelos refatorados:
   ```bash
   mv src/server/controllers/cacheManager.js src/server/controllers/cacheManager-original.js
   mv src/server/controllers/cacheManager-refactored.js src/server/controllers/cacheManager.js
   # Repetir para outros controladores
   ```

3. Teste funcionalidades básicas

### 2. Habilitação Gradual

1. **Fase 1**: Use nova API apenas para capabilities
   - Os controladores automaticamente tentam a nova API primeiro

2. **Fase 2**: Habilite cache através da nova API
   - No MongoDB, atualize a configuração do smartCacheProcessor:
   ```javascript
   db.cacheConfig.update(
     { configType: 'smartCacheProcessor' },
     { $set: { useNewApi: true } }
   )
   ```

3. **Fase 3**: Migre tiles e timeseries
   - A nova API será usada automaticamente quando configurada

### 3. Monitoramento

- Logs indicam qual API está sendo usada
- Eventos WebSocket incluem fonte (new-api/legacy)
- Respostas de erro incluem campo `source`

## Funcionalidades Novas

### 1. Cache Management Avançado

- **Cache por Ponto**: Cache todos os tiles de um ponto específico
- **Cache por Campanha**: Cache todos os pontos de uma campanha
- **Status em Tempo Real**: Acompanhe o progresso via WebSocket
- **Estatísticas Detalhadas**: Métricas de uso e performance

### 2. Novos Tipos de Dados

- **Timeseries Sentinel-2**: Dados de alta resolução temporal
- **Timeseries MODIS**: Dados diários de vegetação
- **Filtros de Data**: Especifique período para timeseries

### 3. Otimizações

- **Batch Processing**: Processamento em lotes configurável
- **Rate Limiting**: Controle de taxa de requisições
- **Retry Automático**: Recuperação de falhas temporárias

## Exemplos de Uso

### Iniciar Cache para uma Campanha

```bash
curl -X POST http://localhost:3000/api/cache/campaign/start \
  -u "admin:senha" \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": "mapbiomas_caatinga", "batch_size": 10}'
```

### Verificar Status do Cache

```bash
curl http://localhost:3000/api/cache/stats \
  -u "admin:senha"
```

### Obter Timeseries Sentinel-2

```bash
curl "http://localhost:3000/api/timeseries/sentinel2?lon=-44.5&lat=-10.5&data_inicio=2023-01-01&data_fim=2023-12-31"
```

## Troubleshooting

### API não está sendo usada

1. Verifique as variáveis de ambiente
2. Confirme que `app.config.tilesApi.baseUrl` está definido
3. Verifique logs para erros de conexão

### Autenticação falhando

1. Verifique credenciais no MongoDB
2. Confirme que o usuário tem role `super-admin` ou type `admin`
3. Teste com curl usando Basic Auth

### Performance degradada

1. Ajuste `batchSize` na configuração do cache
2. Verifique `parallelRequests` limits
3. Monitore uso de memória da nova API

## Rollback

Para reverter para o sistema legado:

1. Remova/renomeie variáveis de ambiente TILES_API_*
2. Ou defina `useNewApi: false` no MongoDB
3. Os controladores automaticamente usarão URLs legadas

## Conclusão

A integração foi projetada para ser não-invasiva e permitir migração gradual. Todas as funcionalidades existentes são mantidas, com novas capacidades adicionadas quando a nova API está disponível.
