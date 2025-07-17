'use strict';

Application.controller('AdminCampaignController', function ($scope, $http, $uibModal, $window, $location, NotificationDialog) {
    $scope.campaigns = [];
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
    
    // Anos disponíveis para filtros (1985-2024)
    $scope.availableYears = [];
    for (let year = 1985; year <= 2024; year++) {
        $scope.availableYears.push(year);
    }

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
        showPointInfo: true,
        useDynamicMaps: false,
        imageType: 'landsat'
    };

    $scope.createCampaign = function() {
        const modalInstance = $uibModal.open({
            templateUrl: 'views/campaign-form-modal.tpl.html',
            controller: 'CampaignFormModalController',
            size: 'lg',
            resolve: {
                campaign: function() {
                    return angular.copy($scope.newCampaign);
                },
                isNew: function() {
                    return true;
                }
            }
        });
        
        modalInstance.result.then(function(campaign) {
            $http.post('/api/campaigns', campaign).then(function(response) {
                if (response.data.success) {
                    $scope.loadCampaigns();
                    NotificationDialog.success('Campanha criada com sucesso!');
                } else {
                    NotificationDialog.error('Erro ao criar campanha');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao criar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };

    $scope.editCampaign = function(campaign) {
        const modalInstance = $uibModal.open({
            templateUrl: 'views/campaign-form-modal.tpl.html',
            controller: 'CampaignFormModalController',
            size: 'lg',
            resolve: {
                campaign: function() {
                    return angular.copy(campaign);
                },
                isNew: function() {
                    return false;
                }
            }
        });
        
        modalInstance.result.then(function(updatedCampaign) {
            $http.put('/api/campaigns/' + updatedCampaign._id, updatedCampaign).then(function(response) {
                if (response.data.success) {
                    $scope.loadCampaigns();
                    NotificationDialog.success('Campanha atualizada com sucesso!');
                } else {
                    NotificationDialog.error('Erro ao atualizar campanha');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao atualizar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };

    $scope.deleteCampaign = function(campaign) {
        NotificationDialog.confirm(`Tem certeza que deseja deletar a campanha "${campaign._id}"?`, 'Confirmar Exclusão').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            $http.delete('/api/campaigns/' + campaign._id).then(function(response) {
                if (response.data.success) {
                    $scope.loadCampaigns();
                    NotificationDialog.success('Campanha deletada com sucesso!');
                } else if (response.data.error) {
                    NotificationDialog.error('Erro: ' + response.data.error);
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao deletar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };

    $scope.uploadGeoJSON = function(campaign) {
        const modalInstance = $uibModal.open({
            templateUrl: 'views/geojson-upload-modal.tpl.html',
            controller: 'AdminGeoJSONUploadModalController',
            size: 'lg',
            windowClass: 'modal-90-width',
            resolve: {
                campaignId: function() {
                    return campaign._id;
                }
            }
        });
        
        modalInstance.result.then(function(result) {
            if (result.success) {
                $scope.loadCampaigns();
                NotificationDialog.success(`Upload realizado com sucesso! ${result.message}`);
            }
        });
    };

    $scope.viewPoints = function(campaign) {
        $uibModal.open({
            templateUrl: 'views/campaign-points-modal.tpl.html',
            controller: 'AdminCampaignPointsModalController',
            size: 'lg',
            windowClass: 'points-modal-wide',
            resolve: {
                campaign: function() {
                    return campaign;
                }
            }
        });
    };

    $scope.deletePoints = function(campaign) {
        NotificationDialog.confirm(`Tem certeza que deseja deletar TODOS os pontos da campanha "${campaign._id}"? Esta ação não pode ser desfeita!`, 'Confirmar Exclusão').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            $http.delete('/api/campaigns/' + campaign._id + '/points').then(function(response) {
                if (response.data.success) {
                    $scope.loadCampaigns();
                    NotificationDialog.info(response.data.message);
                } else {
                    NotificationDialog.error('Erro ao deletar pontos');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao deletar pontos: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };

    $scope.manageCampaign = function(campaign) {
        $location.path('/admin/campaigns/manage/' + campaign._id);
    };

    $scope.getProgressClass = function(progress) {
        if (progress < 33) return 'progress-bar-danger';
        if (progress < 66) return 'progress-bar-warning';
        return 'progress-bar-success';
    };

    // Verificar autenticação ao carregar
    $scope.checkAuth();
});