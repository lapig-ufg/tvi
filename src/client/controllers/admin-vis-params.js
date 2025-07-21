Application.controller('AdminVisParamsController', function ($scope, $http, $location, requester, NotificationDialog, $timeout, $uibModal) {
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

    // Collections
    $scope.landsatCollections = [];
    $scope.sentinelCollections = {};

    // Navegação
    $scope.goBack = function() {
        $location.path('/admin/home');
    };

    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        if (tab === 'collections') {
            $scope.loadCollections();
        }
    };

    // Carregar parâmetros de visualização
    $scope.loadVisParams = function() {
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
            // Response received
            $scope.loading.list = false;
            $scope.visParams = response.data || response;
            $scope.applyFilters();
        }, function(error) {
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
            $scope.updatePaginatedItems();
        }
    };

    $scope.totalPages = function() {
        return Math.ceil($scope.totalItems / $scope.itemsPerPage);
    };

    // Criar novo parâmetro
    $scope.createParam = function() {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-modal-v2.tpl.html',
            controller: 'AdminVisParamModalV2Controller',
            size: 'lg',
            windowClass: 'vis-param-modal-v2',
            resolve: {
                param: function() { return null; },
                categories: function() { return $scope.categories; }
            }
        });

        modalInstance.result.then(function(result) {
            $scope.loadVisParams();
            NotificationDialog.show('Parâmetro criado com sucesso', 'success');
        });
    };

    // Editar parâmetro
    $scope.editParam = function(param) {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-modal-v2.tpl.html',
            controller: 'AdminVisParamModalV2Controller',
            size: 'lg',
            windowClass: 'vis-param-modal-v2',
            resolve: {
                param: function() { return angular.copy(param); },
                categories: function() { return $scope.categories; }
            }
        });

        modalInstance.result.then(function(result) {
            $scope.loadVisParams();
            NotificationDialog.show('Parâmetro atualizado com sucesso', 'success');
        });
    };

    // Visualizar detalhes
    $scope.viewDetails = function(param) {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-details-modal.tpl.html',
            controller: 'AdminVisParamDetailsController',
            size: 'lg',
            windowClass: 'vis-param-modal',
            resolve: {
                param: function() { return param; }
            }
        });
    };

    // Alternar status ativo/inativo
    $scope.toggleActive = function(param) {
        $scope.loading.save = true;
        
        const url = '../api/vis-params/' + encodeURIComponent(param.name) + '/toggle';
        
        requester._patch(url, {}, function(response) {
            // Toggle successful
            $scope.loading.save = false;
            param.active = !param.active;
            NotificationDialog.show('Status alterado com sucesso', 'success');
        }, function(error) {
            // Error handled
            $scope.loading.save = false;
            NotificationDialog.show('Erro ao alterar status', 'error');
        });
    };

    // Deletar parâmetro
    $scope.deleteParam = function(param) {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/confirm-dialog.tpl.html',
            controller: 'ConfirmDialogController',
            size: 'md',
            resolve: {
                title: function() { return 'Confirmar Exclusão'; },
                message: function() { 
                    return 'Tem certeza que deseja excluir o parâmetro "' + param.display_name + '"? Esta ação não pode ser desfeita.'; 
                }
            }
        });

        modalInstance.result.then(function() {
            $scope.loading.delete = true;
            
            requester._delete('../api/vis-params/' + encodeURIComponent(param.name), function(response) {
                $scope.loading.delete = false;
                $scope.loadVisParams();
                NotificationDialog.show('Parâmetro excluído com sucesso', 'success');
            }, function(error) {
                $scope.loading.delete = false;
                NotificationDialog.show('Erro ao excluir parâmetro', 'error');
            });
        });
    };

    // Clonar parâmetro
    $scope.cloneParam = function(param) {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-clone-modal.tpl.html',
            controller: 'AdminVisParamCloneController',
            size: 'md',
            resolve: {
                originalParam: function() { return param; }
            }
        });

        modalInstance.result.then(function(newName) {
            $scope.loading.save = true;
            
            requester._post('../api/vis-params/clone/' + encodeURIComponent(param.name) + '?new_name=' + encodeURIComponent(newName), {}, 
            function(response) {
                $scope.loading.save = false;
                $scope.loadVisParams();
                NotificationDialog.show('Parâmetro clonado com sucesso', 'success');
            }, function(error) {
                $scope.loading.save = false;
                NotificationDialog.show('Erro ao clonar parâmetro', 'error');
            });
        });
    };

    // Testar parâmetro
    $scope.testParam = function(param) {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-test-modal.tpl.html',
            controller: 'AdminVisParamTestController',
            size: 'lg',
            resolve: {
                param: function() { return param; }
            }
        });
    };

    // Exportar parâmetros
    $scope.exportParams = function() {
        $scope.loading.export = true;
        
        requester._get('../api/vis-params/export/all', {}, function(response) {
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
            $scope.loading.export = false;
            NotificationDialog.show('Erro ao exportar parâmetros', 'error');
        });
    };

    // Importar parâmetros
    $scope.importParams = function() {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-vis-param-import-modal.tpl.html',
            controller: 'AdminVisParamImportController',
            size: 'md'
        });

        modalInstance.result.then(function(result) {
            $scope.loadVisParams();
            NotificationDialog.show(result.message, 'success');
        });
    };

    // Carregar collections
    $scope.loadCollections = function() {
        $scope.loading.collections = true;
        
        // Carregar Landsat collections
        requester._get('../api/vis-params/landsat-collections', {}, function(response) {
            $scope.landsatCollections = response.data || response;
            
            // Carregar Sentinel collections
            requester._get('../api/vis-params/sentinel-collections', {}, function(response) {
                $scope.loading.collections = false;
                $scope.sentinelCollections = response.data || response;
            }, function(error) {
                $scope.loading.collections = false;
                NotificationDialog.show('Erro ao carregar collections Sentinel', 'error');
            });
        }, function(error) {
            $scope.loading.collections = false;
            NotificationDialog.show('Erro ao carregar collections Landsat', 'error');
        });
    };

    // Editar Landsat collections
    $scope.editLandsatCollections = function() {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-landsat-collections-modal.tpl.html',
            controller: 'AdminLandsatCollectionsController',
            size: 'lg',
            resolve: {
                collections: function() { return angular.copy($scope.landsatCollections); }
            }
        });

        modalInstance.result.then(function() {
            $scope.loadCollections();
            NotificationDialog.show('Collections Landsat atualizadas', 'success');
        });
    };

    // Editar Sentinel collections
    $scope.editSentinelCollections = function() {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/admin-sentinel-collections-modal.tpl.html',
            controller: 'AdminSentinelCollectionsController',
            size: 'lg',
            resolve: {
                collections: function() { return angular.copy($scope.sentinelCollections); }
            }
        });

        modalInstance.result.then(function() {
            $scope.loadCollections();
            NotificationDialog.show('Collections Sentinel atualizadas', 'success');
        });
    };

    // Inicializar Sentinel collections
    $scope.initializeSentinelCollections = function() {
        var modalInstance = $uibModal.open({
            templateUrl: 'views/confirm-dialog.tpl.html',
            controller: 'ConfirmDialogController',
            size: 'md',
            resolve: {
                title: function() { return 'Inicializar Collections Sentinel'; },
                message: function() { 
                    return 'Isso criará uma configuração padrão para as collections Sentinel-2. Continuar?'; 
                }
            }
        });

        modalInstance.result.then(function() {
            $scope.loading.collections = true;
            
            requester._post('../api/vis-params/sentinel-collections/initialize', {}, function(response) {
                $scope.loading.collections = false;
                $scope.loadCollections();
                NotificationDialog.show('Collections Sentinel inicializadas', 'success');
            }, function(error) {
                $scope.loading.collections = false;
                NotificationDialog.show('Erro ao inicializar collections', 'error');
            });
        });
    };

    // Visualizar bandas de uma collection
    $scope.viewCollectionBands = function(collectionName) {
        requester._get('../api/vis-params/sentinel-collections/bands/' + encodeURIComponent(collectionName), {}, 
        function(response) {
            var modalInstance = $uibModal.open({
                templateUrl: 'views/admin-collection-bands-modal.tpl.html',
                controller: 'AdminCollectionBandsController',
                size: 'lg',
                resolve: {
                    collectionName: function() { return collectionName; },
                    bands: function() { return response.data || response; }
                }
            });
        }, function(error) {
            NotificationDialog.show('Erro ao carregar bandas da collection', 'error');
        });
    };

    // Watchers
    $scope.$watch('selectedCategory', function() {
        $scope.loadVisParams();
    });

    $scope.$watch('showOnlyActive', function() {
        $scope.loadVisParams();
    });

    $scope.$watch('searchText', function() {
        $scope.applyFilters();
    });

    // Cleanup
    $scope.$on('$destroy', function() {
        // Cleanup se necessário
    });

    // Verificar autenticação
    $scope.checkAuthentication = function() {
        $http.get('/api/admin/check').then(function(response) {
            if (response.data.authenticated && response.data.user) {
                $scope.adminUser = response.data.user;
                // Load vis params after authentication is confirmed
                $scope.loadVisParams();
            } else {
                console.error('Not authenticated as super-admin');
                $location.path('/admin/login');
            }
        }, function(error) {
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