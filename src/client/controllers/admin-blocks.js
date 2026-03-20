'use strict';

Application.controller('AdminBlocksController', function ($scope, $http, $routeParams, $location, $uibModal, NotificationDialog) {
    $scope.campaignId = $routeParams.id;
    $scope.campaign = null;
    $scope.blocks = [];
    $scope.loading = false;
    $scope.user = null;

    $scope.pagination = {
        currentPage: 1,
        totalPages: 1,
        totalBlocks: 0,
        limit: 20,
        hasNext: false,
        hasPrev: false
    };

    $scope.filters = {
        status: '',
        assignedTo: '',
        inspectionRound: ''
    };

    $scope.summary = {
        total: 0,
        byStatus: {},
        byInspector: {}
    };

    // Geração de blocos
    $scope.generateForm = {
        blockSize: 5,
        timeoutMinutes: 480
    };

    // Verificar autenticação
    $scope.checkAuth = function() {
        $scope.$root.isAdminMode = true;

        $http.get('/api/admin/check').then(function(response) {
            if (!response.data.authenticated) {
                $location.path('/admin/login');
            } else {
                $scope.user = response.data.user;
                $scope.loadCampaign();
            }
        }, function() {
            $location.path('/admin/login');
        });
    };

    // Carregar dados da campanha
    $scope.loadCampaign = function() {
        $http.get('/api/campaigns/' + $scope.campaignId).then(function(response) {
            $scope.campaign = response.data;
            $scope.loadBlocks();
            $scope.loadSummary();
        }, function() {
            NotificationDialog.error('Campanha não encontrada');
            $location.path('/admin/campaigns');
        });
    };

    // Carregar blocos com paginação e filtros
    $scope.loadBlocks = function(page) {
        if (page) {
            $scope.pagination.currentPage = page;
        }

        $scope.loading = true;

        var params = '?page=' + $scope.pagination.currentPage + '&limit=' + $scope.pagination.limit;

        if ($scope.filters.status) {
            params += '&status=' + encodeURIComponent($scope.filters.status);
        }
        if ($scope.filters.assignedTo) {
            params += '&assignedTo=' + encodeURIComponent($scope.filters.assignedTo);
        }
        if ($scope.filters.inspectionRound) {
            params += '&inspectionRound=' + $scope.filters.inspectionRound;
        }

        $http.get('/api/campaigns/' + $scope.campaignId + '/blocks' + params).then(function(response) {
            $scope.blocks = response.data.blocks;
            $scope.pagination = response.data.pagination;
            $scope.loading = false;
        }, function(error) {
            $scope.loading = false;
            if (error.status === 401) {
                $location.path('/admin/login');
            } else {
                NotificationDialog.error('Erro ao carregar blocos');
            }
        });
    };

    // Carregar resumo
    $scope.loadSummary = function() {
        $http.get('/api/campaigns/' + $scope.campaignId + '/blocks/summary').then(function(response) {
            $scope.summary = response.data;
        });
    };

    // Gerar blocos
    $scope.generateBlocks = function() {
        NotificationDialog.confirm(
            'Gerar blocos com tamanho ' + $scope.generateForm.blockSize +
            ' e timeout de ' + $scope.generateForm.timeoutMinutes + ' minutos?',
            'Gerar Blocos'
        ).then(function(confirmed) {
            if (!confirmed) return;

            $scope.loading = true;
            $http.post('/api/campaigns/' + $scope.campaignId + '/generate-blocks', {
                blockSize: $scope.generateForm.blockSize,
                timeoutMinutes: $scope.generateForm.timeoutMinutes
            }).then(function(response) {
                $scope.loading = false;
                NotificationDialog.success(
                    'Blocos gerados: ' + response.data.totalBlocks +
                    ' blocos (' + response.data.blocksPerRound + ' por rodada, ' +
                    response.data.rounds + ' rodada(s))'
                );
                $scope.loadBlocks();
                $scope.loadSummary();
            }, function(error) {
                $scope.loading = false;
                NotificationDialog.error(error.data.error || 'Erro ao gerar blocos');
            });
        });
    };

    // Descartar bloco
    $scope.discardBlock = function(block) {
        NotificationDialog.confirm(
            'Descartar bloco ' + block.blockIndex + ' (rodada ' + block.inspectionRound + ')?\n' +
            'As inspeções do inspetor "' + (block.assignedTo || '-') + '" serão removidas dos pontos.',
            'Descartar Bloco'
        ).then(function(confirmed) {
            if (!confirmed) return;

            $http.post('/api/campaigns/' + $scope.campaignId + '/blocks/' + block.blockIndex + '/discard', {
                inspectionRound: block.inspectionRound,
                reason: 'Descarte manual via admin',
                discardedBy: $scope.user ? $scope.user.username : 'admin'
            }).then(function() {
                NotificationDialog.success('Bloco descartado e recriado para reinspeção');
                $scope.loadBlocks();
                $scope.loadSummary();
            }, function(error) {
                NotificationDialog.error(error.data.error || 'Erro ao descartar bloco');
            });
        });
    };

    // Liberar blocos expirados
    $scope.releaseExpired = function() {
        NotificationDialog.confirm(
            'Liberar todos os blocos com timeout expirado?',
            'Liberar Expirados'
        ).then(function(confirmed) {
            if (!confirmed) return;

            $http.post('/api/campaigns/' + $scope.campaignId + '/blocks/release-expired').then(function(response) {
                NotificationDialog.success(response.data.releasedCount + ' bloco(s) liberado(s)');
                $scope.loadBlocks();
                $scope.loadSummary();
            }, function(error) {
                NotificationDialog.error(error.data.error || 'Erro ao liberar blocos');
            });
        });
    };

    // Remover todos os blocos
    $scope.deleteAllBlocks = function() {
        NotificationDialog.confirm(
            'ATENÇÃO: Remover TODOS os blocos desta campanha? Os pontos e inspeções não serão afetados.',
            'Remover Todos os Blocos'
        ).then(function(confirmed) {
            if (!confirmed) return;

            $http.delete('/api/campaigns/' + $scope.campaignId + '/blocks', {
                data: { force: true },
                headers: { 'Content-Type': 'application/json' }
            }).then(function(response) {
                NotificationDialog.success(response.data.deletedCount + ' bloco(s) removido(s)');
                $scope.loadBlocks();
                $scope.loadSummary();
            }, function(error) {
                NotificationDialog.error(error.data.error || 'Erro ao remover blocos');
            });
        });
    };

    // Aplicar filtros
    $scope.applyFilters = function() {
        $scope.pagination.currentPage = 1;
        $scope.loadBlocks();
    };

    // Limpar filtros
    $scope.clearFilters = function() {
        $scope.filters = { status: '', assignedTo: '', inspectionRound: '' };
        $scope.applyFilters();
    };

    // Navegação
    $scope.navigateBack = function() {
        $location.path('/admin/campaigns');
    };

    $scope.goToPage = function(page) {
        if (page >= 1 && page <= $scope.pagination.totalPages) {
            $scope.loadBlocks(page);
        }
    };

    $scope.nextPage = function() {
        if ($scope.pagination.hasNext) {
            $scope.goToPage($scope.pagination.currentPage + 1);
        }
    };

    $scope.prevPage = function() {
        if ($scope.pagination.hasPrev) {
            $scope.goToPage($scope.pagination.currentPage - 1);
        }
    };

    $scope.getPages = function() {
        var pages = [];
        var current = $scope.pagination.currentPage;
        var total = $scope.pagination.totalPages;
        var start = Math.max(1, current - 2);
        var end = Math.min(total, current + 2);

        for (var i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    };

    // Helpers de exibição
    $scope.getStatusLabel = function(status) {
        var labels = {
            'available': 'Disponível',
            'assigned': 'Em inspeção',
            'completed': 'Concluído',
            'discarded': 'Descartado'
        };
        return labels[status] || status;
    };

    $scope.getStatusClass = function(status) {
        var classes = {
            'available': 'status-available',
            'assigned': 'status-assigned',
            'completed': 'status-completed',
            'discarded': 'status-discarded'
        };
        return classes[status] || '';
    };

    $scope.formatDate = function(dateStr) {
        if (!dateStr) return '-';
        var d = new Date(dateStr);
        var pad = function(n) { return n < 10 ? '0' + n : n; };
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' +
               pad(d.getHours()) + ':' + pad(d.getMinutes());
    };

    $scope.getInspectorList = function() {
        var inspectors = [];
        if ($scope.summary && $scope.summary.byInspector) {
            for (var name in $scope.summary.byInspector) {
                inspectors.push(name);
            }
        }
        return inspectors;
    };

    // Logout
    $scope.logout = function() {
        $scope.$root.isAdminMode = false;
        $http.post('/api/admin/logout').then(function() {
            $location.path('/admin/login');
        });
    };

    // Inicializar
    $scope.checkAuth();
});
