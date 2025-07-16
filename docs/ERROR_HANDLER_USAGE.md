# Guia de Uso do Interceptor Global de Erros

## Visão Geral

O interceptor global de erros foi implementado para capturar, logar e tratar todos os erros da aplicação de forma consistente.

## Funcionalidades

### 1. **Logging de Requisições**
- Todas as requisições são logadas com um ID único
- Em produção, apenas requisições para `/api/` são logadas (exceto `/health`)
- Requisições POST/PUT incluem amostra do body (máx 1000 caracteres)

### 2. **Tratamento de Erros**
- Erros são capturados automaticamente
- Cada erro recebe um ID único (`ERR_timestamp_random`)
- Logs estruturados em JSON para fácil análise
- Arquivos de log salvos em `/logs/errors_YYYY-MM-DD.log`

### 3. **Respostas Padronizadas**
```json
{
  "error": {
    "id": "ERR_1234567890_abc123",
    "type": "VALIDATION_ERROR",
    "message": "Mensagem amigável ao usuário",
    "timestamp": "2025-01-16T12:00:00.000Z"
  }
}
```

## Tipos de Erro

- `VALIDATION_ERROR` (400) - Dados inválidos
- `UNAUTHORIZED` (401) - Não autorizado
- `FORBIDDEN` (403) - Acesso negado
- `NOT_FOUND` (404) - Recurso não encontrado
- `PAYLOAD_TOO_LARGE` (413) - Arquivo muito grande
- `PARSE_ERROR` (400) - Erro ao processar dados
- `REQUEST_TIMEOUT` (408) - Timeout da requisição
- `INTERNAL_SERVER_ERROR` (500) - Erro interno
- `SERVICE_UNAVAILABLE` (503) - Serviço indisponível
- `DATABASE_ERROR` (503) - Erro no banco de dados
- `CORS_BLOCKED` (403) - Bloqueio de CORS

## Uso em Rotas

### Rotas Assíncronas
```javascript
app.get('/api/example', errorHandler.asyncHandler(async (req, res) => {
    // Erros assíncronos são capturados automaticamente
    const data = await someAsyncOperation();
    res.json(data);
}));
```

### Lançar Erros Customizados
```javascript
const error = new Error('Mensagem de erro');
error.statusCode = 400;
error.code = 'CUSTOM_ERROR';
throw error;
```

## Logs

### Localização
- Desenvolvimento: Console + `/logs/errors_YYYY-MM-DD.log`
- Produção: Apenas erros (4xx, 5xx) são logados

### Formato do Log
```json
{
  "errorId": "ERR_1234567890_abc123",
  "timestamp": "2025-01-16T12:00:00.000Z",
  "requestId": "REQ_1234567890_xyz789",
  "error": {
    "name": "ValidationError",
    "message": "Campo obrigatório ausente",
    "stack": "...",
    "statusCode": 400
  },
  "request": {
    "method": "POST",
    "url": "/api/campaigns/upload-geojson",
    "headers": {...},
    "body": {...}
  },
  "session": {
    "userId": "123",
    "sessionId": "abc..."
  }
}
```

## Monitoramento

### Upload de GeoJSON
O upload agora tem tratamento especial:
- Logs detalhados de cada etapa
- Captura de erros de autenticação
- Tratamento de erros de CORS
- Limites de tamanho com mensagens claras

### CORS
- Bloqueios de CORS são logados com detalhes
- Headers CORS adicionados automaticamente para origens permitidas
- Suporte para preflight requests (OPTIONS)

## Debugging

Para debugar problemas de upload:

1. Verificar logs em `/logs/errors_YYYY-MM-DD.log`
2. Procurar pelo `requestId` ou `errorId`
3. Analisar o objeto completo do erro
4. Verificar headers e body da requisição

## Configuração

### Variáveis de Ambiente
- `ALLOWED_ORIGINS`: Lista de origens permitidas (separadas por vírgula)
- `ALLOWED_HOSTS`: Lista de hosts permitidos (separados por vírgula)
- `NODE_ENV`: Define o nível de logging (prod = menos verbose)

### Timeout
- Padrão: 5 minutos (300000ms)
- Configurável por rota se necessário