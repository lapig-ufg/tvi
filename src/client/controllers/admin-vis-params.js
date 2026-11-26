Application.controller('AdminVisParamsController', function ($scope, $http, $location, requester, NotificationDialog, $timeout, AdminPages) {
    var destroyed = false;
    var deletionPending = false;
    var initializationPending = false;
    var listLoaded = false;
    var requestVersion = 0;
    var filterState;

    // Estado e variáveis
    $scope.loading = {
        list: false,
        save: false,
        delete: false,
        import: false,
        export: false,
        collections: false
    };

    $scope.activeTab = 'parameters'; // 'parameters' ou 'collections'
    $scope.visParams = [];
    $scope.filteredParams = [];
    $scope.categories = ['landsat', 'sentinel2'];
    $scope.selectedCategory = '';
    $scope.searchText = '';
    $scope.showOnlyActive = false;
    $scope.adminUser = null;
    
    // Paginação
    $scope.currentPage = 1;
    $scope.itemsPerPage = 10;
    $scope.totalItems = 0;

    function isCurrentPage() {
        return !destroyed && $location.path() === '/admin/visualization-params';
    }

    function filters() {
        return [$scope.selectedCategory, $scope.showOnlyActive, $scope.searchText];
    }

    function restoreQuery() {
        const query = $location.search();
        $scope.activeTab = query.tab === 'collections' ? 'collections' : 'parameters';
        $scope.selectedCategory = $scope.categories.indexOf(query.category) !== -1 ? query.category : '';
        $scope.searchText = typeof query.search === 'string' ? query.search.slice(0, 200) : '';
        $scope.showOnlyActive = query.active === 'true';
        const page = typeof query.page === 'string' && /^[1-9][0-9]*$/.test(query.page) ? Number(query.page) : 1;
        $scope.currentPage = Number.isSafeInteger(page) ? page : 1;
        filterState = filters();
    }

    function syncQuery() {
        if (!isCurrentPage()) return;
        const query = {};
        if ($scope.activeTab === 'collections') query.tab = 'collections';
        if ($scope.categories.indexOf($scope.selectedCategory) !== -1) query.category = $scope.selectedCategory;
        if ($scope.searchText) query.search = $scope.searchText.slice(0, 200);
        if ($scope.showOnlyActive) query.active = 'true';
        if ($scope.currentPage > 1) query.page = String($scope.currentPage);
        $location.search(query).replace();
    }

    restoreQuery();
    syncQuery();

    // Collections
    $scope.landsatCollections = [];
    $scope.sentinelCollections = {};

    // Navegação
    $scope.goBack = function() {
        $location.path('/admin/home').search({});
    };

    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab === 'collections' ? 'collections' : 'parameters';
        syncQuery();
        if (tab === 'collections') {
            $scope.loadCollections();
        }
    };

    // Carregar parâmetros de visualização
    $scope.loadVisParams = function() {
        if (!isCurrentPage()) return;
        const currentRequest = ++requestVersion;
        $scope.loading.list = true;
        
        const params = {};
        if ($scope.selectedCategory) {
            params.category = $scope.selectedCategory;
        }
        if ($scope.showOnlyActive) {
            params.active = true;
        }
        
        // Remove console.log

        requester._get('../api/vis-params', params, function(response) {
            if (!isCurrentPage() || currentRequest !== requestVersion) return;
            // Response received
            $scope.loading.list = false;
            $scope.visParams = response.data || response;
            listLoaded = true;
            $scope.applyFilters();
        }, function(error) {
            if (!isCurrentPage() || currentRequest !== requestVersion) return;
            // Error handled
            $scope.loading.list = false;
            NotificationDialog.show('Erro ao carregar parâmetros', 'error');
        });
    };

    // Aplicar filtros locais
    $scope.applyFilters = function() {
        let filtered = $scope.visParams;

        // Filtro por texto
        if ($scope.searchText) {
            const searchLower = $scope.searchText.toLowerCase();
            filtered = filtered.filter(function(param) {
                return param.name.toLowerCase().includes(searchLower) ||
                       param.display_name.toLowerCase().includes(searchLower) ||
                       (param.description && param.description.toLowerCase().includes(searchLower));
            });
        }

        $scope.filteredParams = filtered;
        $scope.totalItems = filtered.length;
        if (listLoaded) $scope.currentPage = Math.min($scope.currentPage, Math.max(1, $scope.totalPages()));
        syncQuery();
        $scope.updatePaginatedItems();
    };

    // Atualizar itens paginados
    $scope.updatePaginatedItems = function() {
        const start = ($scope.currentPage - 1) * $scope.itemsPerPage;
        const end = start + $scope.itemsPerPage;
        $scope.paginatedParams = $scope.filteredParams.slice(start, end);
    };

    // Mudar página
    $scope.changePage = function(page) {
        if (page >= 1 && page <= $scope.totalPages()) {
            $scope.currentPage = page;
            syncQuery();
            $scope.updatePaginatedItems();
        }
    };

    $scope.totalPages = function() {
        return Math.ceil($scope.totalItems / $scope.itemsPerPage);
    };

    // Criar novo parâmetro
    $scope.createParam = function() {
        AdminPages.go('vis-param-create');
    };

    // Editar parâmetro
    $scope.editParam = function(param) {
        AdminPages.go('vis-param-edit', { name: param.name });
    };

    // Visualizar detalhes
    $scope.viewDetails = function(param) {
        AdminPages.go('vis-param-details', { name: param.name });
    };

    // Alternar status ativo/inativo
    $scope.toggleActive = function(param) {
        $scope.loading.save = true;
        
        const url = '../api/vis-params/' + encodeURIComponent(param.name) + '/toggle';
        
        requester._patch(url, {}, function(response) {
            if (!isCurrentPage()) return;
            // Toggle successful
            $scope.loading.save = false;
            param.active = !param.active;
            NotificationDialog.show('Status alterado com sucesso', 'success');
        }, function(error) {
            if (!isCurrentPage()) return;
            // Error handled
            $scope.loading.save = false;
            NotificationDialog.show('Erro ao alterar status', 'error');
        });
    };

    // Deletar parâmetro
    $scope.deleteParam = function(param) {
        if (!isCurrentPage() || deletionPending) return;
        deletionPending = true;
        const name = param.name;
        return NotificationDialog.confirm('Tem certeza de que deseja excluir o parâmetro "' + param.display_name + '"? Esta ação não pode ser desfeita.', 'Confirmar exclusão').then(function(confirmed) {
            if (!confirmed || !isCurrentPage()) { deletionPending = false; return; }
            $scope.loading.delete = true;
            
            requester._delete('../api/vis-params/' + encodeURIComponent(name), function(response) {
                deletionPending = false;
                if (!isCurrentPage()) return;
                $scope.loading.delete = false;
                $scope.loadVisParams();
                NotificationDialog.show('Parâmetro excluído com sucesso', 'success');
            }, function(error) {
                deletionPending = false;
                if (!isCurrentPage()) return;
                $scope.loading.delete = false;
                NotificationDialog.show('Erro ao excluir parâmetro', 'error');
            });
        }, function() { deletionPending = false; });
    };

    // Clonar parâmetro
    $scope.cloneParam = function(param) {
        AdminPages.go('vis-param-clone', { name: param.name });
    };

    // Testar parâmetro
    $scope.testParam = function(param) {
        AdminPages.go('vis-param-test', { name: param.name });
    };

    // Exportar parâmetros
    $scope.exportParams = function() {
        $scope.loading.export = true;
        
        requester._get('../api/vis-params/export/all', {}, function(response) {
            if (!isCurrentPage()) return;
            $scope.loading.export = false;
            
            // Download do arquivo JSON
            const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'vis-params-export-' + new Date().toISOString().split('T')[0] + '.json';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            NotificationDialog.show('Parâmetros exportados com sucesso', 'success');
        }, function(error) {
            if (!isCurrentPage()) return;
            $scope.loading.export = false;
            NotificationDialog.show('Erro ao exportar parâmetros', 'error');
        });
    };

    // Importar parâmetros
    $scope.importParams = function() {
        AdminPages.go('vis-param-import');
    };

    // Carregar collections
    $scope.loadCollections = function() {
        $scope.loading.collections = true;
        
        // Carregar Landsat collections
        requester._get('../api/vis-params/landsat-collections', {}, function(response) {
            if (!isCurrentPage()) return;
            $scope.landsatCollections = response.data || response;
            
            // Carregar Sentinel collections
            requester._get('../api/vis-params/sentinel-collections', {}, function(response) {
                if (!isCurrentPage()) return;
                $scope.loading.collections = false;
                $scope.sentinelCollections = response.data || response;
            }, function(error) {
                if (!isCurrentPage()) return;
                $scope.loading.collections = false;
                NotificationDialog.show('Erro ao carregar collections Sentinel', 'error');
            });
        }, function(error) {
            if (!isCurrentPage()) return;
            $scope.loading.collections = false;
            NotificationDialog.show('Erro ao carregar collections Landsat', 'error');
        });
    };

    // Editar Landsat collections
    $scope.editLandsatCollections = function() {
        AdminPages.go('landsat-collections');
    };

    // Editar Sentinel collections
    $scope.editSentinelCollections = function() {
        AdminPages.go('sentinel-collections');
    };

    // Inicializar Sentinel collections
    $scope.initializeSentinelCollections = function() {
        if (!isCurrentPage() || initializationPending) return;
        initializationPending = true;
        return NotificationDialog.confirm('Isso criará uma configuração padrão para as coleções Sentinel-2. Continuar?', 'Inicializar coleções Sentinel').then(function(confirmed) {
            if (!confirmed || !isCurrentPage()) { initializationPending = false; return; }
            $scope.loading.collections = true;
            
            requester._post('../api/vis-params/sentinel-collections/initialize', {}, function(response) {
                initializationPending = false;
                if (!isCurrentPage()) return;
                $scope.loading.collections = false;
                $scope.loadCollections();
                NotificationDialog.show('Collections Sentinel inicializadas', 'success');
            }, function(error) {
                initializationPending = false;
                if (!isCurrentPage()) return;
                $scope.loading.collections = false;
                NotificationDialog.show('Erro ao inicializar collections', 'error');
            });
        }, function() { initializationPending = false; });
    };

    // Visualizar bandas de uma collection
    $scope.viewCollectionBands = function(collectionName) {
        AdminPages.go('collection-bands', { collectionName: collectionName });
    };

    $scope.$watchGroup(['selectedCategory', 'showOnlyActive', 'searchText'], function() {
        const current = filters();
        if (current.every(function(value, index) { return value === filterState[index]; })) return;
        const serverFiltersChanged = current[0] !== filterState[0] || current[1] !== filterState[1];
        filterState = current;
        $scope.currentPage = 1;
        syncQuery();
        if (serverFiltersChanged && $scope.adminUser) $scope.loadVisParams();
        else if (listLoaded) $scope.applyFilters();
    });

    $scope.$on('$routeUpdate', function() {
        if (!isCurrentPage()) return;
        const previous = filters();
        const previousTab = $scope.activeTab;
        const previousPage = $scope.currentPage;
        restoreQuery();
        syncQuery();
        if (!$scope.adminUser || destroyed) return;
        if (previousTab === $scope.activeTab && previousPage === $scope.currentPage &&
            previous.every(function(value, index) { return value === filterState[index]; })) return;
        if (previous[0] !== filterState[0] || previous[1] !== filterState[1]) $scope.loadVisParams();
        else if (listLoaded) $scope.applyFilters();
        if ($scope.activeTab === 'collections' && previousTab !== $scope.activeTab) $scope.loadCollections();
    });

    // Cleanup
    $scope.$on('$destroy', function() {
        destroyed = true;
    });

    // Verificar autenticação
    $scope.checkAuthentication = function() {
        $http.get('/api/admin/check').then(function(response) {
            if (!isCurrentPage()) return;
            if (response.data.authenticated && response.data.user) {
                $scope.adminUser = response.data.user;
                // Load vis params after authentication is confirmed
                $scope.loadVisParams();
                if ($scope.activeTab === 'collections') $scope.loadCollections();
            } else {
                console.error('Not authenticated as super-admin');
                $location.path('/admin/login');
            }
        }, function(error) {
            if (!isCurrentPage()) return;
            console.error('Authentication check failed:', error);
            $location.path('/admin/login');
        });
    };

    // Inicialização
    $scope.init = function() {
        $scope.checkAuthentication();
    };

    $scope.init();
});