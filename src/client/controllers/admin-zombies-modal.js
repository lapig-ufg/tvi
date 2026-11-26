'use strict';

/**
 * Controller — modal de monitoramento de pontos zumbi (Tier 2.10).
 *
 * Endpoints consumidos:
 *   GET  /api/admin/campaigns/:id/zombies          (contagem + amostra)
 *   POST /api/admin/campaigns/:id/recover-zombies  (cria blocos recovery)
 *   GET  /api/admin/campaigns/:id/zombies/history  (tvi_zombie_counts)
 */
Application.controller('AdminZombiesModalController',
    function ($scope, $http, NotificationDialog, campaign) {

        $scope.campaign = campaign;
        $scope.activeTab = 'list';

        // Tab 1
        $scope.report = { total: undefined, byUserNameLength: {}, sample: [] };
        $scope.loadingReport = false;
        $scope.recovering = false;
        $scope.recoveryResult = null;

        // Tab 2
        $scope.historyItems = [];
        $scope.historyTotal = 0;
        $scope.historyPage = 1;
        $scope.historyLimit = 50;
        $scope.loadingHistory = false;

        function baseUrl() {
            return '/api/admin/campaigns/' + encodeURIComponent($scope.campaign._id);
        }

        $scope.setTab = function (tab) {
            $scope.activeTab = tab;
            if (tab === 'history' && $scope.historyItems.length === 0) {
                $scope.loadHistory();
            }
        };

        $scope.loadZombies = function () {
            $scope.loadingReport = true;
            $http.get(baseUrl() + '/zombies', { params: { sampleSize: 50 } })
                .then(function (resp) {
                    $scope.report = resp.data;
                })
                .catch(function (err) {
                    NotificationDialog.error('Erro ao carregar zumbis: ' + (err.data && err.data.error || err.statusText));
                })
                .finally(function () {
                    $scope.loadingReport = false;
                });
        };

        var destroyed = false;
        $scope.$on('$destroy', function() { destroyed = true; });

        $scope.recoverZombies = function () {
            if (destroyed || $scope.recovering || !$scope.report || !$scope.report.total) return;
            var msg = 'Confirma criar blocos de recuperação para ' + $scope.report.total + ' pontos? '
                + 'Pontos já cobertos por blocos disponíveis ou atribuídos serão ignorados.';
            $scope.recovering = true;
            return NotificationDialog.confirm(msg, 'Recuperar pontos').then(function(confirmed) {
                if (!confirmed || destroyed) return;
                $scope.recoveryResult = null;
                return $http.post(baseUrl() + '/recover-zombies', {}).then(function(resp) {
                    if (destroyed) return;
                    $scope.recoveryResult = resp.data;
                    $scope.loadZombies();
                });
            }).catch(function(err) {
                if (!destroyed) NotificationDialog.error('Erro ao recuperar pontos: ' + (err.data && err.data.error || err.statusText));
            }).finally(function() {
                $scope.recovering = false;
            });
        };

        $scope.loadHistory = function () {
            $scope.loadingHistory = true;
            $http.get(baseUrl() + '/zombies/history', {
                    params: { page: $scope.historyPage, limit: $scope.historyLimit }
                })
                .then(function (resp) {
                    $scope.historyItems = resp.data.items || [];
                    $scope.historyTotal = resp.data.total || 0;
                })
                .catch(function (err) {
                    NotificationDialog.error('Erro ao carregar histórico: ' + (err.data && err.data.error || err.statusText));
                })
                .finally(function () {
                    $scope.loadingHistory = false;
                });
        };

        $scope.goHistoryPage = function (n) {
            $scope.historyPage = n;
            $scope.loadHistory();
        };

        // Init
        $scope.loadZombies();
    }
);
