# Painel de Sincronização Wayback na Gestão de Campanha (Admin)

- **Data:** 2026-08-02
- **Branch:** `feat/wayback-imagery`
- **Dependência:** módulo Wayback já implementado (spec `2026-08-01-wayback-imagery-design.md`)

## Problema

O job de pré-computação das imagens Wayback (`runSyncJob`, em `src/server/controllers/wayback.js`) só pode ser acompanhado por três vias técnicas: o endpoint `GET /api/wayback/sync/:campaignId/status`, a coleção `waybackSync` no MongoDB e os logs do servidor. Nenhuma delas é acessível a um administrador pela interface. Para campanhas grandes (dezenas de milhares de pontos), o job dura horas e o administrador precisa de visibilidade de progresso, término e falhas — e de um meio de disparar ou repetir a sincronização sem usar `curl`.

## Decisões de escopo

1. **Localização:** aba dentro da tela de gestão da campanha (`/admin/campaigns/manage/:id`), visível apenas para campanhas com `imageType === 'wayback'`. Sem indicador na listagem de campanhas.
2. **Ações:** além da visualização, botões para iniciar a sincronização e para forçar re-sincronização (`force=1`), este último com diálogo de confirmação.
3. **Sem alterações de backend.** Os endpoints existentes já cobrem tudo: `GET /api/wayback/sync/:id/status`, `POST /api/wayback/sync/:id[?force=1]`. A tela de gestão já é protegida pela mesma sessão de super-admin exigida pelas rotas Wayback.

## Arquitetura

Nenhum arquivo novo. Duas alterações:

| Arquivo | Alteração |
|---|---|
| `src/client/views/campaign-management.tpl.html` | Nova aba "Sincronização Wayback" (botão de aba + painel), condicionada a `details.campaign.imageType === 'wayback'` |
| `src/client/controllers/campaign-management.js` | Estado `$scope.wayback`, funções de carga/disparo e polling com `$interval` |

O objeto `details.campaign` retornado por `GET /api/campaigns/:id/details` já contém o documento completo da campanha (spread em `campaign-crud.js`), portanto `imageType` está disponível no template sem mudança de API.

### Aba (template)

Segue o padrão das abas existentes (`ng-show="activeTab === '...'"` no painel; `ng-click="setActiveTab('wayback')"` no botão). O botão da aba usa `ng-if="details.campaign.imageType === 'wayback'"` — mesmo padrão da aba `properties`, condicionada a `details.propertyAnalysis`. Para campanhas legadas, nada é renderizado.

Conteúdo do painel:

- **Badge de status:**
  - `running` → azul, "Em execução";
  - `completed` → verde, "Concluída";
  - `completed_with_errors` → amarelo, "Concluída com erros";
  - status HTTP 404 no endpoint → estado "Nenhuma sincronização registrada" (não é erro).
- **Barra de progresso** `processed/total` com percentual; oculta no estado "nunca sincronizada".
- **Timestamps:** `startedAt` e `finishedAt` formatados (filtro `date` do Angular).
- **Tabela de falhas** (`errors[]`: `pointId` + `error`), exibida apenas quando não vazia. O backend já limita a lista a 50 entradas.
- **Botões:**
  - **Sincronizar** — `POST /api/wayback/sync/:id`; desabilitado enquanto `status === 'running'`. Cobre o caso de retomada (pontos sem `waybackSyncedAt`).
  - **Forçar re-sincronização** — `POST /api/wayback/sync/:id?force=1`; desabilitado enquanto `running`; precedido de diálogo de confirmação alertando que **todos** os pontos serão reprocessados (custo em horas para campanhas grandes).

Textos em pt-BR direto no template, como nas demais telas admin (que não usam i18n).

### Controller

Estado: `$scope.wayback = { status: null, notFound: false, loading: false, error: null, starting: false }`.

Funções:

- `loadWaybackStatus()` — `GET /api/wayback/sync/:id/status`. Sucesso popula `wayback.status`; HTTP 404 marca `notFound = true`; demais erros populam `wayback.error` (aviso na aba, sem quebrar a tela).
- `startWaybackSync(force)` — quando `force`, abre confirmação (`NotificationDialog`/`confirm-dialog`, o padrão já usado na tela) antes do POST. Após resposta `started: true`, chama `loadWaybackStatus()` imediatamente; o polling assume a partir daí. `starting` evita duplo clique.
- **Polling:** `$interval` de 5 segundos, ativo **somente** quando `activeTab === 'wayback'` **e** `wayback.status.status === 'running'`. Criado ao entrar na aba (via `setActiveTab`); cancelado ao sair da aba, quando o status deixa de ser `running` e no `$destroy` do scope. Um único intervalo por vez (guard contra recriação).
- Ao entrar na aba pela primeira vez, `loadWaybackStatus()` é chamada uma vez independentemente do status.

### Casos de borda

- **`alreadyRunning`:** o POST sempre responde `started: true` mesmo se já houver execução (o lock interno de `runSyncJob` impede duplicidade). O painel apenas segue exibindo o progresso da execução corrente — nenhum tratamento especial necessário.
- **`total === 0`** (força numa campanha sem pontos ou sync sem pontos pendentes): barra exibe 0/0 e o status transiciona direto para `completed`; o template protege a divisão de percentual (`total > 0`).
- **Sessão expirada:** os endpoints respondem 401; o handler de erro segue o padrão da tela (redirecionamento a `/admin/login` já existente para as demais chamadas — reutilizar o mesmo tratamento).
- **Navegação durante execução:** sair da tela cancela o `$interval` no `$destroy`; o job continua no servidor normalmente (é fire-and-forget).

## Fluxo de dados

```
[Aba Wayback aberta]
   → GET /api/wayback/sync/:id/status  → renderiza painel
   → se running: $interval 5 s → GET status → atualiza barra
[Sincronizar / Forçar]
   → (force: confirmação) → POST /api/wayback/sync/:id[?force=1]
   → GET status imediato → polling assume
```

## Testes e verificação

- **Sem testes automatizados novos:** a mudança é exclusivamente de interface admin (AngularJS sem harness de testes de controller no projeto); a lógica de servidor já está coberta por `waybackSyncJob.test.js`.
- **Suíte completa** (`cd src/server && npm test`) deve permanecer verde — garantia de zero regressão.
- **Validação manual** na campanha `teste_whayback`: aba visível somente nela; progresso avançando durante execução; força com confirmação; aba ausente em campanha legada.

## Fora de escopo

- Indicador de status na listagem `/admin/campaigns`.
- Cancelamento do job em execução (não há suporte no backend).
- Log periódico de progresso no servidor.
- Fila/agendamento para campanhas muito grandes (dívida já registrada no módulo principal).
