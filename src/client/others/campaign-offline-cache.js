'use strict';

Application.directive('campaignOfflineCache', function () {
    return {
        restrict: 'E',
        scope: { campaignId: '=', campaign: '=', details: '@' },
        templateUrl: 'views/campaign-offline-cache.tpl.html',
        controller: function ($scope, $http, $timeout, $q, NotificationDialog, AdminPages) {
            var destroyed = false;
            var timer = null;
            var pending = false;
            var coverageInitialized = false;
            var cancel = $q.defer();
            var endpoint = '/api/cache/campaign/' + encodeURIComponent($scope.campaignId) + '/offline';
            $scope.offline = { status: null, error: null, starting: false, loading: false, confirming: false,
                width: 512, height: 512, page: 0 };
            $scope.offlineLabels = {
                not_started: 'Não iniciado', preparing: 'Calculando cobertura', running: 'Gerando imagens',
                completed: 'Concluído', stale: 'Configuração alterada; verificar novamente', blocked: 'Intervenção necessária', pending: 'Pendente',
                processing: 'Em processamento', retry_wait: 'Aguardando retentativa', no_data: 'Ausência comprovada de dados'
            };
            var summaryStates = [
                ['completed', 'Imagens válidas'], ['no_data', 'Sem dados comprovados'],
                ['processing', 'Em processamento'], ['pending', 'Pendentes'],
                ['retry_wait', 'Aguardando retentativa'], ['blocked', 'Bloqueados']
            ];
            function applyStatus(status) {
                $scope.offline.status = status;
                var counts = status.counts || {};
                var total = status.total || 0;
                var verified = (counts.completed || 0) + (counts.no_data || 0);
                $scope.offlineSummary = {
                    total: total,
                    verified: verified,
                    percent: total ? Math.min(100, 100 * verified / total) : 0,
                    segments: summaryStates.map(function(state) {
                        var count = counts[state[0]] || 0;
                        return { state: state[0], label: state[1], count: count,
                            percent: total ? Math.min(100, 100 * count / total) : 0 };
                    })
                };
                if (status.config && !coverageInitialized) {
                    $scope.offline.width = status.config.width;
                    $scope.offline.height = status.config.height;
                    coverageInitialized = true;
                }
            }
            $scope.viewOfflineDetails = function () {
                AdminPages.go('campaign-offline', { campaignId: $scope.campaignId },
                    '/admin/campaigns/manage/' + encodeURIComponent($scope.campaignId));
            };
            $scope.offlineReasons = {
                bdc_selection_pending: 'Aguardando seleção das aquisições BDC',
                bdc_origin_busy: 'Aguardando disponibilidade da origem BDC',
                bdc_origin_paused: 'Consultas à origem BDC temporariamente suspensas',
                bdc_selection_failed: 'Falha na seleção das aquisições BDC',
                bdc_no_image: 'Nenhuma imagem elegível na seleção BDC preservada',
                bdc_tile_outside: 'Recorte fora da cobertura da aquisição BDC',
                empty_collection: 'Nenhuma cena disponível para os critérios do período',
                invalid_tile: 'Imagem inválida; ausência de dados não comprovada',
                cache_expired: 'Imagem vencida ou sem validade comprovada; verificar novamente',
                gee_credential_denied: 'Credencial recusada', GoogleAdmissionError: 'Aguardando disponibilidade no controle de chamadas',
                EarthEngineRateLimitedError: 'Limitação do Earth Engine', TimeoutError: 'Tempo de resposta excedido',
                source_unavailable: 'Fonte ou armazenamento indisponível'
            };
            $scope.offlineValidationReasons = {
                empty_image: 'Arquivo vazio', unsupported_format: 'Formato não suportado',
                invalid_dimensions: 'Dimensões diferentes de 256 × 256 pixels',
                transparent_image: 'Imagem totalmente transparente', white_image: 'Imagem totalmente branca',
                black_image: 'Imagem totalmente preta, sem informação visual para inspeção',
                corrupt_image: 'Arquivo de imagem corrompido', oversized_image: 'Arquivo acima do tamanho permitido',
                persistence_unconfirmed: 'Gravação no armazenamento não confirmada', invalid_content: 'Conteúdo inválido'
            };
            $scope.offlineActive = function () {
                var status = $scope.offline.status && $scope.offline.status.status;
                return status === 'preparing' || status === 'running';
            };
            $scope.offlineSupported = function () {
                var campaign = $scope.campaign;
                if (!campaign || campaign.useDynamicMaps !== true ||
                    ['landsat', 'sentinel-2'].indexOf(campaign.imageType) < 0 ||
                    (campaign.wmsConfig && campaign.wmsConfig.enabled)) return false;
                if (campaign.imagerySource !== 'bdc') return true;
                var config = campaign.bdcConfig;
                var collections = { landsat: 'landsat-2', 'sentinel-2': 'S2_L2A-1' };
                var initialYear = Number(campaign.initialYear), finalYear = Number(campaign.finalYear);
                return !!config && config.schemaVersion === 1 && config.collection === collections[campaign.imageType] &&
                    Number.isInteger(initialYear) && Number.isInteger(finalYear) && initialYear >= 1970 &&
                    finalYear <= new Date().getFullYear() && initialYear <= finalYear &&
                    Number.isSafeInteger(config.selectionRevision) && config.selectionRevision > 0 &&
                    config.periodPolicy === 'tvi-seasonal-v1' &&
                    ['local_cloud', 'local_unusable'].indexOf(config.selectionStrategy) >= 0 &&
                    Number.isFinite(config.bufferRadiusM) && config.bufferRadiusM >= 100 && config.bufferRadiusM <= 5000 &&
                    Array.isArray(config.profiles) && config.profiles.length > 0 && config.profiles.length <= 32 &&
                    config.profiles.every(function (profile) {
                        return typeof profile === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(profile);
                    }) && config.profiles.indexOf(config.defaultProfile) >= 0;
            };
            function stopTimer() {
                if (timer) $timeout.cancel(timer);
                timer = null;
            }
            function schedule() {
                stopTimer();
                if (!destroyed && $scope.offlineActive()) {
                    timer = $timeout(function () { timer = null; $scope.refreshOffline(true); }, 5000);
                }
            }
            $scope.refreshOffline = function (background) {
                if (destroyed || pending || $scope.offline.starting || $scope.offline.confirming) return;
                stopTimer();
                pending = true;
                $scope.offline.loading = true;
                $http.get(endpoint, { params: { page: $scope.offline.page }, timeout: cancel.promise,
                    hideLoading: background === true })
                    .then(function (response) {
                        if (destroyed) return;
                        applyStatus(response.data);
                        $scope.offline.error = null;
                    }, function (error) {
                        if (destroyed) return;
                        $scope.offline.error = (error.data && error.data.error) || 'Não foi possível consultar o progresso.';
                    }).finally(function () {
                        pending = false;
                        if (!destroyed) { $scope.offline.loading = false; schedule(); }
                    });
            };
            $scope.offlinePage = function (delta) {
                if (pending) return;
                $scope.offline.page = Math.max(0, $scope.offline.page + delta);
                $scope.refreshOffline();
            };
            $scope.startOffline = function (mode) {
                if (!$scope.offlineSupported() || destroyed || pending || $scope.offline.starting || $scope.offline.confirming || $scope.offlineActive()) return;
                var coverage = $scope.offline.status && $scope.offline.status.config;
                var useCoverage = coverage && (mode === 'retry_failed' || $scope.details !== 'true');
                var width = useCoverage ? coverage.width : $scope.offline.width;
                var height = useCoverage ? coverage.height : $scope.offline.height;
                if (![width, height].every(function(value) {
                    return typeof value === 'number' && value >= 256 && value <= 2048 && value % 1 === 0;
                })) {
                    $scope.offline.error = 'Informe largura e altura inteiras entre 256 e 2048 pixels.';
                    return;
                }
                function send() {
                    if (!$scope.offlineSupported() || destroyed || pending || $scope.offline.starting || $scope.offlineActive()) return;
                    stopTimer();
                    $scope.offline.starting = true;
                    $scope.offline.error = null;
                    $http.post(endpoint, { mode: mode, width: width, height: height }, { timeout: cancel.promise })
                        .then(function (response) {
                            if (destroyed) return;
                            applyStatus(response.data);
                            $scope.offline.page = 0;
                        }, function (error) {
                            if (!destroyed) $scope.offline.error = (error.data && error.data.error) || 'Falha ao iniciar o cache offline.';
                        }).finally(function () {
                            if (!destroyed) { $scope.offline.starting = false; schedule(); }
                        });
                }
                if (mode === 'regenerate') {
                    $scope.offline.confirming = true;
                    NotificationDialog.confirm('Todas as imagens da cobertura desta campanha serão geradas novamente. A operação consome recursos da fonte. Deseja continuar?', 'Regenerar cache da campanha')
                        .then(function (confirmed) {
                            $scope.offline.confirming = false;
                            if (confirmed) send();
                        }, function () { $scope.offline.confirming = false; });
                } else send();
            };
            $scope.$on('$destroy', function () {
                destroyed = true;
                stopTimer();
                cancel.resolve();
            });
            $scope.refreshOffline(true);
        }
    };
});
