'use strict';

Application.directive('campaignOfflineCache', function () {
    return {
        restrict: 'E',
        scope: { campaignId: '=', campaign: '=' },
        templateUrl: 'views/campaign-offline-cache.tpl.html',
        controller: function ($scope, $http, $timeout, $q, NotificationDialog) {
            var destroyed = false;
            var timer = null;
            var pending = false;
            var cancel = $q.defer();
            var endpoint = '/api/cache/campaign/' + encodeURIComponent($scope.campaignId) + '/offline';
            $scope.offline = { status: null, error: null, starting: false, loading: false,
                width: 512, height: 512, page: 0 };
            $scope.offlineLabels = {
                not_started: 'Não iniciado', preparing: 'Calculando cobertura', running: 'Gerando imagens',
                completed: 'Concluído', stale: 'Configuração alterada; verificar novamente', blocked: 'Intervenção necessária', pending: 'Pendente',
                processing: 'Em processamento', retry_wait: 'Aguardando retentativa', no_data: 'Ausência comprovada de dados'
            };
            $scope.offlineReasons = {
                empty_collection: 'Nenhuma cena disponível para os critérios do período',
                invalid_tile: 'Imagem inválida; ausência de dados não comprovada',
                cache_expired: 'Imagem vencida ou sem validade comprovada; verificar novamente',
                gee_credential_denied: 'Credencial recusada', GoogleAdmissionError: 'Limite de chamadas atingido',
                EarthEngineRateLimitedError: 'Limitação do Earth Engine', TimeoutError: 'Tempo de resposta excedido',
                source_unavailable: 'Fonte ou armazenamento indisponível'
            };
            $scope.offlineActive = function () {
                var status = $scope.offline.status && $scope.offline.status.status;
                return status === 'preparing' || status === 'running';
            };
            $scope.offlineSupported = function () {
                return $scope.campaign && $scope.campaign.useDynamicMaps === true &&
                    ['landsat', 'sentinel-2'].indexOf($scope.campaign.imageType) >= 0 &&
                    !($scope.campaign.wmsConfig && $scope.campaign.wmsConfig.enabled);
            };
            function stopTimer() {
                if (timer) $timeout.cancel(timer);
                timer = null;
            }
            function schedule() {
                stopTimer();
                if (!destroyed && $scope.offlineActive()) {
                    timer = $timeout(function () { timer = null; $scope.refreshOffline(); }, 5000);
                }
            }
            $scope.refreshOffline = function () {
                if (destroyed || pending || $scope.offline.starting) return;
                stopTimer();
                pending = true;
                $scope.offline.loading = true;
                $http.get(endpoint, { params: { page: $scope.offline.page }, timeout: cancel.promise })
                    .then(function (response) {
                        if (destroyed) return;
                        $scope.offline.status = response.data;
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
                if (destroyed || pending || $scope.offline.starting || $scope.offlineActive()) return;
                function send() {
                    if (destroyed || $scope.offline.starting) return;
                    stopTimer();
                    $scope.offline.starting = true;
                    $scope.offline.error = null;
                    var coverage = $scope.offline.status && $scope.offline.status.config;
                    var width = mode === 'retry_failed' && coverage ? coverage.width : $scope.offline.width;
                    var height = mode === 'retry_failed' && coverage ? coverage.height : $scope.offline.height;
                    $http.post(endpoint, { mode: mode, width: width, height: height }, { timeout: cancel.promise })
                        .then(function (response) {
                            if (destroyed) return;
                            $scope.offline.status = response.data;
                            $scope.offline.page = 0;
                        }, function (error) {
                            if (!destroyed) $scope.offline.error = (error.data && error.data.error) || 'Falha ao iniciar o cache offline.';
                        }).finally(function () {
                            if (!destroyed) { $scope.offline.starting = false; schedule(); }
                        });
                }
                if (mode === 'regenerate') {
                    NotificationDialog.confirm('Todas as imagens da cobertura desta campanha serão geradas novamente. A operação consome recursos da fonte. Deseja continuar?', 'Regenerar cache da campanha')
                        .then(function (confirmed) { if (confirmed) send(); });
                } else send();
            };
            $scope.$on('$destroy', function () {
                destroyed = true;
                stopTimer();
                cancel.resolve();
            });
            $scope.refreshOffline();
        }
    };
});
