'use strict';

Application.controller('AdminCampaignController', function ($scope, $http, AdminPages, $window, $location, $timeout, NotificationDialog, sampleMarkerService) {
    $scope.campaigns = [];
    var destroyed = false;
    var deletionPending = false;
    var actionMenuFocus;

    function availableMenuButtons(menu) {
        return Array.prototype.filter.call(menu.querySelectorAll('button'), function(button) {
            return !button.disabled && button.getClientRects().length > 0;
        });
    }

    $scope.campaignActionsToggled = function(open, menuId) {
        if (actionMenuFocus) $timeout.cancel(actionMenuFocus);
        if (!open) return;
        actionMenuFocus = $timeout(function() {
            if (destroyed) return;
            var menu = $window.document.getElementById(menuId);
            if (!menu) return;
            var rect = menu.getBoundingClientRect();
            if (rect.bottom > $window.innerHeight - 12) {
                menu.style.top = Math.max(12, $window.innerHeight - rect.height - 12) + ($window.pageYOffset || 0) + 'px';
            }
            if (rect.left < 12 || rect.right > $window.innerWidth - 12) {
                menu.style.left = Math.max(12, Math.min(rect.left, $window.innerWidth - rect.width - 12)) + ($window.pageXOffset || 0) + 'px';
                menu.style.right = 'auto';
            }
            var buttons = availableMenuButtons(menu);
            if (buttons.length) buttons[0].focus();
        });
    };

    $scope.campaignMenuKeydown = function(event, open) {
        var menu = event.currentTarget;
        if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
            var toggle = $window.document.getElementById(menu.getAttribute('aria-labelledby'));
            if (toggle) toggle.focus();
            return false;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) === -1) return open;
        event.preventDefault();
        event.stopPropagation();
        var buttons = availableMenuButtons(menu);
        if (!buttons.length) return open;
        var index = buttons.indexOf(event.target);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index].focus();
        return open;
    };
    $scope.loading = false;
    $scope.pagination = {
        currentPage: 1,
        totalPages: 1,
        totalCampaigns: 0,
        limit: 10,
        hasNext: false,
        hasPrev: false
    };
    $scope.user = null;
    
    // Filtros avançados
    $scope.showFilters = false;
    $scope.filters = {
        campaignId: '',
        initialYear: '',
        finalYear: '',
        numInspec: '',
        progressStatus: '',
        imageType: '',
        showTimeseries: null,
        showPointInfo: null,
        useDynamicMaps: null,
        sortBy: '_id'
    };
    
    // Opções dinâmicas para filtros (populadas via /api/campaigns/filter-options)
    $scope.availableYears = [];
    $scope.availableImageTypes = [];
    $scope.availableNumInspec = [1, 2, 3, 4, 5];

    // Estado do typeahead do campo "ID da Campanha"
    $scope.typeaheadLoading = false;
    $scope.typeaheadNoResults = false;

    // Estatísticas
    $scope.stats = {
        total: 0,
        active: 0,
        completed: 0,
        totalPoints: 0
    };
    
    // Navegar de volta para o home
    $scope.navigateBack = function() {
        $location.path('/admin/home');
    };
    
    // Verificar autenticação
    $scope.checkAuth = function() {
        // Marcar que estamos no sistema admin
        $scope.$root.isAdminMode = true;
        // Admin mode activated
        
        $http.get('/api/admin/check').then(function(response) {
            if (!response.data.authenticated) {
                $location.path('/admin/login');
            } else {
                $scope.user = response.data.user;
                $scope.loadCampaigns();
                $scope.loadStats();
                $scope.loadFilterOptions();
            }
        }, function(error) {
            $location.path('/admin/login');
        });
    };

    // Logout
    $scope.logout = function() {
        // Limpar flag de modo admin
        $scope.$root.isAdminMode = false;
        
        $http.post('/api/admin/logout').then(function() {
            $location.path('/admin/login');
        });
    };

    // Carregar campanhas com filtros
    // Carregar estatísticas
    $scope.loadStats = function() {
        $http.get('/api/admin/campaigns/stats').then(function(response) {
            if (response.data.success && response.data.data) {
                $scope.stats = response.data.data;
            }
        }, function(error) {
            console.error('Error loading stats:', error);
        });
    };

    // Popula os selects de filtros com valores realmente presentes no banco
    $scope.loadFilterOptions = function() {
        $http.get('/api/campaigns/filter-options').then(function(response) {
            if (!response.data || !response.data.success) return;
            const data = response.data.data || {};
            const years = (data.initialYears || []).concat(data.finalYears || []);
            $scope.availableYears = years
                .filter(function(v, i, a) { return a.indexOf(v) === i; })
                .sort(function(a, b) { return a - b; });
            $scope.availableImageTypes = data.imageTypes || [];
            if (Array.isArray(data.numInspec) && data.numInspec.length > 0) {
                $scope.availableNumInspec = data.numInspec;
            }
        }, function(error) {
            console.error('Error loading filter options:', error);
        });
    };

    // Busca assíncrona para o uib-typeahead do campo "ID da Campanha"
    $scope.searchCampaigns = function(query) {
        if (!query || query.length < 2) return [];
        return $http.get('/api/campaigns/search', { params: { q: query, limit: 10 } })
            .then(function(response) {
                return (response.data && response.data.results) || [];
            }, function() {
                return [];
            });
    };

    // Debounce para auto-aplicação dos filtros ao alterar campos
    $scope.onFilterChange = function() {
        if ($scope.filterChangeTimeout) {
            $timeout.cancel($scope.filterChangeTimeout);
        }
        $scope.filterChangeTimeout = $timeout(function() {
            $scope.applyFilters();
        }, 300);
    };
    
    $scope.loadCampaigns = function(page) {
        // Loading campaigns with filters and pagination
        
        if (page) {
            $scope.pagination.currentPage = page;
        }
        
        $scope.loading = true;
        
        // Construir parâmetros incluindo filtros
        let params = `?page=${$scope.pagination.currentPage}&limit=${$scope.pagination.limit}`;
        
        // Adicionar filtros ativos
        if ($scope.filters.campaignId && $scope.filters.campaignId.trim()) {
            params += `&campaignId=${encodeURIComponent($scope.filters.campaignId.trim())}`;
        }
        if ($scope.filters.initialYear) {
            params += `&initialYear=${$scope.filters.initialYear}`;
        }
        if ($scope.filters.finalYear) {
            params += `&finalYear=${$scope.filters.finalYear}`;
        }
        if ($scope.filters.numInspec) {
            params += `&numInspec=${$scope.filters.numInspec}`;
        }
        if ($scope.filters.progressStatus) {
            params += `&progressStatus=${$scope.filters.progressStatus}`;
        }
        if ($scope.filters.imageType) {
            params += `&imageType=${encodeURIComponent($scope.filters.imageType)}`;
        }
        if ($scope.filters.showTimeseries !== null) {
            params += `&showTimeseries=${$scope.filters.showTimeseries}`;
        }
        if ($scope.filters.showPointInfo !== null) {
            params += `&showPointInfo=${$scope.filters.showPointInfo}`;
        }
        if ($scope.filters.useDynamicMaps !== null) {
            params += `&useDynamicMaps=${$scope.filters.useDynamicMaps}`;
        }
        if ($scope.filters.sortBy) {
            params += `&sortBy=${encodeURIComponent($scope.filters.sortBy)}`;
        }
        
        // Making API call to load campaigns
        
        $http.get('/api/campaigns' + params).then(function(response) {
            // API call successful, processing response
            $scope.campaigns = response.data.campaigns;
            $scope.pagination = response.data.pagination;
            $scope.loading = false;
        }, function(error) {
            console.error('Error loading campaigns:', error);
            // Error occurred while loading campaigns
            $scope.loading = false;
            if (error.status === 401) {
                // Redirecting to login due to 401 error
                $location.path('/admin/login');
            } else {
                NotificationDialog.error('Erro ao carregar campanhas');
            }
        });
    };
    
    // Funções de filtros
    $scope.toggleFilters = function() {
        $scope.showFilters = !$scope.showFilters;
    };
    
    $scope.applyFilters = function() {
        $scope.pagination.currentPage = 1;
        $scope.loadCampaigns();
    };
    
    $scope.clearFilters = function() {
        $scope.filters = {
            campaignId: '',
            initialYear: '',
            finalYear: '',
            numInspec: '',
            progressStatus: '',
            imageType: '',
            showTimeseries: null,
            showPointInfo: null,
            useDynamicMaps: null,
            sortBy: '_id'
        };
        $scope.applyFilters();
    };
    
    $scope.hasActiveFilters = function() {
        return !!(
            $scope.filters.campaignId ||
            $scope.filters.initialYear ||
            $scope.filters.finalYear ||
            $scope.filters.numInspec ||
            $scope.filters.progressStatus ||
            $scope.filters.imageType ||
            $scope.filters.showTimeseries !== null ||
            $scope.filters.showPointInfo !== null ||
            $scope.filters.useDynamicMaps !== null ||
            ($scope.filters.sortBy && $scope.filters.sortBy !== '_id')
        );
    };
    
    $scope.getActiveFiltersCount = function() {
        let count = 0;
        if ($scope.filters.campaignId) count++;
        if ($scope.filters.initialYear) count++;
        if ($scope.filters.finalYear) count++;
        if ($scope.filters.numInspec) count++;
        if ($scope.filters.progressStatus) count++;
        if ($scope.filters.imageType) count++;
        if ($scope.filters.showTimeseries !== null) count++;
        if ($scope.filters.showPointInfo !== null) count++;
        if ($scope.filters.useDynamicMaps !== null) count++;
        if ($scope.filters.sortBy && $scope.filters.sortBy !== '_id') count++;
        return count;
    };

    // Funções de navegação
    $scope.goToPage = function(page) {
        // Navigating to page with admin mode verification
        
        if (page >= 1 && page <= $scope.pagination.totalPages) {
            $scope.loadCampaigns(page);
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
        const pages = [];
        const current = $scope.pagination.currentPage;
        const total = $scope.pagination.totalPages;
        
        const start = Math.max(1, current - 2);
        const end = Math.min(total, current + 2);
        
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        
        return pages;
    };

    // Outras funções do gerenciamento de campanhas
    $scope.newCampaign = {
        landUse: [],
        initialYear: 1985,
        finalYear: 2024,
        numInspec: 3,
        showTimeseries: true,
        // TKT-000006: por padrão, novas campanhas carregam os gráficos de
        // série temporal automaticamente, mantendo o comportamento anterior
        // ao introduzir o flag e preservando a experiência dos inspectors.
        autoLoadTimeseries: true,
        showPointInfo: true,
        useDynamicMaps: false,
        imageType: 'landsat',
        zoomLevel: 13,
        sampleMarker: sampleMarkerService.core.defaults()
    };

    $scope.createCampaign = function() {
        rememberList();
        AdminPages.go('campaign-create', {});
    };

    $scope.editCampaign = function(campaign) {
        rememberList();
        AdminPages.go('campaign-edit', { campaignId: campaign._id });
    };

    $scope.deleteCampaign = function(campaign) {
        if (destroyed || deletionPending) return;
        const campaignId = campaign._id;
        deletionPending = true;
        return NotificationDialog.confirm(`Tem certeza que deseja deletar a campanha "${campaignId}"?`, 'Confirmar Exclusão').then(function(confirmed) {
            if (!confirmed || destroyed) {
                return;
            }
            
            return $http.delete('/api/campaigns/' + campaignId).then(function(response) {
                if (destroyed) return;
                if (response.data.success) {
                    $scope.loadCampaigns();
                    NotificationDialog.success('Campanha deletada com sucesso!');
                } else if (response.data.error) {
                    NotificationDialog.error('Erro: ' + response.data.error);
                }
            }, function(error) {
                if (destroyed) return;
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao deletar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        }).finally(function() { deletionPending = false; });
    };

    $scope.uploadGeoJSON = function(campaign) {
        rememberList();
        AdminPages.go('campaign-upload', { campaignId: campaign._id });
    };

    $scope.importClassifications = function(campaign) {
        rememberList();
        AdminPages.go('campaign-import', { campaignId: campaign._id });
    };

    $scope.viewPoints = function(campaign) {
        rememberList();
        AdminPages.go('campaign-points', { campaignId: campaign._id });
    };

    $scope.deletePoints = function(campaign) {
        if (destroyed) return;
        rememberList();
        AdminPages.go('campaign-point-mutations', { campaignId: campaign._id, action: 'delete' });
    };

    $scope.manageCampaign = function(campaign) {
        $location.path('/admin/campaigns/manage/' + campaign._id);
    };

    $scope.monitorCampaign = function(campaign) {
        $location.path('/admin/campaigns/' + campaign._id + '/monitoring');
    };

    $scope.manageBlocks = function(campaign) {
        $location.path('/admin/campaigns/' + campaign._id + '/blocks');
    };

    $scope.manageExcessInspections = function(campaign) {
        rememberList();
        AdminPages.go('campaign-excess', { campaignId: campaign._id });
    };

    $scope.manageZombies = function(campaign) {
        rememberList();
        AdminPages.go('campaign-zombies', { campaignId: campaign._id });
    };

    $scope.getProgressClass = function(progress) {
        if (progress < 33) return 'progress-bar-danger';
        if (progress < 66) return 'progress-bar-warning';
        return 'progress-bar-success';
    };

    $scope.$on('$destroy', function() {
        destroyed = true;
        if (actionMenuFocus) $timeout.cancel(actionMenuFocus);
        if ($scope.filterChangeTimeout) $timeout.cancel($scope.filterChangeTimeout);
    });

    var listQuery = $location.search();
    Object.keys($scope.filters).forEach(function(key) {
        var value = listQuery['f_' + key];
        if (typeof value === 'string') {
            $scope.filters[key] = ['showTimeseries', 'showPointInfo', 'useDynamicMaps'].indexOf(key) >= 0
                ? (value === 'true' ? true : value === 'false' ? false : null) : value;
        }
    });
    $scope.pagination.currentPage = Math.max(1, parseInt(listQuery.page, 10) || 1);
    $scope.showFilters = Object.keys($scope.filters).some(function(key) { return key !== 'sortBy' && $scope.filters[key] !== '' && $scope.filters[key] !== null; });

    function rememberList() {
        Object.keys($scope.filters).forEach(function(key) {
            var value = $scope.filters[key];
            $location.search('f_' + key, value === '' || value === null ? null : String(value));
        });
        $location.search('page', $scope.pagination.currentPage);
    }

    $scope.checkAuth();
});
