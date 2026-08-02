# Painel de Sincronização Wayback (Admin) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Sincronização Wayback" na tela admin de gestão de campanha (`/admin/campaigns/manage/:id`), com progresso em tempo real (polling) e botões de sincronizar/forçar re-sync — visível apenas para campanhas `imageType === 'wayback'`.

**Architecture:** Somente cliente. Nova aba no padrão de abas existente de `campaign-management.tpl.html` (`ng-show="activeTab === '...'"`), com botão condicionado por `ng-if` (mesmo padrão da aba `properties`). O controller `CampaignManagementController` ganha estado `$scope.wayback`, funções de carga/disparo e polling via `$interval` (5 s, ativo só com aba aberta e status `running`). Backend intocado: consome `GET /api/wayback/sync/:id/status` e `POST /api/wayback/sync/:id[?force=1]` já existentes.

**Tech Stack:** AngularJS 1.5.8 (sem build step), Bootstrap/FontAwesome já carregados, `NotificationDialog` global.

**Spec:** `docs/superpowers/specs/2026-08-02-wayback-admin-sync-panel-design.md`

## Global Constraints

- Zero impacto em campanhas legadas: a aba não pode ser renderizada quando `imageType !== 'wayback'`.
- Textos em pt-BR direto no template (telas admin não usam i18n).
- Sem arquivos novos; sem alterações de servidor.
- ES5 no cliente (o projeto não tem transpilação; `const`/arrow são tolerados neste controller — ele já usa ambos — mas manter o estilo do arquivo).
- Cleanup obrigatório do `$interval` (`$destroy` e troca de aba).
- Commits no formato MEMORA `tipo(tvi): descrição`, sem Co-Authored-By.
- Suíte (`cd src/server && npm test`) deve permanecer 67/67 ao final de cada task.

---

### Task 1: Estado e lógica Wayback no controller

**Files:**
- Modify: `src/client/controllers/campaign-management.js`

**Interfaces:**
- Consumes: `GET /api/wayback/sync/:campaignId/status` → doc `{status: 'running'|'completed'|'completed_with_errors', processed, total, startedAt, finishedAt, errors: [{pointId, error}]}` (404 = nunca sincronizada); `POST /api/wayback/sync/:campaignId?force=1` → `{started: true}`.
- Produces (usados pela Task 2 no template): `$scope.wayback` (`{status, notFound, loading, error, starting}`), `$scope.loadWaybackStatus()`, `$scope.startWaybackSync(force)`, `$scope.waybackPercent()`, e o comportamento de `setActiveTab('wayback')` que dispara a carga.

- [ ] **Step 1: Injetar `$interval` na DI do controller**

Na linha 4, o controller declara:

```js
Application.controller('CampaignManagementController', function ($scope, $http, $location, $routeParams, $timeout, $uibModal) {
```

Alterar para:

```js
Application.controller('CampaignManagementController', function ($scope, $http, $location, $routeParams, $timeout, $interval, $uibModal) {
```

(DI implícita por nome de parâmetro — padrão do projeto, sem annotation array; a ordem dos demais parâmetros não importa, mas manter como acima.)

- [ ] **Step 2: Adicionar estado e funções Wayback**

Inserir o bloco abaixo imediatamente antes da linha final `// Verificar autenticação ao carregar` / `$scope.checkAuth();` (fim do arquivo):

```js
    // ── Sincronização Wayback ────────────────────────────────────────────
    // Painel da aba 'wayback' (só campanhas imageType === 'wayback').
    // Polling só roda com a aba aberta E status 'running' — cancelado ao
    // trocar de aba, ao término do job e no $destroy do scope.
    $scope.wayback = { status: null, notFound: false, loading: false, error: null, starting: false };
    var waybackPoll = null;

    function stopWaybackPolling() {
        if (waybackPoll) {
            $interval.cancel(waybackPoll);
            waybackPoll = null;
        }
    }

    function ensureWaybackPolling() {
        if (waybackPoll) return;
        waybackPoll = $interval(function () {
            if ($scope.activeTab !== 'wayback') {
                stopWaybackPolling();
                return;
            }
            $scope.loadWaybackStatus();
        }, 5000);
    }

    $scope.loadWaybackStatus = function () {
        $scope.wayback.loading = true;
        $http.get('/api/wayback/sync/' + $scope.campaignId + '/status').then(function (response) {
            $scope.wayback.loading = false;
            $scope.wayback.error = null;
            $scope.wayback.notFound = false;
            $scope.wayback.status = response.data;
            if (response.data.status === 'running' && $scope.activeTab === 'wayback') {
                ensureWaybackPolling();
            } else {
                stopWaybackPolling();
            }
        }, function (error) {
            $scope.wayback.loading = false;
            if (error.status === 404) {
                // Nunca sincronizada: estado normal, não é erro.
                $scope.wayback.notFound = true;
                $scope.wayback.status = null;
                $scope.wayback.error = null;
                stopWaybackPolling();
            } else if (error.status === 401) {
                $location.path('/admin/login');
            } else {
                // Falha transiente: mantém o último status exibido e o polling
                // (se ativo) para a próxima tentativa.
                $scope.wayback.error = 'Erro ao consultar o status da sincronização.';
            }
        });
    };

    $scope.waybackPercent = function () {
        var s = $scope.wayback.status;
        if (!s || !s.total) return 0;
        return Math.min(100, Math.round((s.processed / s.total) * 100));
    };

    $scope.startWaybackSync = function (force) {
        if ($scope.wayback.starting) return;
        var doStart = function () {
            $scope.wayback.starting = true;
            var url = '/api/wayback/sync/' + $scope.campaignId + (force ? '?force=1' : '');
            $http.post(url).then(function () {
                $scope.wayback.starting = false;
                NotificationDialog.success('Sincronização iniciada.');
                $scope.loadWaybackStatus();
            }, function (error) {
                $scope.wayback.starting = false;
                if (error.status === 401) {
                    $location.path('/admin/login');
                    return;
                }
                var msg = (error.data && error.data.error) || 'Erro ao iniciar a sincronização.';
                NotificationDialog.error(msg);
            });
        };
        if (force) {
            NotificationDialog.confirm(
                'A re-sincronização forçada reprocessa TODOS os pontos da campanha, inclusive os já sincronizados. Para campanhas grandes, isso pode levar horas. Deseja continuar?',
                'Forçar re-sincronização'
            ).then(function (confirmed) {
                if (confirmed) doStart();
            });
        } else {
            doStart();
        }
    };

    $scope.$on('$destroy', stopWaybackPolling);
```

- [ ] **Step 3: Integrar ao `setActiveTab`**

A função atual (aprox. linha 53):

```js
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        
        // Renderizar gráficos quando a aba é selecionada
        $timeout(function() {
            $scope.renderChartsForTab(tab);
        }, 100);
    };
```

Alterar para:

```js
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;

        if (tab === 'wayback') {
            $scope.loadWaybackStatus();
        } else {
            stopWaybackPolling();
        }

        // Renderizar gráficos quando a aba é selecionada
        $timeout(function() {
            $scope.renderChartsForTab(tab);
        }, 100);
    };
```

Atenção à hoisting: `stopWaybackPolling` é function declaration (Step 2), então pode ser referenciada por `setActiveTab` mesmo definida mais abaixo no arquivo.

- [ ] **Step 4: Confirmar que `renderChartsForTab('wayback')` é inócuo**

Ler a implementação de `renderChartsForTab` no mesmo arquivo e confirmar que uma aba desconhecida não lança erro (switch/ifs por nome de aba). Se houver `default` com efeito colateral, proteger com `if (tab === 'wayback') return;` no início da função. Não alterar nada se já for inócuo.

- [ ] **Step 5: Verificar sintaxe e suíte**

```bash
node --check src/client/controllers/campaign-management.js
cd src/server && npm test
```

Esperado: sintaxe OK; `# tests 67 / # pass 67 / # fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/client/controllers/campaign-management.js
git commit -m "feat(tvi): adiciona lógica de acompanhamento do sync Wayback no admin

Prepara a tela de gestão de campanha para exibir o progresso da
sincronização de imagens Wayback: consulta de status com atualização
automática a cada 5 segundos enquanto houver execução em andamento e
disparo manual de sincronização (normal ou forçada, com confirmação)."
```

---

### Task 2: Aba e painel no template

**Files:**
- Modify: `src/client/views/campaign-management.tpl.html`

**Interfaces:**
- Consumes (da Task 1): `wayback.{status,notFound,error,starting}`, `loadWaybackStatus()`, `startWaybackSync(force)`, `waybackPercent()`, `setActiveTab('wayback')`; `details.campaign.imageType` (já presente na resposta de `/api/campaigns/:id/details`).
- Produces: aba visível apenas em campanhas wayback; nenhuma API nova.

- [ ] **Step 1: Adicionar o botão da aba**

Localizar o botão da aba `properties` (aprox. linha 168):

```html
                    <button class="tab-btn clickable" ng-class="{active: activeTab === 'properties'}" ng-if="details.propertyAnalysis" ng-click="setActiveTab('properties')">
                        <i class="fas fa-list-alt"></i>
                        <span>Análise de Propriedades</span>
                    </button>
```

Inserir imediatamente APÓS ele (ainda dentro de `.tabs-header`):

```html
                    <button class="tab-btn clickable" ng-class="{active: activeTab === 'wayback'}" ng-if="details.campaign.imageType === 'wayback'" ng-click="setActiveTab('wayback')">
                        <i class="fas fa-history"></i>
                        <span>Sincronização Wayback</span>
                    </button>
```

- [ ] **Step 2: Adicionar o painel da aba**

Localizar o fechamento do painel `properties` / início da seção de ações (aprox. linhas 655-662 — o `</div>` do `tab-panel` seguido dos fechamentos de `.tabs-content`, `.tabs-container` e `.analytics-section`, antes do comentário `<!-- Action Buttons -->`). Inserir o novo `tab-panel` DEPOIS do fechamento do painel `properties` e ANTES do `</div>` que fecha `.tabs-content`:

```html
                    <!-- Wayback Sync Tab -->
                    <div ng-show="activeTab === 'wayback'" class="tab-panel">
                        <div class="properties-header">
                            <h4 class="properties-title">
                                <i class="fas fa-history"></i>
                                Sincronização Wayback
                            </h4>
                            <p class="properties-desc">Pré-computação das imagens históricas Esri Wayback para cada ponto da campanha</p>
                        </div>

                        <div ng-if="wayback.error" class="alert alert-warning" style="margin-top: 1rem;">
                            {{wayback.error}}
                        </div>

                        <!-- Nunca sincronizada -->
                        <div ng-if="wayback.notFound" class="no-analysis-message">
                            <div class="message-card">
                                <div class="message-icon">
                                    <i class="fas fa-info-circle"></i>
                                </div>
                                <div class="message-content">
                                    <h5 class="message-title">Nenhuma sincronização registrada</h5>
                                    <p class="message-desc">Inicie a sincronização para pré-computar as imagens Wayback dos pontos desta campanha.</p>
                                </div>
                            </div>
                        </div>

                        <!-- Status da sincronização -->
                        <div ng-if="wayback.status">
                            <div class="progress-section">
                                <div class="progress-header">
                                    <span class="progress-label">
                                        Status:
                                        <span class="info-badge"
                                              ng-class="{'active': wayback.status.status === 'completed', 'inactive': wayback.status.status === 'completed_with_errors'}">
                                            {{ wayback.status.status === 'running' ? 'Em execução'
                                               : (wayback.status.status === 'completed' ? 'Concluída' : 'Concluída com erros') }}
                                        </span>
                                    </span>
                                    <span class="progress-percentage">
                                        {{wayback.status.processed || 0}}/{{wayback.status.total || 0}} ({{waybackPercent()}}%)
                                    </span>
                                </div>
                                <div class="progress-bar-container">
                                    <div class="progress-bar-fill"
                                         ng-class="{'success': wayback.status.status === 'completed', 'warning': wayback.status.status === 'completed_with_errors'}"
                                         ng-style="{'width': waybackPercent() + '%'}"></div>
                                </div>
                            </div>

                            <p style="margin-top: 0.75rem; color: #4a5568;">
                                Início: {{wayback.status.startedAt | date:'dd/MM/yyyy HH:mm:ss'}}
                                <span ng-if="wayback.status.finishedAt">
                                    &mdash; Término: {{wayback.status.finishedAt | date:'dd/MM/yyyy HH:mm:ss'}}
                                </span>
                            </p>

                            <!-- Falhas por ponto -->
                            <div ng-if="wayback.status.errors.length > 0" style="margin-top: 1rem;">
                                <h5>
                                    <i class="fas fa-exclamation-triangle"></i>
                                    Falhas por ponto ({{wayback.status.errors.length}}, máximo de 50 listadas)
                                </h5>
                                <div style="max-height: 300px; overflow-y: auto;">
                                    <table class="table table-striped table-condensed">
                                        <thead>
                                            <tr>
                                                <th>Ponto</th>
                                                <th>Erro</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr ng-repeat="err in wayback.status.errors track by $index">
                                                <td>{{err.pointId}}</td>
                                                <td>{{err.error}}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="properties-actions" style="margin-top: 1.5rem;">
                            <button class="action-btn primary clickable"
                                    ng-click="startWaybackSync(false)"
                                    ng-disabled="wayback.starting || wayback.status.status === 'running'">
                                <i class="fas fa-sync-alt"></i>
                                Sincronizar
                            </button>
                            <button class="action-btn secondary clickable"
                                    ng-click="startWaybackSync(true)"
                                    ng-disabled="wayback.starting || wayback.status.status === 'running'">
                                <i class="fas fa-redo"></i>
                                Forçar re-sincronização
                            </button>
                        </div>
                    </div>
```

Observações de contrato Angular:
- `wayback.status.status === 'running'` em `ng-disabled` é seguro mesmo com `wayback.status === null` (navegação segura de expressões Angular — não lança).
- Reutiliza classes CSS já definidas no `<style>` do próprio template (`tab-panel`, `progress-section`, `progress-bar-container`, `progress-bar-fill` + `success/warning`, `info-badge` + `active/inactive`, `properties-header`, `properties-actions`, `action-btn`, `no-analysis-message`, `message-card`) — nenhum CSS novo.

- [ ] **Step 3: Verificar estrutura e suíte**

```bash
# Sanidade do HTML: contagem de divs abertas/fechadas do trecho novo
cd src/server && npm test
```

Esperado: `# tests 67 / # pass 67 / # fail 0` (inclui i18nParity — não tocamos i18n).

Verificação manual mínima (instância local, admin logado):
1. Campanha legada → aba "Sincronização Wayback" ausente.
2. Campanha `teste_whayback` → aba presente; status atual exibido (running com barra avançando a cada 5 s, ou concluída).
3. Sair da aba/tela durante execução → sem requisições de status no Network do DevTools.
4. "Forçar re-sincronização" → diálogo de confirmação; cancelar não dispara POST.

- [ ] **Step 4: Commit**

```bash
git add src/client/views/campaign-management.tpl.html
git commit -m "feat(tvi): exibe painel de sincronização Wayback na gestão de campanha

Nova aba na tela administrativa da campanha, visível apenas para
campanhas do tipo Wayback, com barra de progresso da sincronização de
imagens, datas de início e término, lista de pontos com falha e botões
para iniciar ou repetir a sincronização."
```
