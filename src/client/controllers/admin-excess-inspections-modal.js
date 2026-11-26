'use strict';

/**
 * Controller — modal de gerenciamento de inspeções excedentes (Tier 2.10).
 *
 * Endpoints consumidos:
 *   GET  /api/admin/campaigns/:id/excess-inspections
 *   POST /api/admin/campaigns/:id/excess-inspections/preview
 *   POST /api/admin/campaigns/:id/excess-inspections/apply
 *   GET  /api/admin/campaigns/:id/excess-inspections/history
 *
 * Apply exige token destrutivo (60s) obtido em /api/admin/destructive-token.
 */
Application.controller('AdminExcessInspectionsModalController',
    function ($scope, $http, NotificationDialog, campaign) {

        $scope.campaign = campaign;
        $scope.activeTab = 'list';

        // Estado da tab 1 (lista)
        $scope.listItems = [];
        $scope.listTotal = 0;
        $scope.listPage = 1;
        $scope.listLimit = 50;
        $scope.loadingList = false;
        $scope.filters = { biome: '', uf: '', inspector: '', minExcess: 1 };

        // Estado da tab 2 (configurar)
        $scope.config = {
            rule: 'keepOldest',
            keepInspectorsRaw: '',
            filters: { biome: '', uf: '', inspector: '' },
            maxPoints: 500
        };
        $scope.preview = null;
        $scope.previewLimit = 50;
        $scope.previewing = false;
        $scope.applyReason = '';
        $scope.applying = false;
        $scope.applyResult = null;

        // Estado da tab 3 (histórico)
        $scope.historyItems = [];
        $scope.historyTotal = 0;
        $scope.historyPage = 1;
        $scope.historyLimit = 50;
        $scope.loadingHistory = false;
        $scope.historyFilters = { actor: '' };

        // Resumo geral
        $scope.summary = { total: 0 };

        function baseUrl() {
            return '/api/admin/campaigns/' + encodeURIComponent($scope.campaign._id) + '/excess-inspections';
        }

        function buildListParams() {
            var p = {
                page: $scope.listPage,
                limit: $scope.listLimit
            };
            if ($scope.filters.biome) p.biome = $scope.filters.biome;
            if ($scope.filters.uf) p.uf = $scope.filters.uf;
            if ($scope.filters.inspector) p.inspector = $scope.filters.inspector;
            if ($scope.filters.minExcess) p.minExcess = $scope.filters.minExcess;
            return p;
        }

        $scope.setTab = function (tab) {
            $scope.activeTab = tab;
            if (tab === 'list' && $scope.listItems.length === 0) $scope.loadList();
            if (tab === 'history' && $scope.historyItems.length === 0) $scope.loadHistory();
        };

        var filterTimer = null;
        var destroyed = false;
        $scope.$on('$destroy', function() {
            destroyed = true;
            clearTimeout(filterTimer);
        });
        $scope.onFilterChange = function () {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(function () {
                $scope.listPage = 1;
                $scope.$apply($scope.loadList);
            }, 400);
        };

        $scope.goPage = function (n) {
            $scope.listPage = n;
            $scope.loadList();
        };

        $scope.loadList = function () {
            $scope.loadingList = true;
            $http.get(baseUrl(), { params: buildListParams() })
                .then(function (resp) {
                    $scope.listItems = resp.data.items || [];
                    $scope.listTotal = resp.data.total || 0;
                    $scope.summary.total = resp.data.total || 0;
                })
                .catch(function (err) {
                    NotificationDialog.error('Erro ao carregar lista: ' + (err.data && err.data.error || err.statusText));
                })
                .finally(function () {
                    $scope.loadingList = false;
                });
        };

        $scope.clearPreview = function () {
            $scope.preview = null;
            $scope.applyReason = '';
            $scope.applyResult = null;
        };

        $scope.showAllPreview = function () {
            $scope.previewLimit = $scope.preview ? $scope.preview.actions.length : 50;
        };

        $scope.runPreview = function () {
            $scope.preview = null;
            $scope.applyResult = null;
            $scope.previewing = true;

            var body = {
                rule: $scope.config.rule,
                filters: {},
                maxPoints: parseInt($scope.config.maxPoints, 10) || 500
            };
            if ($scope.config.filters.biome) body.filters.biome = $scope.config.filters.biome;
            if ($scope.config.filters.uf) body.filters.uf = $scope.config.filters.uf;
            if ($scope.config.filters.inspector) body.filters.inspector = $scope.config.filters.inspector;
            if ($scope.config.rule === 'keepInspectors') {
                body.keepInspectors = ($scope.config.keepInspectorsRaw || '')
                    .split(',')
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s.length > 0; });
                if (body.keepInspectors.length === 0) {
                    NotificationDialog.error('Informe ao menos 1 username em "Usernames a manter".');
                    $scope.previewing = false;
                    return;
                }
            }

            $http.post(baseUrl() + '/preview', body)
                .then(function (resp) {
                    $scope.preview = resp.data;
                    $scope.previewLimit = 50;
                })
                .catch(function (err) {
                    NotificationDialog.error('Erro no preview: ' + (err.data && err.data.error || err.statusText));
                })
                .finally(function () {
                    $scope.previewing = false;
                });
        };

        function requestDestructiveToken(preview) {
            return $http.post('/api/admin/destructive-token', {
                intent: 'removeExcessInspections',
                context: {
                    campaignId: $scope.campaign._id,
                    previewId: preview.previewId
                }
            }).then(function (resp) {
                return resp.data && resp.data.token;
            });
        }

        $scope.applyChanges = function () {
            if (destroyed || $scope.applying || !$scope.preview || !$scope.preview.previewId) return;
            if (!$scope.applyReason || $scope.applyReason.length < 10) {
                NotificationDialog.error('A justificativa deve ter ao menos 10 caracteres.');
                return;
            }
            var preview = angular.copy($scope.preview);
            var reason = $scope.applyReason;
            var message = 'Confirma a remoção de ' + preview.totalRemovals + ' inspeções em '
                + preview.totalAffected + ' pontos? A operação será registrada na auditoria.';
            $scope.applying = true;
            return NotificationDialog.confirm(message, 'Remover inspeções excedentes').then(function(confirmed) {
                if (!confirmed || destroyed) return;
                return requestDestructiveToken(preview).then(function(token) {
                    if (destroyed) return;
                    if (!token) throw new Error('Não foi possível obter o token destrutivo.');
                    return $http.post(baseUrl() + '/apply', {
                        previewId: preview.previewId,
                        expectedCount: preview.totalAffected,
                        confirmationToken: token,
                        reason: reason
                    });
                }).then(function(resp) {
                    if (destroyed || !resp) return;
                    $scope.applyResult = resp.data;
                    $scope.preview = null;
                    $scope.applyReason = '';
                    $scope.loadList();
                });
            }).catch(function(err) {
                var msg = (err.data && err.data.error) || err.message || err.statusText;
                if (!destroyed) NotificationDialog.error('Erro ao aplicar: ' + msg);
            }).finally(function() {
                $scope.applying = false;
            });
        };

        $scope.loadHistory = function () {
            $scope.loadingHistory = true;
            var params = { page: $scope.historyPage, limit: $scope.historyLimit };
            if ($scope.historyFilters.actor) params.actor = $scope.historyFilters.actor;
            $http.get(baseUrl() + '/history', { params: params })
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
        $scope.loadList();
    }
);
