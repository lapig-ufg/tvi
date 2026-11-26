'use strict';

Application.controller('CampaignPointMutationsController', function($scope, $http, $interval, $window, campaign, campaignId, mutationAction, pointId) {
    var base = '/api/campaigns/' + encodeURIComponent(campaignId) + '/point-operations';
    var destroyed = false;
    var revision = 0;
    var poll = null;
    var refreshing = false;
    var reader = null;
    $scope.campaign = campaign;
    $scope.campaignId = campaignId;
    $scope.input = { kind: mutationAction === 'delete' ? 'delete' : 'add', format: pointId ? 'ids' : 'geojson', content: pointId || '' };
    $scope.approval = { confirmation: '', reason: '' };
    $scope.operations = [];
    $scope.unsentChanges = false;
    $scope.markUnsaved = function() { $scope.unsentChanges = true; };

    function errorText(error) {
        return error.data && (error.data.error || error.data.message) || 'Não foi possível concluir a solicitação.';
    }
    function active(job) { return job.status === 'confirming' || job.status === 'queued' || job.status === 'running'; }
    function stopPolling() {
        if (poll) $interval.cancel(poll);
        poll = null;
    }
    function updatePolling() {
        if ($scope.operations.some(active)) {
            if (!poll && !destroyed) poll = $interval($scope.refreshOperations, 5000);
        } else stopPolling();
    }
    $scope.refreshOperations = function() {
        if (destroyed || refreshing || $scope.applying) return;
        refreshing = true;
        return $http.get(base, { hideLoading: true }).then(function(response) {
            if (destroyed) return;
            $scope.operations = response.data.operations || [];
            $scope.historyError = null;
            updatePolling();
        }, function(error) {
            if (!destroyed) $scope.historyError = errorText(error);
        }).finally(function() { refreshing = false; });
    };
    $scope.invalidatePreview = function() {
        revision++;
        $scope.unsentChanges = true;
        $scope.preview = null;
        $scope.previewLoading = false;
        $scope.error = null;
        $scope.approval = { confirmation: '', reason: '' };
        $scope.resumeJob = null;
    };
    $scope.changeKind = function() {
        $scope.input.format = 'geojson';
        $scope.input.content = '';
        $scope.fileName = null;
        $scope.invalidatePreview();
    };
    $scope.readFile = function(element) {
        var file = element.files && element.files[0];
        element.value = '';
        if (reader) reader.abort();
        $scope.$applyAsync(function() {
            $scope.invalidatePreview();
            $scope.input.content = '';
            $scope.fileName = file && file.name;
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                $scope.error = 'O arquivo deve ter no máximo 5 MB.';
                return;
            }
            var current = revision;
            reader = new $window.FileReader();
            reader.onload = function(event) {
                $scope.$applyAsync(function() {
                    if (!destroyed && current === revision) $scope.input.content = event.target.result;
                });
            };
            reader.onerror = function() {
                $scope.$applyAsync(function() {
                    if (!destroyed && current === revision) $scope.error = 'Não foi possível ler o arquivo.';
                });
            };
            reader.readAsText(file);
        });
    };
    $scope.requestPreview = function() {
        if (destroyed || $scope.previewLoading || $scope.applying || !$scope.input.content.trim()) return;
        $scope.invalidatePreview();
        var current = revision;
        if (new $window.Blob([$scope.input.content]).size > 5 * 1024 * 1024) {
            $scope.error = 'O conteúdo deve ter no máximo 5 MB.';
            return;
        }
        var payload = { kind: $scope.input.kind, format: $scope.input.format, content: $scope.input.content };
        if (payload.format === 'ids') payload.ids = payload.content.split(/[\r\n,]+/).map(function(id) { return id.trim(); }).filter(Boolean);
        $scope.previewLoading = true;
        return $http.post(base + '/preview', payload, { hideLoading: true }).then(function(response) {
            if (!destroyed && current === revision) $scope.preview = response.data;
        }, function(error) {
            if (!destroyed && current === revision) $scope.error = errorText(error);
        }).finally(function() {
            if (!destroyed && current === revision) $scope.previewLoading = false;
        });
    };
    $scope.canConfirm = function() {
        var target = $scope.resumeJob || $scope.preview;
        return !!(target && !$scope.applying && !refreshing && $scope.approval.confirmation === campaignId &&
            $scope.approval.reason.trim().length >= 10 && ($scope.resumeJob ||
                (target.canApply && Date.parse(target.expiresAt) > Date.now())));
    };
    $scope.prepareResume = function(job) {
        if ($scope.applying || job.status !== 'failed') return;
        $scope.invalidatePreview();
        $scope.resumeJob = job;
    };
    $scope.confirmOperation = function() {
        if (destroyed || !$scope.canConfirm()) return;
        var target = $scope.resumeJob || $scope.preview;
        var endpoint = $scope.resumeJob ? '/resume' : '/confirm';
        var refreshAfterFailure = false;
        $scope.applying = true;
        $scope.error = null;
        return $http.post(base + '/' + encodeURIComponent(target.id) + endpoint, {
            confirmation: $scope.approval.confirmation, reason: $scope.approval.reason.trim()
        }, { hideLoading: true }).then(function(response) {
            if (destroyed) return;
            $scope.operations = [response.data].concat($scope.operations.filter(function(job) { return job.id !== response.data.id; }));
            $scope.invalidatePreview();
            $scope.input.content = '';
            $scope.fileName = null;
            $scope.unsentChanges = false;
            updatePolling();
        }, function(error) {
            refreshAfterFailure = true;
            if (!destroyed) $scope.error = errorText(error);
        }).finally(function() {
            if (destroyed) return;
            $scope.applying = false;
            if (refreshAfterFailure) return $scope.refreshOperations();
        });
    };
    $scope.affectedCount = function(job) {
        if (typeof job.affected === 'number') return job.affected;
        return Math.max(0, (job.processed || 0) - (job.skipped || 0));
    };
    $scope.outcomeLabel = function(status) {
        return { skipped: 'Não aplicado', added: 'Adicionado', deleted: 'Excluído' }[status] || status;
    };
    $scope.statusLabel = function(status) {
        return { preview: 'Prévia', confirming: 'Confirmando', queued: 'Na fila', running: 'Em processamento', completed: 'Concluída', failed: 'Falhou' }[status] || status;
    };
    $scope.$on('$destroy', function() {
        destroyed = true;
        revision++;
        stopPolling();
        if (reader) reader.abort();
    });
    $scope.refreshOperations();
});
