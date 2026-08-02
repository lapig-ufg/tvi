# Design — Módulo de imagens Esri Wayback no TVI

**Data:** 2026-08-01
**Status:** Aprovado em brainstorming; aguardando plano de implementação
**Referências externas:**
- Catálogo WMTS: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/wmts/1.0.0/wmtscapabilities.xml`
- Aplicação de referência: `https://github.com/Esri/wayback` (e biblioteca `@esri/wayback-core`)
- Configuração oficial de releases: `waybackconfig.json` (S3 da Esri)

---

## 1. Problema

O TVI monta hoje a grade de imagens do inspetor com uma célula fixa por ano
(`initialYear` → `finalYear`), alimentada por mosaicos Landsat/Sentinel/WMS. O
Esri Wayback disponibiliza o histórico de alta resolução do World Imagery em
aproximadamente 180 *releases* desde 2014-02-20, com uma particularidade
central: **o conjunto de datas com imagem distinta varia por localização** —
cada ponto tem a sua própria série. É necessário permitir campanhas cuja grade
de datas seja exatamente a série Wayback disponível em cada ponto, com as
imagens carregadas diretamente do serviço WMTS de cada release.

## 2. Restrições (definidas pelo usuário)

1. **Zero impacto no fluxo existente**: campanhas atuais (landsat, sentinel,
   planet, wms) não podem mudar de comportamento; o laço por ano de
   `generateMaps()` não é alterado.
2. **Módulo separado, ativado por configuração da campanha**: todo o código
   Wayback vive em arquivos próprios; a ativação ocorre por
   `imageType: 'wayback'`.

## 3. Decisões de escopo (aprovadas no brainstorming)

| Decisão | Escolha |
|---|---|
| Descoberta das datas por ponto | **Pré-computada na criação da campanha** e persistida no documento do ponto |
| Composição da grade | **Todas as releases com imagem distinta** no ponto (dedupe via serviço `tilemap`), com filtro opcional por `initialYear`/`finalYear` |
| Semântica da inspeção | **Classificação por release/data** (cada célula recebe uma classe, como hoje cada ano recebe) |
| Telas contempladas | **Inspetor (`/temporal`) e supervisor**; admin-temporal e monitoramento ficam para versão futura |
| Abordagem arquitetural | **Módulo paralelo isolado** (abordagem B), descartadas a ramificação no pipeline atual (A) e o proxy completo de tiles (C) |

### 3.1 Fundamentos técnicos do Wayback assumidos

- Cada release possui camada WMTS própria:
  `.../WorldImagery/default/{releaseNum}/{z}/{y}/{x}` (ordem `{z}/{y}/{x}`,
  diferente do padrão `{x}/{y}/{z}` da Tiles API do LAPIG).
- O serviço `tilemap` de cada release informa, para um tile, a partir de qual
  release aquela imagem não muda — é o mecanismo de dedupe usado pelo app
  oficial da Esri, que reduz ~180 consultas para tipicamente 15–40 por ponto.
- A data de publicação da release (`releaseDate`) **não** é a data de captura
  da imagem no ponto; a data real (`captureDate`) vem do serviço de metadados
  da release.
- Os tiles são públicos, sem chave de API; o client pode consumi-los
  diretamente.

## 4. Modelo de dados

### 4.1 Campanha

Nova opção no select existente do formulário admin (`campaign-form-modal`):

- `imageType: 'wayback'`
- Quando selecionada: exige `useDynamicMaps: true`; oculta/ignora `wmsConfig`,
  `visParams`, `wmsPeriod`.
- `initialYear`/`finalYear` permanecem e atuam como **filtro opcional** do
  intervalo de datas (não geram célula fixa por ano).

### 4.2 Ponto — novo campo persistido pelo job

```js
waybackImages: [
  { releaseNum: 47963,            // identificador WMTS da release
    releaseDate: "2018-06-06",    // data de publicação da release
    captureDate: "2018-04-12",    // data real de captura no ponto (ou null)
    source: "Maxar/WV03",         // metadados exibíveis
    resolution: 0.3 },
  // ...
],
waybackSyncedAt: ISODate          // carimbo de processamento do job
```

Campo **novo e dedicado** — o legado `point.images[]` é populado por ETL
externo e não deve ser disputado.

### 4.3 Inspeção

O array `inspection[].form[]` atual guarda `{initialYear, finalYear, landUse}`.
Para campanhas Wayback, cada resposta referencia a release:

```js
{ releaseNum, captureDate, landUse }
```

Gravada pelo mesmo endpoint de inspeção, em ramo novo e isolado; a gravação por
ano permanece intocada.

## 5. Módulo server-side

### 5.1 `src/server/services/waybackService.js` (novo)

Singleton nos moldes do `tilesApiService.js`:

- `getReleases()` — baixa e mantém em memória (TTL de 24 h) o catálogo oficial
  de releases (`waybackconfig.json`): `releaseNum → {releaseDate, urlTemplate
  WMTS, metadataLayerUrl}`. Requisição única, compartilhada.
- `getLocalChanges(lon, lat, zoom)` — converte lon/lat no tile XYZ do zoom de
  trabalho e deduplica as releases via `tilemap`, com a otimização do
  `@esri/wayback-core` (varredura da mais recente para a mais antiga).
- `getMetadata(releaseNum, lon, lat)` — obtém `captureDate`, fonte e resolução
  reais no ponto.
- Resiliência: axios com retry/backoff (padrão `tilesApiService.js:30-79`) e
  limite de concorrência global contra o arcgis.com.

**Zoom de trabalho do dedupe:** constante `z = 14` (~2,4 m/px no Brasil),
próximo ao zoom de visualização do TVI (13) e suficiente para capturar as
atualizações de alta resolução relevantes.

### 5.2 `src/server/controllers/wayback.js` + `src/server/routes/wayback.js` (novos)

- `POST /service/wayback/sync/:campaignId` (admin) — dispara o job de
  pré-computação.
- `GET /service/wayback/status/:campaignId` (admin) — progresso
  (processados/total, erros).
- `GET /service/wayback/releases` — repassa o catálogo em cache ao client.

### 5.3 Job de pré-computação

Executa no processo Node (sem infraestrutura nova). Disparado automaticamente
ao final do upload de GeoJSON quando `imageType === 'wayback'`; reexecutável
pelo endpoint de sync. **Idempotente**: pula pontos com `waybackSyncedAt`,
salvo `force`.

1. Carrega o catálogo de releases uma vez.
2. Itera os pontos em lotes com concorrência limitada (ex.: 5 pontos em
   paralelo).
3. Por ponto: `getLocalChanges` → `getMetadata` de cada release restante →
   grava `waybackImages[]` + `waybackSyncedAt`.
4. Progresso em coleção `waybackSync` (um documento por campanha: status,
   contadores, últimos erros) — fonte do endpoint de status.
5. Pontos com falha ficam sem `waybackSyncedAt`; retry ao final; se
   persistirem, ficam listados no status para reexecução manual.

**Atomicidade por ponto:** o job nunca grava `waybackImages[]` parcial — ou o
ponto completa (tilemap + metadados de todas as releases) ou nada é persistido.

**Lock de execução:** duas execuções simultâneas para a mesma campanha são
bloqueadas por `findOneAndUpdate` de `status: running` no documento de status.

**Estimativa de carga:** campanha de 1.000 pontos ≈ 25–50 mil requisições
leves; dezenas de minutos com a concorrência proposta — aceitável para um passo
único de criação.

### 5.4 Alterações mínimas em arquivos existentes (server)

- Registro de rota: automático via `express-load` (nenhuma edição manual).
- Gancho pós-upload em `campaign-crud.js`: 3–5 linhas condicionadas ao
  `imageType`.
- Allowlist do proxy de screenshot (`proxy.js:41-45`): incluir o domínio
  `wayback.maptiles.arcgis.com`.

## 6. Módulo client-side

### 6.1 `src/client/services/waybackGridService.js` (novo)

Recebe o ponto e o catálogo de releases (`GET /service/wayback/releases`,
cacheado em memória como no `capabilitiesService`) e monta `$scope.maps` no
contrato já consumido pelo template — `{date, year, url, bounds, index}` — a
partir de `point.waybackImages[]`, ordenado por `captureDate`. A célula exibe
`captureDate`; `year` é derivado dela para o cabeçalho. `initialYear`/
`finalYear`, quando definidos, filtram a lista.

### 6.2 `src/client/directives/waybackMap.js` (novo)

Diretiva `<wayback-map>` Leaflet em arquivo próprio, clonando a estrutura do
`landsatMap`, com `L.tileLayer` apontando direto para o WMTS da release
(ordem `{z}/{y}/{x}`, sem subdomínios `tm{s}`). Sem `visparam`/`period`.

### 6.3 Integração nos controllers existentes

Única alteração em código atual, idêntica em `temporal.js` e `supervisor.js`:

```js
// primeira linha de generateMaps():
if ($scope.config.imageType === 'wayback') {
    $scope.maps = waybackGridService.buildGrid($scope.point, $scope.config);
    return;
}
```

### 6.4 Template

Em `temporal.tpl.html:296-353` e equivalente do supervisor: um `ng-if`
adicional no bloco que escolhe entre `landsat-map`/`sentinel-map`/`wms-map`,
adicionando `wayback-map` quando `config.imageType === 'wayback'`. Seletores de
período (DRY/WET) e `visparam` ficam ocultos nesse modo.

### 6.5 Formulário de inspeção

Bloco novo do form itera sobre as células da grade do ponto e grava
`{releaseNum, captureDate, landUse}`, com a mesma UX de consolidação do fluxo
atual ("mesma classe da anterior" agrupa datas consecutivas), em ramo próprio
de template e controller. O endpoint aceita o payload novo somente quando a
campanha é Wayback.

### 6.6 Pontos sem imagem

Se `point.waybackImages` estiver vazio ou ausente (sem cobertura ou job
pendente), o visualizador exibe aviso claro no lugar da grade e **bloqueia a
inspeção** daquele ponto; o supervisor vê o mesmo aviso. Os pontos continuam
entrando na fila de distribuição normal (nenhuma alteração na lógica de
distribuição existente).

## 7. Casos de borda e falhas

| Cenário | Comportamento |
|---|---|
| Release nova publicada após a criação | Grade congelada na pré-computação (consistência entre inspetores). Sync com `force` reprocessa deliberadamente; restrição operacional: não reprocessar com inspeções em andamento. |
| Release removida/renumerada pela Esri | Célula mostra "imagem indisponível"; demais células seguem funcionais. Classificações permanecem válidas (referenciam `releaseNum` + `captureDate` persistidos). |
| Ponto na fronteira de tiles | Dedupe usa o tile z14 que contém o ponto; área visível pode incluir tiles vizinhos com histórico diferente. Limitação aceita (idêntica ao app oficial da Esri). |
| `captureDate` ausente (releases antigas) | Job grava `captureDate: null`; client usa `releaseDate` como fallback, marcado visualmente como data aproximada. |
| Job interrompido (restart do server) | Idempotente e retomável via `waybackSyncedAt`; basta reexecutar o sync. |
| Campanha não-Wayback | Não executa nenhuma linha do módulo novo (early-return é o único ponto de contato). |

## 8. Testes (Mocha, padrão de `src/server/test`)

1. **`waybackService`** — unidade com HTTP mockado: dedupe de releases
   (sequência `tilemap` simulada), fallback de metadados, retry.
2. **Job** — campanha sintética: idempotência, atomicidade por ponto, lock de
   execução dupla, contadores de status.
3. **`waybackGridService`** — lógica extraída em função pura: ordenação por
   `captureDate`, filtro por `initialYear`/`finalYear`, fallback de data.
4. **Regressão do fluxo existente** — campanha `imageType: 'landsat'` percorre
   `generateMaps()` sem invocar nada do módulo Wayback.
5. **Gravação de inspeção por release** — payload novo aceito apenas para
   campanhas Wayback; payload por ano inalterado.

## 9. Riscos e evoluções futuras

- **Dependência de serviço de terceiros sem SLA**: o catálogo e os tiles são
  públicos da Esri; mudanças de contrato exigirão manutenção. Mitigação: toda
  a superfície de contato está concentrada no `waybackService`.
- **Volume do job em campanhas grandes** (>10 mil pontos): avaliar fila
  dedicada ou execução em janelas, se necessário — fora do escopo desta
  versão.
- **Extensão às telas admin-temporal e monitoramento**: reaproveita
  `waybackGridService` e a diretiva; prevista para versão futura.
- **Revalidação periódica de releases novas** (abordagem híbrida): descartada
  nesta versão (YAGNI); o sync manual com `force` cobre a necessidade.
