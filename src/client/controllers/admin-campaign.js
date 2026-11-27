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
    
    var listRequest = 0;
    var booleanFilters = ['showTimeseries', 'showPointInfo', 'useDynamicMaps', 'autoLoadTimeseries'];
    function defaultFilters() {
        return { campaignId: '', initialYear: '', finalYear: '', numInspec: '', progressStatus: '',
            imageType: '', imagerySource: '', bdcCollection: '', bdcSelectionStrategy: '',
            bdcDefaultProfile: '', bdcBufferRadiusM: '', zoomLevel: '', landUse: '',
            showTimeseries: null, showPointInfo: null, useDynamicMaps: null,
            autoLoadTimeseries: null, sortBy: 'createdAt' };
    }
    $scope.showFilters = false;
    $scope.filters = defaultFilters();
    $scope.filterOptions = {};
    $scope.availableYears = [];
    $scope.availableImageTypes = [];
    $scope.availableNumInspec = [];
    $scope.pageSizes = [10, 20, 50, 100];
    $scope.booleanOptions = [{ value: null, label: 'Todas' }, { value: true, label: 'Habilitadas' }, { value: false, label: 'Desabilitadas' }];
    $scope.configurationFilters = [
        { key: 'showTimeseries', label: 'Séries temporais' },
        { key: 'autoLoadTimeseries', label: 'Carregamento automático das séries' },
        { key: 'showPointInfo', label: 'Informações dos pontos' },
        { key: 'useDynamicMaps', label: 'Mapas dinâmicos' }
    ];
    $scope.filterLabels = { campaignId: 'Busca', initialYear: 'Ano inicial', finalYear: 'Ano final',
        numInspec: 'Inspeções por ponto', progressStatus: 'Progresso', imageType: 'Tipo de imagem',
        imagerySource: 'Fonte', bdcCollection: 'Coleção BDC', bdcSelectionStrategy: 'Critério BDC',
        bdcDefaultProfile: 'Composição BDC', bdcBufferRadiusM: 'Raio BDC', zoomLevel: 'Zoom', landUse: 'Classe',
        showTimeseries: 'Séries temporais', autoLoadTimeseries: 'Séries automáticas',
        showPointInfo: 'Informações dos pontos', useDynamicMaps: 'Mapas dinâmicos' };
    $scope.optionLabel = function(value) {
        var labels = { bdc: 'Brazil Data Cube (BDC)', legacy: 'Fonte legada (GEE, WMS ou Wayback)',
            landsat: 'Landsat', 'sentinel-2': 'Sentinel-2', wayback: 'Esri Wayback', wms: 'WMS',
            local_cloud: 'Menor cobertura de nuvens no ponto', global_cloud: 'Menor cobertura global de nuvens',
            'landsat-tvi-false': 'Falsa cor', 'landsat-tvi-true': 'Cor natural', 'landsat-tvi-ndvi': 'NDVI',
            empty: 'Sem pontos', notStarted: 'Não iniciada', started: 'Em andamento', completed: 'Concluída' };
        return labels[value] || value;
    };
    var activeFilterKey;
    var activeFilterItems = [];
    $scope.activeFilters = function() {
        var signature = JSON.stringify($scope.filters);
        if (signature === activeFilterKey) return activeFilterItems;
        activeFilterKey = signature;
        activeFilterItems = Object.keys($scope.filterLabels).filter(function(key) {
            var value = $scope.filters[key];
            return value !== '' && value !== null && value !== undefined;
        }).map(function(key) {
            var value = $scope.filters[key];
            return { key: key, label: $scope.filterLabels[key],
                value: typeof value === 'boolean' ? (value ? 'Habilitadas' : 'Desabilitadas') : $scope.optionLabel(value) };
        });
        return activeFilterItems;
    };
    $scope.onSourceChange = function() {
        if ($scope.filters.imagerySource === 'legacy') {
            ['bdcCollection', 'bdcSelectionStrategy', 'bdcDefaultProfile', 'bdcBufferRadiusM'].forEach(function(key) {
                $scope.filters[key] = '';
            });
        }
        $scope.onFilterChange();
    };
    $scope.removeFilter = function(key) {
        $scope.filters[key] = defaultFilters()[key];
        $scope.applyFilters();
    };

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
        $http.get('/api/admin/campaigns/stats', { hideLoading: true }).then(function(response) {
            if (destroyed) return;
            if (response.data.success && response.data.data) {
                $scope.stats = response.data.data;
            }
        }, function(error) {
            console.error('Error loading stats:', error);
        });
    };

    // Popula os selects de filtros com valores realmente presentes no banco
    $scope.loadFilterOptions = function() {
        $scope.filterOptionsError = false;
        $http.get('/api/campaigns/filter-options', { hideLoading: true }).then(function(response) {
            if (destroyed) return;
            if (!response.data || !response.data.success) return;
            const data = response.data.data || {};
            $scope.filterOptions = data;
            const years = (data.initialYears || []).concat(data.finalYears || []);
            $scope.availableYears = years
                .filter(function(v, i, a) { return a.indexOf(v) === i; })
                .sort(function(a, b) { return a - b; });
            $scope.availableImageTypes = data.imageTypes || [];
            if (Array.isArray(data.numInspec) && data.numInspec.length > 0) {
                $scope.availableNumInspec = data.numInspec;
            }
        }, function(error) {
            if (!destroyed) $scope.filterOptionsError = true;
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
        
        var requestId = ++listRequest;
        var params = '?page=' + $scope.pagination.currentPage + '&limit=' + $scope.pagination.limit;
        Object.keys($scope.filters).forEach(function(key) {
            var value = $scope.filters[key];
            if (typeof value === 'string') value = value.trim();
            if (value !== '' && value !== null && value !== undefined) {
                params += '&' + key + '=' + encodeURIComponent(value);
            }
        });
        $http.get('/api/campaigns' + params, { hideLoading: true }).then(function(response) {
            if (destroyed || requestId !== listRequest) return;
            $scope.campaigns = response.data.campaigns;
            $scope.pagination = response.data.pagination;
            $scope.loading = false;
        }, function(error) {
            if (destroyed || requestId !== listRequest) return;
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
        if ($scope.filterChangeTimeout) $timeout.cancel($scope.filterChangeTimeout);
        $scope.pagination.currentPage = 1;
        $scope.loadCampaigns();
    };
    
    $scope.clearFilters = function() {
        $scope.filters = defaultFilters();
        $scope.applyFilters();
    };
    $scope.hasActiveFilters = function() { return $scope.activeFilters().length > 0; };
    $scope.getActiveFiltersCount = function() { return $scope.activeFilters().length; };

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
            $scope.filters[key] = booleanFilters.indexOf(key) >= 0
                ? (value === 'true' ? true : value === 'false' ? false : null) : value;
        }
    });
    if ($scope.filters.sortBy === '_id') $scope.filters.sortBy = 'createdAt';
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
