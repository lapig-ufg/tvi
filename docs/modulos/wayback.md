# Módulo Esri Wayback — imagens históricas de alta resolução

- **Status:** implementado e integrado ao `master` (merge `2dc51e2`, 2026-08-02)
- **Ativação:** `imageType: 'wayback'` na configuração da campanha
- **Referências externas:**
  - Catálogo oficial de releases: `waybackconfig.json` (S3 da Esri)
  - Aplicação de referência: `https://github.com/Esri/wayback` (biblioteca `@esri/wayback-core`)

Este documento consolida a especificação de design, as decisões de escopo e o
estado final implementado do módulo (incluindo o painel administrativo de
sincronização). Os documentos originais de processo (specs e planos de
execução) permanecem no histórico do git (`docs/superpowers/`, commit
`edf09ca`).

---

## 1. Problema e proposta

O TVI monta a grade de imagens do inspetor com uma célula fixa por ano
(`initialYear` → `finalYear`), alimentada por mosaicos Landsat/Sentinel/WMS. O
Esri Wayback disponibiliza o histórico de alta resolução do World Imagery em
aproximadamente 195 *releases* desde 2014-02-20, com uma particularidade
central: **o conjunto de datas com imagem distinta varia por localização** —
cada ponto tem a sua própria série. O módulo permite campanhas cuja grade de
datas é exatamente a série Wayback disponível em cada ponto, com as imagens
carregadas diretamente do serviço WMTS de cada release.

### Restrições de projeto

1. **Zero impacto no fluxo existente:** campanhas atuais (landsat, sentinel,
   planet, wms) não mudam de comportamento; o laço por ano de `generateMaps()`
   não foi alterado (o módulo entra por *early-return*).
2. **Módulo separado, ativado por configuração:** todo o código Wayback vive em
   arquivos próprios; a ativação ocorre exclusivamente por
   `imageType: 'wayback'`.

### Decisões de escopo

| Decisão | Escolha |
|---|---|
| Descoberta das datas por ponto | Pré-computada na criação da campanha e persistida no documento do ponto |
| Composição da grade | Todas as releases com imagem distinta no ponto (dedupe via serviço `tilemap`) |
| Semântica da inspeção | Classificação por release/data (cada célula recebe uma classe) |
| Telas contempladas | Inspetor (`/temporal`), supervisor e painel admin de sincronização |
| Consolidação de classes | **Pulada** em campanhas Wayback (`classConsolidate` itera por ano; consolidação por release é decisão de produto futura) |

### Fundamentos técnicos do Wayback

- Cada release possui camada WMTS própria com template `{level}/{row}/{col}`,
  mapeado para `{z}/{y}/{x}` no Leaflet (ordem diferente do padrão
  `{x}/{y}/{z}` da Tiles API do LAPIG).
- O serviço `tilemap` de cada release informa, para um tile, a partir de qual
  release aquela imagem não muda (`select[0]` na resposta) — mecanismo de
  dedupe que reduz ~195 consultas para tipicamente 15–40 por ponto.
- A data de publicação da release (`releaseDate`) **não** é a data de captura
  da imagem no ponto; a data real (`captureDate`) vem do serviço de metadados
  da release.
- Os tiles são públicos, sem chave de API; o cliente os consome diretamente.

## 2. Modelo de dados

### 2.1 Campanha

Nova opção no select do formulário admin (`campaign-form-modal.tpl.html`):
`imageType: 'wayback'`. Na criação e na atualização, `useDynamicMaps: true` é
forçado pelo servidor (`campaign-crud.js`). `initialYear`/`finalYear`
permanecem como filtro opcional do intervalo de datas (não geram célula fixa
por ano).

### 2.2 Ponto — campo persistido pelo job

```js
waybackImages: [
  { releaseNum: 47963,            // identificador WMTS da release
    releaseDate: "2018-06-06",    // data de publicação da release
    captureDate: "2018-04-12",    // data real de captura no ponto (ou null)
    source: "Maxar/WV03",         // metadados exibíveis
    resolution: 0.3 },
  // ... ordenado por data de exibição (captureDate || releaseDate)
],
waybackSyncedAt: ISODate          // carimbo de processamento do job
```

Campo novo e dedicado — o legado `point.images[]` é populado por ETL externo e
não é disputado.

### 2.3 Inspeção

Para campanhas Wayback, cada entrada de `inspection[].form[]` referencia a
release: `{ releaseNum, captureDate, landUse, pixelBorder }`. O payload é
validado por `waybackInspectionGuard` (ver §3.4); a gravação por ano das
campanhas legadas permanece intocada.

### 2.4 Coleção `waybackSync`

Um documento por campanha (`_id` = campaignId), fonte do endpoint de status e
lock de execução:

```js
{ _id, status,            // 'running' | 'completed' | 'completed_with_errors'
  startedAt, finishedAt,
  processed, total,       // progresso da execução corrente
  errors: [{ pointId, error }] }  // limitado às 50 mais recentes
```

Registrada em `middleware/repository.js` (`requiredCollections`).

## 3. Servidor

### 3.1 `services/waybackService.js`

Singleton que concentra **toda** a superfície de contato com os serviços da
Esri:

- `getReleases()` — catálogo oficial (`waybackconfig.json`), cache em memória
  com TTL de 24 h e memoização de promise contra *cache stampede*; releases
  ordenadas por data decrescente.
- `getLocalChanges(lon, lat)` — converte lon/lat no tile XYZ de `z = 14`
  (`DEDUPE_ZOOM`, ~2,4 m/px no Brasil) e deduplica as releases via `tilemap`,
  varrendo da mais recente para a mais antiga e seguindo `select[0]` para
  pular blocos de releases idênticas; encerra quando `data[0]` indica ausência
  de tile.
- `getMetadata(release, lon, lat)` — consulta o MapServer de metadados da
  release. Cada MapServer tem 14 sub-layers por faixa de resolução
  (`layerId = 23 − zoom`, com *clamp* em 13). A consulta é feita **em
  cascata** pelos zooms `[19, 17, 15, 13]` (`METADATA_QUERY_ZOOMS`), parando
  na primeira camada com resultado — necessário porque a cobertura da camada
  detalhada varia por região (áreas rurais/Amazônia só têm registro a partir
  de camadas mais grossas). As camadas 12–13 (TerraColor, mosaico global de
  15 m sem data) ficam de fora. Campos reais do contrato: `SRC_DATE2`,
  `SRC_DESC`, `SAMP_RES` (não `SRC_RES`). Nunca rejeita: em falha, retorna
  `{captureDate: null, source: null, resolution: null}`.
- HTTP com retry e backoff exponencial (3 tentativas, timeout de 15 s).

### 3.2 Rotas (`routes/wayback.js`)

| Rota | Acesso | Função |
|---|---|---|
| `POST /api/wayback/sync/:campaignId[?force=1]` | super-admin | Dispara o job (valida existência e `imageType` da campanha: 404/400) |
| `GET /api/wayback/sync/:campaignId/status` | super-admin | Documento de progresso da coleção `waybackSync` (404 se nunca sincronizada) |
| `GET /service/wayback/releases` | sessão comum | Catálogo em cache para o cliente |

### 3.3 Job de pré-computação (`controllers/wayback.js`)

Executa no processo Node, disparado automaticamente ao final do upload de
GeoJSON quando `imageType === 'wayback'` (`triggerSyncIfWayback`, chamado por
`campaign-crud.js`) e reexecutável pelo endpoint de sync.

- **Idempotente:** pula pontos com `waybackSyncedAt`, salvo `force` (que
  reprocessa todos).
- **Lock:** `findOneAndUpdate` com `status: {$ne: 'running'}` + upsert; o
  conflito 11000 do driver 2.x é tratado como "já em execução".
- **Concorrência:** 5 pontos em paralelo; pontos arquivados (`archivedAt`)
  são excluídos.
- **Atomicidade por ponto:** `waybackImages[]` nunca é gravado parcial — um
  único `$set` por ponto ao final do processamento.
- **Progresso:** operadores comutativos (`$inc` para `processed`, `$push` com
  `$slice` para `errors`) — sob concorrência, um `$set` calculado poderia
  regredir o contador.
- **Retry:** uma passada de repetição sobre as falhas (transientes de rede);
  o estado final é gravado com `$set` autoritativo
  (`completed`/`completed_with_errors`).

Estimativa de carga: campanha de 1.000 pontos ≈ 25–50 mil requisições leves;
dezenas de minutos com a concorrência configurada. Para campanhas com dezenas
de milhares de pontos, o job leva horas (ver §7).

### 3.4 Guarda de inspeção (`services/waybackInspectionGuard.js`)

Função pura `validate(campaign, inspection)` chamada em `points.js`
(`updatePoint`), antes da gravação:

- Campanha Wayback: exige formulário não vazio em que toda entrada tenha
  `releaseNum` (número), `captureDate` e `landUse` (strings não vazias).
- Campanha legada: rejeita qualquer entrada com `releaseNum` — payloads por
  ano passam intocados.

Além disso, `points.js` **pula a consolidação** (`classConsolidate`) quando
`imageType === 'wayback'` — a rotina itera `initialYear..finalYear` e não se
aplica a formulários por release.

### 3.5 Demais alterações em arquivos existentes

- `controllers/campaign-crud.js` — força `useDynamicMaps` e dispara o sync
  pós-upload (criação e atualização).
- `controllers/proxy.js` — allowlist do proxy de screenshot inclui
  `wayback.maptiles.arcgis.com`.

## 4. Cliente

### 4.1 `services/wayback-grid-core.js`

Núcleo puro em UMD/ES5 (`window.WaybackGridCore`), testável no servidor:

- `displayDate(img)` — `captureDate || releaseDate`.
- `buildGrid(point, config, releasesIndex)` — monta a grade
  `[{date, approximateDate, year, releaseNum, url, bounds, index}]` no
  contrato já consumido pelos templates; `approximateDate: true` quando a
  célula usa `releaseDate` como fallback.
- `buildInitialAnswers`, `optionDates`, `expandAnswersToForm` — espelham a
  UX de consolidação do fluxo atual ("mesma classe da anterior" agrupa datas
  consecutivas) e produzem o payload `{releaseNum, captureDate, landUse,
  pixelBorder}`.

### 4.2 `services/waybackGridService.js`

Factory Angular: `getReleasesIndex()` com cache e dedupe de promise sobre
`GET /service/wayback/releases`; expõe `core` (o núcleo puro).

### 4.3 `directives/waybackMap.js`

Diretiva `<wayback-map lon lat zoom tile-url map-date>` clonada da estrutura
do `landsatMap`:

- `L.tileLayer` apontando direto para o WMTS da release; `tileerror` exibe
  aviso i18n (`WAYBACK_TILE_ERROR`) sem quebrar a grade.
- **Watchers obrigatórios:** o `ng-repeat` da grade usa `track by map.index`,
  que **recicla** as células ao trocar de ponto — `$watchGroup(['lon', 'lat',
  'tileUrl', 'mapDate'])` recentraliza o mapa, reposiciona o marcador e troca
  a camada de tiles.
- Cleanup: `mapSyncService.unregister` + `safeDestroyMap` (workaround
  documentado para Leaflet ≤ 1.9.4).
- Dimensionamento: `style.css` inclui `wayback-map` em todos os grupos de
  seletores de altura das células (sem isso as células têm altura 0).

### 4.4 Integração nas telas

- `temporal.js` e `supervisor.js`: flag `isWayback` derivada
  **sincronamente** de `$rootScope.user.campaign.imageType` (evita corrida no
  primeiro ponto); *early-return* em `generateMaps()` →
  `generateWaybackMaps()` (com guarda `preserve` para não destruir respostas
  preenchidas em `reloadMaps`).
- Templates (`temporal.tpl.html`, `supervisor.tpl.html`): guardas
  `&& !isWayback` nos blocos landsat/sentinel/wms; célula `<wayback-map>`;
  aviso `WAYBACK_NO_IMAGES` quando o ponto não tem imagens (bloqueia a
  inspeção — ver §6); rótulo `WAYBACK_APPROXIMATE_DATE` em células com data
  aproximada; seletores de período e `visparam` ocultos.
- Supervisor recebe **somente a grade** — as views do supervisor não possuem
  formulário por ponto (edição real é por `objConsolidated`/`editClass`, não
  alterada). Reclassificação por data é evolução futura.
- i18n: 4 chaves em `TEMPORAL.MAP` (`WAYBACK_IMAGES`, `WAYBACK_NO_IMAGES`,
  `WAYBACK_TILE_ERROR`, `WAYBACK_APPROXIMATE_DATE`) nos 3 locales
  (`pt-BR`, `en`, `id` — paridade garantida por teste).

## 5. Painel administrativo de sincronização

Aba **"Sincronização Wayback"** na tela de gestão da campanha
(`/admin/campaigns/manage/:id`), visível apenas quando
`details.campaign.imageType === 'wayback'` (`ng-if` no botão da aba — única
porta de entrada). Somente cliente (`campaign-management.js` +
`campaign-management.tpl.html`); consome os endpoints do §3.2.

- **Conteúdo:** badge de status (azul "Em execução", verde "Concluída",
  amarelo "Concluída com erros", ou "Nenhuma sincronização registrada" no
  404), barra de progresso `processed/total` com percentual, timestamps de
  início/término e tabela das falhas por ponto (até 50).
- **Ações:** "Sincronizar" (retoma pontos pendentes) e "Forçar
  ressincronização" (`force=1`, precedido de confirmação — reprocessa todos
  os pontos; horas em campanhas grandes). Ambos desabilitados com job em
  execução.
- **Polling:** `$interval` de 5 s, ativo somente com a aba aberta **e** status
  `running`; cancelado na troca de aba, no término do job e no `$destroy`.
  Um flag `waybackDestroyed` impede que uma resposta em voo, chegando após o
  `$destroy`, rearme o polling (o scope morto retém `activeTab`).
- Estados de erro: 404 = "nunca sincronizada" (não é erro); 401 redireciona ao
  login; falha transiente mantém o último status exibido e o polling ativo.

Nota histórica: a implementação do painel revelou que `NotificationDialog`
nunca havia sido injetado no `CampaignManagementController` — os usos
pré-existentes da tela (mensagens de erro e confirmação de exclusão de
campanha) estavam latentemente quebrados; a correção beneficia a tela inteira.

## 6. Casos de borda e falhas

| Cenário | Comportamento |
|---|---|
| Release nova publicada após a criação | Grade congelada na pré-computação (consistência entre inspetores). `force` reprocessa deliberadamente; restrição operacional: não reprocessar com inspeções em andamento. |
| Release removida/renumerada pela Esri | Célula mostra aviso de imagem indisponível; demais células seguem funcionais. Classificações permanecem válidas (referenciam `releaseNum` + `captureDate` persistidos). |
| Ponto na fronteira de tiles | Dedupe usa o tile z14 que contém o ponto; a área visível pode incluir tiles vizinhos com histórico diferente. Limitação aceita (idêntica ao app oficial da Esri). |
| `captureDate` ausente | Job grava `captureDate: null`; o cliente usa `releaseDate` marcada como data aproximada. Pontos sincronizados antes da cascata de metadados exigem `force=1` para repopular. |
| Ponto sem `waybackImages` (sem cobertura ou job pendente) | Aviso no lugar da grade e inspeção bloqueada; o ponto continua na fila de distribuição normal. |
| Job interrompido (restart do servidor) | Idempotente e retomável via `waybackSyncedAt` — basta reexecutar o sync. **Porém** o documento `waybackSync` fica com `status: 'running'` órfão: o painel mostra execução estagnada e os botões ficam desabilitados; não há cancel/reset no backend (dívida conhecida — exige intervenção manual na coleção). |
| Campanha não-Wayback | Nenhuma linha do módulo executa (early-return e `ng-if` são os únicos pontos de contato). |

## 7. Operação

- **Liberar inspetores somente após o sync:** aguardar
  `GET /api/wayback/sync/:id/status` = `completed` antes de abrir a campanha —
  ponto sem `waybackImages` bloqueia a inspeção sem opção de pular.
- **Campanhas grandes:** o job de dezenas de milhares de pontos leva horas
  (várias chamadas à Esri por ponto). `force=1` nessa escala é impraticável
  como rotina; preferir campanhas de teste pequenas para validação.
- O acompanhamento é feito pelo painel admin (§5), pelo endpoint de status ou
  pela coleção `waybackSync`.

## 8. Testes

Suíte em `node --test` (`cd src/server && npm test`):

| Arquivo | Cobertura |
|---|---|
| `test/waybackService.test.js` | Conversão lon/lat→tile, derivação de sub-layer, catálogo (cache + stampede), dedupe via tilemap, cascata de metadados |
| `test/waybackSyncJob.test.js` | Job contra Mongo real: idempotência, atomicidade, lock, force, contadores, retry |
| `test/waybackInspectionGuard.test.js` | Validação de payloads Wayback e rejeição de `releaseNum` em campanhas legadas |
| `test/waybackGridCore.test.js` | Grade, fallback de data, respostas iniciais e expansão para formulário |
| `simulate/wayback-smoke.js` | Smoke real contra a Esri (contrato do catálogo/tilemap/metadados) |

## 9. Riscos e evoluções futuras

- **Dependência de serviço de terceiros sem SLA:** toda a superfície de
  contato está concentrada no `waybackService`; mudanças de contrato da Esri
  exigirão manutenção pontual.
- **Consolidação por release** e **reclassificação por data no supervisor:**
  decisões de produto adiadas.
- **Fila dedicada para campanhas >10 mil pontos** e **cancel/reset do job**
  (status `running` órfão): evoluções previstas, fora do escopo desta versão.
- **Revalidação periódica de releases novas:** descartada (YAGNI); o sync
  manual com `force` cobre a necessidade.
