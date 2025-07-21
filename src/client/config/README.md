# Configuração de Ambiente - TVI Frontend

Este diretório contém os arquivos de configuração para diferentes ambientes do frontend TVI.

## Arquivo: environment.js

O arquivo `environment.js` centraliza todas as URLs e configurações específicas de ambiente.

### Como usar:

1. **Mudar ambiente**: Edite a variável `environment` no arquivo `environment.js`:
   ```javascript
   var environment = 'production'; // Opções: 'development', 'staging', 'production'
   ```

2. **Configurações disponíveis**:
   - `tilesApiBaseUrl`: URL base para a API de tiles
   - `tilesSubdomains`: Subdomínios para distribuição de carga
   - `servicePrefix`: Prefixo para APIs do backend
   - `cdnUrls`: URLs para bibliotecas externas

3. **Usar em diretivas**: As diretivas já estão configuradas para usar a configuração quando disponível:
   ```javascript
   // Exemplo em sentinelMap e landsatMap
   if ($injector.has('AppConfig')) {
     const AppConfig = $injector.get('AppConfig');
     return AppConfig.buildTileUrl('s2_harmonized', {
       period: period,
       year: year,
       visparam: visparam
     });
   }
   ```

4. **Fallback**: Se a configuração não estiver disponível, o código usa as URLs hardcoded existentes.

### Adicionar novos ambientes:

Para adicionar um novo ambiente, adicione uma nova entrada no objeto `configs`:

```javascript
configs.myNewEnvironment = {
  tilesApiBaseUrl: 'https://my-new-api.example.com/api/layers',
  tilesSubdomains: ['1', '2', '3'],
  servicePrefix: 'service/',
  cdnUrls: { ... }
};
```

### Importante:

- O arquivo `environment.js` deve ser carregado ANTES do `app.js` no `index.html`
- As configurações são registradas como constante Angular (`AppConfig`)
- O método `buildTileUrl` facilita a construção de URLs com parâmetros