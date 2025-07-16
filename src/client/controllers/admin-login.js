'use strict';

Application.controller('AdminLoginController', function ($scope, $http, $window, $location) {
    $scope.credentials = {
        username: '',
        password: ''
    };
    $scope.loading = false;
    $scope.error = '';

    // Verificar se já está autenticado
    $scope.checkAuth = function() {
        // Marcar que estamos no sistema admin
        $scope.$root.isAdminMode = true;
        
        $http.get('/api/admin/check').then(function(response) {
            if (response.data.authenticated) {
                $location.path('/admin/campaigns');
            }
        }, function(error) {
            // Se erro na verificação, continuar na tela de login
            // User not authenticated or verification error
        });
    };

    $scope.login = function() {
        if (!$scope.credentials.username || !$scope.credentials.password) {
            $scope.error = 'Username e senha são obrigatórios';
            return;
        }

        $scope.loading = true;
        $scope.error = '';

        $http.post('/api/admin/login', $scope.credentials).then(function(response) {
            $scope.loading = false;
            if (response.data.success) {
                // Login successful, redirecting to admin/campaigns
                // Usar timeout para garantir que o redirecionamento aconteça após o digest
                setTimeout(function() {
                    $scope.$apply(function() {
                        $location.path('/admin/campaigns');
                    });
                }, 100);
            }
        }, function(error) {
            $scope.loading = false;
            $scope.error = error.data.error || 'Erro no login';
        });
    };

    // Verificar autenticação ao carregar
    $scope.checkAuth();
});

Application.controller('AdminCampaignController', function ($scope, $http, $uibModal, $window, $location) {
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
                alert('Erro ao carregar campanhas');
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
                    alert('Campanha criada com sucesso!');
                } else {
                    alert('Erro ao criar campanha');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    alert('Erro ao criar campanha: ' + (error.data.error || 'Erro desconhecido'));
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
                    alert('Campanha atualizada com sucesso!');
                } else {
                    alert('Erro ao atualizar campanha');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    alert('Erro ao atualizar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };

    $scope.deleteCampaign = function(campaign) {
        if (!confirm(`Tem certeza que deseja deletar a campanha "${campaign._id}"?`)) {
            return;
        }
        
        $http.delete('/api/campaigns/' + campaign._id).then(function(response) {
            if (response.data.success) {
                $scope.loadCampaigns();
                alert('Campanha deletada com sucesso!');
            } else if (response.data.error) {
                alert('Erro: ' + response.data.error);
            }
        }, function(error) {
            if (error.status === 401) {
                $location.path('/admin/login');
            } else {
                alert('Erro ao deletar campanha: ' + (error.data.error || 'Erro desconhecido'));
            }
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
                alert(`Upload realizado com sucesso! ${result.message}`);
            }
        });
    };

    $scope.viewPoints = function(campaign) {
        $uibModal.open({
            templateUrl: 'views/campaign-points-modal.tpl.html',
            controller: 'AdminCampaignPointsModalController',
            size: 'lg',
            resolve: {
                campaign: function() {
                    return campaign;
                }
            }
        });
    };

    $scope.deletePoints = function(campaign) {
        if (!confirm(`Tem certeza que deseja deletar TODOS os pontos da campanha "${campaign._id}"? Esta ação não pode ser desfeita!`)) {
            return;
        }
        
        $http.delete('/api/campaigns/' + campaign._id + '/points').then(function(response) {
            if (response.data.success) {
                $scope.loadCampaigns();
                alert(response.data.message);
            } else {
                alert('Erro ao deletar pontos');
            }
        }, function(error) {
            if (error.status === 401) {
                $location.path('/admin/login');
            } else {
                alert('Erro ao deletar pontos: ' + (error.data.error || 'Erro desconhecido'));
            }
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

// Função global para gerenciar conexão socket única
window.getAdminSocket = function() {
    if (!window.adminSocket || !window.adminSocket.connected) {
        // Creating new global socket connection...
        try {
            window.adminSocket = io('/', {
                transports: ['polling', 'websocket'],
                forceNew: false,
                reconnection: true,
                timeout: 15000,
                reconnectionAttempts: 3,
                reconnectionDelay: 3000,
                autoConnect: true
            });
            
            // Event listeners globais para debug
            window.adminSocket.on('connect', function() {
                // Global socket connected
            });
            
            window.adminSocket.on('disconnect', function() {
                // Global socket disconnected
            });
            
            window.adminSocket.on('connect_error', function(error) {
                console.error('Erro na conexão socket global:', error);
            });
            
            window.adminSocket.on('reconnect', function(attemptNumber) {
                // Global socket reconnected after attempts
            });
            
        } catch (error) {
            console.error('Erro ao criar socket global:', error);
            window.adminSocket = io();
        }
    } else {
        // Reusing existing global socket
    }
    return window.adminSocket;
};

// Controllers dos modais (adaptados para admin)
Application.controller('AdminGeoJSONUploadModalController', function ($scope, $uibModalInstance, $http, $location, campaignId) {
    $scope.file = null;
    
    // Progresso do upload
    $scope.uploadProgress = {
        isUploading: false,
        isCompleted: false,
        success: false,
        progress: 0,
        processedCount: 0,
        errorCount: 0,
        totalFeatures: 0,
        filename: '',
        startTime: null,
        elapsedTime: null,
        duration: 0,
        properties: [],
        error: null,
        result: null
    };
    
    $scope.setFile = function(element) {
        $scope.$apply(function() {
            $scope.file = element.files[0];
        });
    };
    
    // Função para simular progresso durante a request
    function simulateProgress() {
        var startTime = Date.now();
        var progressInterval = setInterval(function() {
            $scope.$apply(function() {
                var elapsed = Date.now() - startTime;
                $scope.uploadProgress.elapsedTime = Math.floor(elapsed / 1000) + 's';
                
                // Simular progresso de 0 a 90% baseado no tempo (crescimento logarítmico)
                var progress = Math.min(90, Math.floor(30 * Math.log(elapsed / 1000 + 1)));
                $scope.uploadProgress.progress = progress;
            });
        }, 500);
        
        return progressInterval;
    }
    
    $scope.upload = function() {
        if (!$scope.file) {
            alert('Selecione um arquivo GeoJSON ou ZIP');
            return;
        }
        
        // Inicializar progresso
        $scope.uploadProgress.isUploading = true;
        $scope.uploadProgress.isCompleted = false;
        $scope.uploadProgress.filename = $scope.file.name;
        $scope.uploadProgress.startTime = new Date();
        $scope.uploadProgress.progress = 0;
        
        // Iniciar simulação de progresso
        var progressInterval = simulateProgress();
        
        const isZipFile = $scope.file.name.toLowerCase().endsWith('.zip');
        
        if (isZipFile) {
            // Para arquivos ZIP, ler como base64
            const reader = new FileReader();
            reader.onload = function(e) {
                const base64Content = e.target.result.split(',')[1]; // Remove o prefixo data:...;base64,
                
                $http.post('/api/campaigns/upload-geojson', {
                    campaignId: campaignId,
                    zipContent: base64Content,
                    filename: $scope.file.name,
                    isZip: true
                }, {
                    timeout: 600000, // 10 minutos
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).then(function(response) {
                // Parar simulação de progresso
                clearInterval(progressInterval);
                
                $scope.uploadProgress.isUploading = false;
                $scope.uploadProgress.isCompleted = true;
                $scope.uploadProgress.progress = 100;
                
                if (response.data.success) {
                    $scope.uploadProgress.success = true;
                    $scope.uploadProgress.result = response.data;
                    $scope.uploadProgress.processedCount = response.data.processedCount || 0;
                    $scope.uploadProgress.errorCount = response.data.errorCount || 0;
                    $scope.uploadProgress.totalFeatures = response.data.totalFeatures || 0;
                    $scope.uploadProgress.duration = response.data.duration || 0;
                    $scope.uploadProgress.properties = response.data.properties || [];
                    
                    // Upload completed successfully
                } else {
                    $scope.uploadProgress.success = false;
                    $scope.uploadProgress.error = response.data.error || 'Erro desconhecido';
                }
            }, function(error) {
                // Parar simulação de progresso
                clearInterval(progressInterval);
                
                $scope.uploadProgress.isUploading = false;
                $scope.uploadProgress.isCompleted = true;
                $scope.uploadProgress.success = false;
                $scope.uploadProgress.progress = 100;
                
                if (error.status === 401) {
                    $uibModalInstance.dismiss('unauthorized');
                    $location.path('/admin/login');
                } else {
                    let errorMessage = 'Erro de conexão';
                    
                    if (error.status === 413) {
                        errorMessage = 'Arquivo muito grande. Limite máximo: 100MB';
                    } else if (error.status === 400) {
                        errorMessage = error.data?.error || 'Dados inválidos na requisição';
                    } else if (error.status === 0) {
                        errorMessage = 'Erro de conexão - verifique sua internet ou se o servidor está disponível';
                    } else if (error.status >= 500) {
                        errorMessage = 'Erro interno do servidor';
                    } else if (error.data?.error) {
                        errorMessage = error.data.error;
                    }
                    
                    $scope.uploadProgress.error = errorMessage;
                }
            });
            };
            
            reader.onerror = function() {
                clearInterval(progressInterval);
                $scope.uploadProgress.isUploading = false;
                $scope.uploadProgress.isCompleted = true;
                $scope.uploadProgress.success = false;
                $scope.uploadProgress.error = 'Erro ao ler o arquivo';
            };
            
            reader.readAsDataURL($scope.file);
        } else {
            // Para arquivos GeoJSON, ler como texto
            const reader = new FileReader();
            reader.onload = function(e) {
                const content = e.target.result;
                
                $http.post('/api/campaigns/upload-geojson', {
                    campaignId: campaignId,
                    geojsonContent: content,
                    filename: $scope.file.name
                }, {
                    timeout: 600000, // 10 minutos
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).then(function(response) {
                    // Parar simulação de progresso
                    clearInterval(progressInterval);
                    
                    $scope.uploadProgress.isUploading = false;
                    $scope.uploadProgress.isCompleted = true;
                    $scope.uploadProgress.progress = 100;
                    
                    if (response.data.success) {
                        $scope.uploadProgress.success = true;
                        $scope.uploadProgress.result = response.data;
                        $scope.uploadProgress.processedCount = response.data.processedCount || 0;
                        $scope.uploadProgress.errorCount = response.data.errorCount || 0;
                        $scope.uploadProgress.totalFeatures = response.data.totalFeatures || 0;
                        $scope.uploadProgress.duration = response.data.duration || 0;
                        $scope.uploadProgress.properties = response.data.properties || [];
                        
                        // Upload completed successfully
                    } else {
                        $scope.uploadProgress.success = false;
                        $scope.uploadProgress.error = response.data.error || 'Erro desconhecido';
                    }
                }, function(error) {
                    // Parar simulação de progresso
                    clearInterval(progressInterval);
                    
                    $scope.uploadProgress.isUploading = false;
                    $scope.uploadProgress.isCompleted = true;
                    $scope.uploadProgress.success = false;
                    $scope.uploadProgress.progress = 100;
                    
                    if (error.status === 401) {
                        $uibModalInstance.dismiss('unauthorized');
                        $location.path('/admin/login');
                    } else {
                        let errorMessage = 'Erro de conexão';
                        
                        if (error.status === 413) {
                            errorMessage = 'Arquivo muito grande. Limite máximo: 100MB';
                        } else if (error.status === 400) {
                            errorMessage = error.data?.error || 'Dados inválidos na requisição';
                        } else if (error.status === 0) {
                            errorMessage = 'Erro de conexão - verifique sua internet ou se o servidor está disponível';
                        } else if (error.status >= 500) {
                            errorMessage = 'Erro interno do servidor';
                        } else if (error.data?.error) {
                            errorMessage = error.data.error;
                        }
                        
                        $scope.uploadProgress.error = errorMessage;
                    }
                });
            };
            
            reader.onerror = function() {
                clearInterval(progressInterval);
                $scope.uploadProgress.isUploading = false;
                $scope.uploadProgress.isCompleted = true;
                $scope.uploadProgress.success = false;
                $scope.uploadProgress.error = 'Erro ao ler o arquivo';
            };
            
            reader.readAsText($scope.file);
        }
    };
    
    $scope.close = function() {
        $uibModalInstance.close({
            success: true,
            message: `Upload concluído: ${$scope.uploadProgress.processedCount} pontos processados`
        });
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

Application.controller('AdminCampaignPointsModalController', function ($scope, $uibModalInstance, $http, $location, $uibModal, campaign) {
    $scope.campaign = campaign;
    $scope.points = [];
    $scope.filteredPoints = null;
    $scope.loading = false;
    $scope.currentPage = 1;
    $scope.pageSize = 50;
    $scope.totalPoints = 0;
    $scope.searchId = '';
    $scope.Math = Math;
    
    // Advanced filters state
    $scope.showAdvancedFilters = false;
    $scope.filters = {
        pointId: '',
        status: '',
        user: '',
        biome: '',
        uf: '',
        county: '',
        minInspections: null,
        maxInspections: null
    };
    
    // Available filter options
    $scope.availableUsers = [];
    $scope.availableBiomes = [];
    $scope.availableUfs = [];
    $scope.availableCounties = [];
    
    // Inspection viewer state
    $scope.showInspectionViewer = false;
    $scope.selectedInspector = '';
    $scope.inspectorsList = [];
    $scope.inspectorStats = {};
    $scope.inspectorPoints = [];
    
    // Inspection remover state
    $scope.showInspectionRemover = false;
    $scope.removalCriteria = {
        type: '',
        user: '',
        pointId: '',
        startDate: null,
        endDate: null
    };
    $scope.removalPreview = [];
    
    // Selection state
    $scope.selectAll = false;
    $scope.selectedPoints = [];
    
    $scope.loadPoints = function() {
        $scope.loading = true;
        const skip = ($scope.currentPage - 1) * $scope.pageSize;
        let url = `/api/campaigns/${campaign._id}/points?limit=${$scope.pageSize}&skip=${skip}&includeInspections=true`;
        
        // Se há busca por ID, adicionar ao query
        if ($scope.searchId && $scope.searchId.trim()) {
            url += `&search=${encodeURIComponent($scope.searchId.trim())}`;
        }
        
        // Adicionar filtros avançados ao query
        if ($scope.hasActiveFilters()) {
            if ($scope.filters.pointId && $scope.filters.pointId.trim()) {
                url += `&pointId=${encodeURIComponent($scope.filters.pointId.trim())}`;
            }
            if ($scope.filters.status) {
                url += `&status=${encodeURIComponent($scope.filters.status)}`;
            }
            if ($scope.filters.user) {
                url += `&user=${encodeURIComponent($scope.filters.user)}`;
            }
            if ($scope.filters.biome) {
                url += `&biome=${encodeURIComponent($scope.filters.biome)}`;
            }
            if ($scope.filters.uf) {
                url += `&uf=${encodeURIComponent($scope.filters.uf)}`;
            }
            if ($scope.filters.county) {
                url += `&county=${encodeURIComponent($scope.filters.county)}`;
            }
            if ($scope.filters.minInspections !== null && $scope.filters.minInspections !== undefined) {
                url += `&minInspections=${$scope.filters.minInspections}`;
            }
            if ($scope.filters.maxInspections !== null && $scope.filters.maxInspections !== undefined) {
                url += `&maxInspections=${$scope.filters.maxInspections}`;
            }
            // Include required inspections for status filtering
            url += `&numInspec=${campaign.numInspec}`;
        }
        
        $http.get(url).then(function(response) {
            $scope.points = response.data.points;
            $scope.totalPoints = response.data.total;
            $scope.loading = false;
            
            // Load filter options
            $scope.loadFilterOptions();
            
            // Reset filtered points quando usando filtros backend
            $scope.filteredPoints = null;
        }, function(error) {
            console.error('Error loading points:', error);
            $scope.loading = false;
            if (error.status === 401) {
                $uibModalInstance.dismiss('unauthorized');
                $location.path('/admin/login');
            }
        });
    };
    
    // Load filter options from current points
    $scope.loadFilterOptions = function() {
        const users = new Set();
        const biomes = new Set();
        const ufs = new Set();
        const counties = new Set();
        
        $scope.points.forEach(function(point) {
            if (point.userName && point.userName.length > 0) {
                point.userName.forEach(user => users.add(user));
            }
            if (point.biome) biomes.add(point.biome);
            if (point.uf) ufs.add(point.uf);
            if (point.county) counties.add(point.county);
        });
        
        $scope.availableUsers = Array.from(users).sort();
        $scope.availableBiomes = Array.from(biomes).sort();
        $scope.availableUfs = Array.from(ufs).sort();
        $scope.availableCounties = Array.from(counties).sort();
        
        // Load inspectors list
        $scope.loadInspectorsList();
    };
    
    // Load inspectors statistics
    $scope.loadInspectorsList = function() {
        const inspectorStats = {};
        
        $scope.points.forEach(function(point) {
            if (point.userName && point.userName.length > 0) {
                point.userName.forEach(function(user) {
                    if (!inspectorStats[user]) {
                        inspectorStats[user] = {
                            name: user,
                            inspectionCount: 0,
                            uniquePoints: new Set(),
                            totalTime: 0,
                            inspections: []
                        };
                    }
                    inspectorStats[user].inspectionCount++;
                    inspectorStats[user].uniquePoints.add(point._id);
                    
                    // Add inspection details if available
                    if (point.inspections) {
                        point.inspections.forEach(function(inspection) {
                            if (inspection.user === user) {
                                inspectorStats[user].inspections.push({
                                    pointId: point._id,
                                    lat: point.lat,
                                    lon: point.lon,
                                    county: point.county,
                                    inspectionDate: inspection.date,
                                    inspectionTime: inspection.time,
                                    landUseClasses: inspection.form ? inspection.form.map(f => f.landUse) : []
                                });
                                if (inspection.time) {
                                    inspectorStats[user].totalTime += inspection.time;
                                }
                            }
                        });
                    }
                });
            }
        });
        
        $scope.inspectorsList = Object.values(inspectorStats).map(function(stats) {
            return {
                name: stats.name,
                inspectionCount: stats.inspectionCount,
                uniquePoints: stats.uniquePoints.size,
                averageTime: stats.totalTime > 0 ? Math.round(stats.totalTime / stats.inspectionCount) : 0,
                inspections: stats.inspections
            };
        }).sort((a, b) => b.inspectionCount - a.inspectionCount);
    };
    
    // Toggle functions
    $scope.toggleAdvancedFilters = function() {
        $scope.showAdvancedFilters = !$scope.showAdvancedFilters;
        if (!$scope.showAdvancedFilters) {
            $scope.clearAllFilters();
        }
    };
    
    $scope.toggleInspectionViewer = function() {
        $scope.showInspectionViewer = !$scope.showInspectionViewer;
    };
    
    $scope.toggleInspectionRemover = function() {
        $scope.showInspectionRemover = !$scope.showInspectionRemover;
    };
    
    // Filter functions
    $scope.applyFilters = function() {
        // Reset pagination to first page when applying filters
        $scope.currentPage = 1;
        
        // Trigger backend reload with filters
        $scope.loadPoints();
    };
    
    $scope.clearAllFilters = function() {
        $scope.filters = {
            pointId: '',
            status: '',
            user: '',
            biome: '',
            uf: '',
            county: '',
            minInspections: null,
            maxInspections: null
        };
        $scope.filteredPoints = null;
        
        // Reset pagination and reload from backend
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    $scope.hasActiveFilters = function() {
        return !!(
            $scope.filters.pointId ||
            $scope.filters.status ||
            $scope.filters.user ||
            $scope.filters.biome ||
            $scope.filters.uf ||
            $scope.filters.county ||
            $scope.filters.minInspections !== null ||
            $scope.filters.maxInspections !== null
        );
    };
    
    // Inspection viewer functions
    $scope.loadInspectorDetails = function() {
        if (!$scope.selectedInspector) {
            $scope.inspectorStats = {};
            $scope.inspectorPoints = [];
            return;
        }
        
        const inspector = $scope.inspectorsList.find(i => i.name === $scope.selectedInspector);
        if (inspector) {
            $scope.inspectorStats = {
                totalInspections: inspector.inspectionCount,
                uniquePoints: inspector.uniquePoints,
                averageTime: inspector.averageTime
            };
            $scope.inspectorPoints = inspector.inspections;
        }
    };
    
    // Inspection removal functions
    $scope.isRemovalCriteriaValid = function() {
        if (!$scope.removalCriteria.type) return false;
        
        switch ($scope.removalCriteria.type) {
            case 'by_user':
                return !!$scope.removalCriteria.user;
            case 'by_point':
                return !!$scope.removalCriteria.pointId;
            case 'by_time_range':
                return !!$scope.removalCriteria.startDate && !!$scope.removalCriteria.endDate;
            case 'incomplete_only':
                return true;
            default:
                return false;
        }
    };
    
    $scope.previewRemoval = function() {
        // Simulate removal preview
        $scope.removalPreview = [];
        let pointsAffected = 0;
        
        $scope.points.forEach(function(point) {
            if (point.userName && point.userName.length > 0) {
                let shouldRemove = false;
                
                switch ($scope.removalCriteria.type) {
                    case 'by_user':
                        shouldRemove = point.userName.includes($scope.removalCriteria.user);
                        break;
                    case 'by_point':
                        shouldRemove = point._id === $scope.removalCriteria.pointId;
                        break;
                    case 'incomplete_only':
                        shouldRemove = point.userName.length < campaign.numInspec;
                        break;
                }
                
                if (shouldRemove) {
                    pointsAffected++;
                    point.userName.forEach(function(user) {
                        $scope.removalPreview.push({
                            pointId: point._id,
                            user: user,
                            date: new Date(),
                            impact: point.userName.length <= campaign.numInspec ? 'safe' : 'warning'
                        });
                    });
                }
            }
        });
        
        $scope.removalPreview.pointsAffected = pointsAffected;
    };
    
    $scope.confirmRemoval = function() {
        if (!confirm(`Tem certeza que deseja remover ${$scope.removalPreview.length} inspeções? Esta ação não pode ser desfeita!`)) {
            return;
        }
        
        // Implement actual removal logic here
        $http.post(`/api/campaigns/${campaign._id}/remove-inspections`, {
            criteria: $scope.removalCriteria,
            preview: $scope.removalPreview
        }).then(function(response) {
            if (response.data.success) {
                alert(`${response.data.removedCount} inspeções removidas com sucesso!`);
                $scope.loadPoints();
                $scope.removalPreview = [];
            } else {
                alert('Erro ao remover inspeções: ' + response.data.error);
            }
        }, function(error) {
            alert('Erro ao remover inspeções: ' + (error.data?.error || 'Erro desconhecido'));
        });
    };
    
    // Selection functions
    $scope.toggleSelectAll = function() {
        $scope.points.forEach(function(point) {
            point.selected = $scope.selectAll;
        });
        $scope.updateSelection();
    };
    
    $scope.updateSelection = function() {
        $scope.selectedPoints = $scope.points.filter(point => point.selected);
        $scope.selectAll = $scope.selectedPoints.length === $scope.points.length && $scope.points.length > 0;
    };
    
    // Utility functions
    $scope.getInspectionBadgeClass = function(count, required) {
        count = count || 0;
        required = required || 0;
        if (count >= required) return 'badge-success';
        if (count > 0) return 'badge-warning';
        return 'badge-default';
    };
    
    // Safe function to get inspection count
    $scope.getInspectionCount = function(point) {
        return point && point.userName ? point.userName.length : 0;
    };
    
    // Point action functions
    $scope.viewPointDetails = function(point) {
        $uibModal.open({
            templateUrl: 'views/point-details-modal.tpl.html',
            controller: 'PointDetailsModalController',
            size: 'lg',
            resolve: {
                point: function() { return point; },
                campaign: function() { return campaign; }
            }
        });
    };
    
    $scope.editPointInspections = function(point) {
        $uibModal.open({
            templateUrl: 'views/point-inspections-edit-modal.tpl.html',
            controller: 'PointInspectionsEditModalController',
            size: 'lg',
            resolve: {
                point: function() { return point; },
                campaign: function() { return campaign; }
            }
        }).result.then(function() {
            $scope.loadPoints();
        });
    };
    
    $scope.removePointInspections = function(point) {
        if (!confirm(`Tem certeza que deseja remover todas as inspeções do ponto ${point._id}?`)) {
            return;
        }
        
        $http.delete(`/api/campaigns/${campaign._id}/points/${point._id}/inspections`).then(function(response) {
            if (response.data.success) {
                alert('Inspeções removidas com sucesso!');
                $scope.loadPoints();
            } else {
                alert('Erro ao remover inspeções: ' + response.data.error);
            }
        }, function(error) {
            alert('Erro ao remover inspeções: ' + (error.data?.error || 'Erro desconhecido'));
        });
    };
    
    // Bulk actions
    $scope.bulkEditInspections = function() {
        alert('Funcionalidade de edição em lote será implementada em breve');
    };
    
    $scope.bulkRemoveInspections = function() {
        if (!confirm(`Tem certeza que deseja remover as inspeções de ${$scope.selectedPoints.length} pontos selecionados?`)) {
            return;
        }
        
        const pointIds = $scope.selectedPoints.map(p => p._id);
        $http.post(`/api/campaigns/${campaign._id}/bulk-remove-inspections`, { pointIds }).then(function(response) {
            if (response.data.success) {
                alert(`Inspeções removidas de ${response.data.removedCount} pontos!`);
                $scope.loadPoints();
            } else {
                alert('Erro na remoção em lote: ' + response.data.error);
            }
        }, function(error) {
            alert('Erro na remoção em lote: ' + (error.data?.error || 'Erro desconhecido'));
        });
    };
    
    $scope.exportSelectedPoints = function() {
        const pointsToExport = $scope.selectedPoints.length > 0 ? $scope.selectedPoints : $scope.points;
        
        let csv = 'ID,Latitude,Longitude,Bioma,UF,Município,Inspeções,Status,Usuários\n';
        pointsToExport.forEach(function(point) {
            const inspectionCount = point.userName ? point.userName.length : 0;
            const status = inspectionCount >= campaign.numInspec ? 'Completo' : 
                          inspectionCount > 0 ? 'Em andamento' : 'Não iniciado';
            const users = point.userName ? point.userName.join(';') : '';
            
            csv += `${point._id},${point.lat},${point.lon},${point.biome || ''},${point.uf || ''},${point.county || ''},${inspectionCount},${status},"${users}"\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `pontos_campanha_${campaign._id}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    };
    
    // Original functions
    $scope.searchPoints = function() {
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    $scope.clearSearch = function() {
        $scope.searchId = '';
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    $scope.changePageSize = function() {
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    // Pagination functions
    $scope.goToPage = function(page) {
        const totalPages = Math.ceil($scope.totalPoints / $scope.pageSize);
        if (page >= 1 && page <= totalPages) {
            $scope.currentPage = page;
            $scope.loadPoints();
        }
    };
    
    $scope.getPages = function() {
        const totalPages = Math.ceil($scope.totalPoints / $scope.pageSize);
        const pages = [];
        const current = $scope.currentPage;
        
        const start = Math.max(1, current - 2);
        const end = Math.min(totalPages, current + 2);
        
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        
        return pages;
    };
    
    $scope.getTotalPages = function() {
        return Math.ceil($scope.totalPoints / $scope.pageSize) || 1;
    };
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
    
    // Initialize
    $scope.loadPoints();
});

// Controller para o modal de detalhes do ponto
Application.controller('PointDetailsModalController', function ($scope, $uibModalInstance, point, campaign) {
    $scope.point = point;
    $scope.campaign = campaign;
    
    // Propriedades padrão que não devem ser mostradas nas propriedades customizadas
    $scope.defaultProperties = ['biome', 'uf', 'county', 'countyCode', 'lat', 'lon', 'longitude', 'latitude'];
    
    $scope.getInspectionCount = function() {
        return $scope.point.userName ? $scope.point.userName.length : 0;
    };
    
    $scope.getUniqueInspectors = function() {
        if (!$scope.point.userName) return 0;
        return new Set($scope.point.userName).size;
    };
    
    $scope.getCompletionPercentage = function() {
        const current = $scope.getInspectionCount();
        const required = $scope.campaign.numInspec;
        return Math.round((current / required) * 100);
    };
    
    $scope.getInspectionDetails = function() {
        if (!$scope.point.userName) return [];
        
        // Simular detalhes das inspeções baseado nos dados disponíveis
        return $scope.point.userName.map(function(user, index) {
            return {
                user: user,
                date: new Date(Date.now() - (index * 24 * 60 * 60 * 1000)), // Datas simuladas
                time: Math.floor(Math.random() * 300) + 60, // Tempo simulado entre 60-360 segundos
                landUseClasses: $scope.campaign.landUse ? [$scope.campaign.landUse[Math.floor(Math.random() * $scope.campaign.landUse.length)]] : []
            };
        });
    };
    
    // Função para verificar se deve mostrar uma propriedade
    $scope.shouldShowProperty = function(key) {
        return $scope.defaultProperties.indexOf(key.toLowerCase()) === -1;
    };
    
    // Função para formatar o nome da propriedade
    $scope.formatPropertyName = function(key) {
        return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
    };
    
    // Função para verificar se existem propriedades customizadas
    $scope.hasCustomProperties = function() {
        if (!$scope.point || !$scope.point.properties) {
            return false;
        }
        
        for (var key in $scope.point.properties) {
            if ($scope.shouldShowProperty(key)) {
                return true;
            }
        }
        return false;
    };
    
    $scope.editInspection = function(inspection, index) {
        alert('Funcionalidade de edição individual será implementada em breve');
    };
    
    $scope.removeInspection = function(inspection, index) {
        if (confirm(`Tem certeza que deseja remover a inspeção de ${inspection.user}?`)) {
            // Implementar remoção individual
            alert('Remoção individual será implementada em breve');
        }
    };
    
    $scope.viewInTemporal = function() {
        alert('Redirecionamento para visualização temporal será implementado em breve');
        $scope.close();
    };
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
});

// Controller para o modal de edição de inspeções
Application.controller('PointInspectionsEditModalController', function ($scope, $uibModalInstance, $http, point, campaign) {
    $scope.point = point;
    $scope.campaign = campaign;
    $scope.inspections = [];
    $scope.originalInspections = [];
    $scope.validationErrors = [];
    
    // Inicializar inspeções baseado nos dados do ponto
    $scope.initializeInspections = function() {
        if ($scope.point.userName && $scope.point.userName.length > 0) {
            $scope.inspections = $scope.point.userName.map(function(user, index) {
                return {
                    user: user,
                    date: new Date(Date.now() - (index * 24 * 60 * 60 * 1000)),
                    dateInput: new Date(Date.now() - (index * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16),
                    time: Math.floor(Math.random() * 300) + 60,
                    form: [{
                        initialYear: $scope.campaign.initialYear || 2020,
                        finalYear: $scope.campaign.finalYear || 2024,
                        landUse: '',
                        pixelBorder: false
                    }],
                    editing: false,
                    isNew: false
                };
            });
        }
        
        // Fazer backup para resetar se necessário
        $scope.originalInspections = angular.copy($scope.inspections);
    };
    
    $scope.addNewInspection = function() {
        $scope.inspections.push({
            user: '',
            date: new Date(),
            dateInput: new Date().toISOString().slice(0, 16),
            time: null,
            form: [{
                initialYear: $scope.campaign.initialYear || 2020,
                finalYear: $scope.campaign.finalYear || 2024,
                landUse: '',
                pixelBorder: false
            }],
            editing: true,
            isNew: true
        });
    };
    
    $scope.editInspection = function(inspection, index) {
        inspection.editing = true;
        inspection.dateInput = inspection.date ? new Date(inspection.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
    };
    
    $scope.saveInspection = function(inspection, index) {
        // Validar inspeção
        if (!inspection.user || inspection.user.trim() === '') {
            alert('Nome do usuário é obrigatório');
            return;
        }
        
        if (inspection.dateInput) {
            inspection.date = new Date(inspection.dateInput);
        }
        
        // Validar formulário
        var hasValidForm = false;
        for (var i = 0; i < inspection.form.length; i++) {
            var form = inspection.form[i];
            if (form.landUse && form.landUse.trim() !== '') {
                hasValidForm = true;
                break;
            }
        }
        
        if (!hasValidForm) {
            alert('Pelo menos uma classe de uso da terra deve ser especificada');
            return;
        }
        
        inspection.editing = false;
        inspection.isNew = false;
    };
    
    $scope.cancelEdit = function(inspection, index) {
        if (inspection.isNew) {
            $scope.inspections.splice(index, 1);
        } else {
            // Restaurar valores originais
            var original = $scope.originalInspections[index];
            if (original) {
                Object.assign(inspection, angular.copy(original));
            }
            inspection.editing = false;
        }
    };
    
    $scope.removeInspection = function(index) {
        if (confirm('Tem certeza que deseja remover esta inspeção?')) {
            $scope.inspections.splice(index, 1);
        }
    };
    
    $scope.addFormItem = function(inspection) {
        inspection.form.push({
            initialYear: $scope.campaign.initialYear || 2020,
            finalYear: $scope.campaign.finalYear || 2024,
            landUse: '',
            pixelBorder: false
        });
    };
    
    $scope.removeFormItem = function(inspection, formIndex) {
        if (inspection.form.length > 1) {
            inspection.form.splice(formIndex, 1);
        }
    };
    
    $scope.hasChanges = function() {
        return !angular.equals($scope.inspections, $scope.originalInspections);
    };
    
    $scope.resetChanges = function() {
        if (confirm('Tem certeza que deseja descartar todas as alterações?')) {
            $scope.inspections = angular.copy($scope.originalInspections);
            $scope.validationErrors = [];
        }
    };
    
    $scope.validateInspections = function() {
        $scope.validationErrors = [];
        
        for (var i = 0; i < $scope.inspections.length; i++) {
            var inspection = $scope.inspections[i];
            
            if (!inspection.user || inspection.user.trim() === '') {
                $scope.validationErrors.push(`Inspeção #${i + 1}: Nome do usuário é obrigatório`);
            }
            
            if (!inspection.date) {
                $scope.validationErrors.push(`Inspeção #${i + 1}: Data é obrigatória`);
            }
            
            var hasValidForm = false;
            for (var j = 0; j < inspection.form.length; j++) {
                var form = inspection.form[j];
                if (form.landUse && form.landUse.trim() !== '') {
                    hasValidForm = true;
                    break;
                }
            }
            
            if (!hasValidForm) {
                $scope.validationErrors.push(`Inspeção #${i + 1}: Pelo menos uma classe de uso da terra deve ser especificada`);
            }
        }
        
        return $scope.validationErrors.length === 0;
    };
    
    $scope.saveAllChanges = function() {
        if (!$scope.validateInspections()) {
            return;
        }
        
        // Preparar dados para envio
        var updateData = {
            pointId: $scope.point._id,
            inspections: $scope.inspections.map(function(inspection) {
                return {
                    user: inspection.user,
                    date: inspection.date,
                    time: inspection.time,
                    form: inspection.form.filter(function(form) {
                        return form.landUse && form.landUse.trim() !== '';
                    })
                };
            })
        };
        
        // Simular envio para o servidor
        // $http.put(`/api/campaigns/${campaign._id}/points/${point._id}/inspections`, updateData)
        
        // Por enquanto, só simular sucesso
        setTimeout(function() {
            $scope.$apply(function() {
                alert(`${$scope.inspections.length} inspeções salvas com sucesso!`);
                $uibModalInstance.close('saved');
            });
        }, 500);
    };
    
    $scope.close = function() {
        if ($scope.hasChanges()) {
            if (confirm('Você tem alterações não salvas. Tem certeza que deseja fechar?')) {
                $uibModalInstance.dismiss('cancel');
            }
        } else {
            $uibModalInstance.dismiss('cancel');
        }
    };
    
    // Inicializar
    $scope.initializeInspections();
});

// Controller do modal de formulário
Application.controller('CampaignFormModalController', function ($scope, $uibModalInstance, campaign, isNew) {
    $scope.campaign = campaign;
    $scope.isNew = isNew;
    $scope.visParamOptions = [
        { value: 'landsat-tvi-true', label: 'Cor Natural' },
        { value: 'landsat-tvi-agri', label: 'Agricultura' },
        { value: 'landsat-tvi-false', label: 'Falsa Cor' },
        { value: 'tvi-red', label: 'TVI Red' }
    ];
    
    $scope.save = function() {
        if (!$scope.campaign._id && $scope.isNew) {
            alert('ID da campanha é obrigatório');
            return;
        }
        $uibModalInstance.close($scope.campaign);
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
    
    $scope.addLandUse = function() {
        const newLandUse = prompt('Digite o novo tipo de uso da terra:');
        if (newLandUse && !$scope.campaign.landUse.includes(newLandUse)) {
            $scope.campaign.landUse.push(newLandUse);
        }
    };
    
    $scope.removeLandUse = function(index) {
        $scope.campaign.landUse.splice(index, 1);
    };
});

// Controller para Gestão de Campanha Individual
Application.controller('CampaignManagementController', function ($scope, $http, $location, $routeParams, $timeout, $uibModal) {
    $scope.campaignId = $routeParams.id;
    $scope.loading = true;
    $scope.details = null;
    $scope.activeTab = 'users';
    
    // Verificar autenticação
    $scope.checkAuth = function() {
        $http.get('/api/admin/check').then(function(response) {
            if (!response.data.authenticated) {
                $location.path('/admin/login');
            } else {
                $scope.loadCampaignDetails();
            }
        }, function() {
            $location.path('/admin/login');
        });
    };
    
    // Carregar detalhes da campanha
    $scope.loadCampaignDetails = function() {
        $scope.loading = true;
        $http.get('/api/campaigns/' + $scope.campaignId + '/details').then(function(response) {
            $scope.details = response.data;
            $scope.loading = false;
            
            // Renderizar gráficos após carregar dados
            $timeout(function() {
                $scope.renderChartsForTab($scope.activeTab);
            }, 100);
        }, function(error) {
            $scope.loading = false;
            if (error.status === 401) {
                $location.path('/admin/login');
            } else if (error.status === 404) {
                alert('Campanha não encontrada');
                $location.path('/admin/campaigns');
            } else {
                alert('Erro ao carregar detalhes da campanha');
            }
        });
    };
    
    // Voltar para lista de campanhas
    $scope.goBack = function() {
        $location.path('/admin/campaigns');
    };
    
    // Definir aba ativa
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        
        // Renderizar gráficos quando a aba é selecionada
        $timeout(function() {
            $scope.renderChartsForTab(tab);
        }, 100);
    };
    
    // Obter classe CSS para progresso
    $scope.getProgressClass = function(progress) {
        progress = parseFloat(progress);
        if (progress >= 90) return 'success';
        if (progress >= 70) return 'warning';
        if (progress >= 50) return 'info';
        return 'danger';
    };
    
    // Renderizar gráficos por aba
    $scope.renderChartsForTab = function(tab) {
        if (!$scope.details) return;
        
        switch(tab) {
            case 'users':
                $scope.renderUserInspectionsChart();
                break;
            case 'classes':
                $scope.renderLandCoverChart();
                break;
            case 'regions':
                $scope.renderStatesChart();
                $scope.renderBiomesChart();
                break;
            case 'timeline':
                $scope.renderTimelineChart();
                $scope.renderMeanTimeChart();
                $scope.renderPointsStatusChart();
                break;
            case 'pending':
                $scope.renderPendingMunicipalitiesChart();
                break;
        }
    };
    
    // Gráfico de inspeções por usuário
    $scope.renderUserInspectionsChart = function() {
        if (!$scope.details || !$scope.details.statistics.users.topInspectors) return;
        
        var element = document.getElementById('userInspectionsChart');
        if (!element) return;
        
        var data = $scope.details.statistics.users.topInspectors;
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Número de pontos inspecionados por usuário', 500);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(168,80,81,1)'
            },
            x: data.map(user => user.inspections),
            y: data.map(user => user._id),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 150,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Número de Inspeções'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Número de Pontos Inspecionados por Usuário',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de distribuição de classes de uso do solo
    $scope.renderLandCoverChart = function() {
        if (!$scope.details || !$scope.details.statistics.classes.distribution) return;
        
        var element = document.getElementById('landCoverChart');
        if (!element) return;
        
        var data = $scope.details.statistics.classes.distribution;
        var fieldUsed = $scope.details.statistics.classes.fieldUsed;
        var noDataMessage = $scope.details.statistics.classes.noDataMessage;
        
        if (noDataMessage || !data || data.length === 0) {
            var message = noDataMessage || 'Nenhum dado disponível';
            $scope.showNoDataMessage(element, 'Distribuição de classes', 500, message);
            return;
        }
        
        // Título dinâmico baseado no campo usado
        var title = 'Distribuição de Classes';
        if (fieldUsed) {
            // Extrair nome do campo se for aninhado
            var fieldName = fieldUsed.includes('.') ? fieldUsed.split('.')[1] : fieldUsed;
            title = 'Distribuição por ' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(169,169,169,1)'
            },
            x: data.map(cls => cls.count),
            y: data.map(cls => cls._id || 'Não classificado'),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 150,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Quantidade'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: title,
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de progresso por estados
    $scope.renderStatesChart = function() {
        if (!$scope.details || !$scope.details.statistics.states.data) return;
        
        var element = document.getElementById('statesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.states.data.slice(0, 10);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso por estado', 400);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(32,128,72,0.8)'
            },
            x: data.map(state => state.completed),
            y: data.map(state => state._id || 'Não informado'),
            orientation: 'h',
            hoverinfo: 'x',
            name: 'Concluídos'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Concluídos'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Progresso por Estado',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de progresso por biomas
    $scope.renderBiomesChart = function() {
        if (!$scope.details || !$scope.details.statistics.biomes.data) return;
        
        var element = document.getElementById('biomesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.biomes.data.slice(0, 10);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso por bioma', 400);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(65,105,225,0.8)'
            },
            x: data.map(biome => biome.completed),
            y: data.map(biome => biome._id || 'Não informado'),
            orientation: 'h',
            hoverinfo: 'x',
            name: 'Concluídos'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Concluídos'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Progresso por Bioma',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de linha do tempo
    $scope.renderTimelineChart = function() {
        if (!$scope.details || !$scope.details.statistics.timeline) return;
        
        var element = document.getElementById('timelineChart');
        if (!element) return;
        
        var data = $scope.details.statistics.timeline;
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso de inspeções ao longo do tempo', 400);
            return;
        }
        
        var dataChart = [{
            type: 'scatter',
            mode: 'lines+markers',
            x: data.map(point => point._id),
            y: data.map(point => point.count),
            line: {
                color: 'rgba(52,152,219,1)',
                width: 3
            },
            marker: {
                color: 'rgba(52,152,219,1)',
                size: 8
            },
            hoverinfo: 'x+y'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 50,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Data'
            },
            yaxis: {
                fixedrange: true,
                title: 'Número de Inspeções'
            },
            title: 'Progresso de Inspeções ao Longo do Tempo',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de tempo médio por inspeção
    $scope.renderMeanTimeChart = function() {
        if (!$scope.details || !$scope.details.statistics.meanTime) return;
        
        var element = document.getElementById('meanTimeChart');
        if (!element) return;
        
        var data = $scope.details.statistics.meanTime;
        var users = Object.keys(data);
        
        if (!users || users.length === 0) {
            $scope.showNoDataMessage(element, 'Média de tempo por inspeção', 300);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            x: users.map(user => data[user].avg),
            y: users,
            orientation: 'h',
            marker: {
                color: 'rgba(255,127,14,0.8)'
            },
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 300,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Tempo Médio (segundos)'
            },
            yaxis: {
                fixedrange: true
            },
            title: 'Média de Tempo por Inspeção',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de status dos pontos (pizza)
    $scope.renderPointsStatusChart = function() {
        if (!$scope.details || !$scope.details.campaign) return;
        
        var element = document.getElementById('pointsStatusChart');
        if (!element) return;
        
        var campaign = $scope.details.campaign;
        
        var dataChart = [{
            values: [campaign.completedPoints, campaign.pendingPoints],
            labels: ['Pontos Concluídos', 'Pontos Pendentes'],
            type: 'pie',
            marker: {
                colors: ['rgba(44,160,44,0.9)', 'rgba(237,19,21,0.85)']
            },
            hoverinfo: 'label+value+percent'
        }];
        
        var layout = {
            height: 300,
            title: 'Status dos Pontos',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de municípios com pontos pendentes
    $scope.renderPendingMunicipalitiesChart = function() {
        if (!$scope.details || !$scope.details.statistics.pendingByMunicipality) return;
        
        var element = document.getElementById('pendingMunicipalitiesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.pendingByMunicipality.slice(0, 20);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Distribuição de pontos pendentes por município', 500);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(255,193,7,0.8)'
            },
            x: data.map(item => item.count),
            y: data.map(item => (item._id.municipality || 'N/A') + ' - ' + (item._id.state || 'N/A')),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 200,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Pendentes'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Top 20 Municípios com Pontos Pendentes',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Função para mostrar mensagem "sem dados"
    $scope.showNoDataMessage = function(element, title, height, customMessage) {
        var layout = {
            height: height,
            title: title,
            titlefont: {
                size: 18
            },
            xaxis: {
                visible: false,
                showgrid: false,
                showline: false,
                showticklabels: false,
                zeroline: false
            },
            yaxis: {
                visible: false,
                showgrid: false,
                showline: false,
                showticklabels: false,
                zeroline: false
            },
            plot_bgcolor: 'rgba(0,0,0,0)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            showlegend: false,
            margin: {
                l: 0,
                r: 0,
                t: 60,
                b: 0
            },
            annotations: [{
                text: customMessage || 'Nenhum dado disponível',
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                font: {
                    size: 18,
                    color: '#999999'
                },
                x: 0.5,
                y: 0.5,
                xanchor: 'center',
                yanchor: 'middle'
            }]
        };
        Plotly.newPlot(element, [], layout, {displayModeBar: false});
    };
    
    // Ações
    $scope.editCampaign = function() {
        var modalInstance = $uibModal.open({
            templateUrl: '/views/campaign-form-modal.tpl.html',
            controller: 'CampaignFormModalController',
            resolve: {
                campaign: function() { 
                    return angular.copy($scope.details.campaign); 
                },
                isNew: function() { return false; }
            }
        });
        
        modalInstance.result.then(function(updatedCampaign) {
            $http.put('/api/campaigns/' + updatedCampaign._id, updatedCampaign).then(function(response) {
                if (response.data.success) {
                    alert('Campanha atualizada com sucesso!');
                    $scope.loadCampaignDetails();
                }
            }, function(error) {
                alert('Erro ao atualizar campanha: ' + (error.data.error || 'Erro desconhecido'));
            });
        });
    };
    
    $scope.viewPoints = function() {
        var modalInstance = $uibModal.open({
            templateUrl: '/views/campaign-points-modal.tpl.html',
            controller: 'AdminCampaignPointsModalController',
            size: 'lg',
            resolve: {
                campaign: function() { return $scope.details.campaign; }
            }
        });
    };
    
    $scope.manageLandUse = function() {
        alert('Funcionalidade de gerenciamento de classes será implementada em breve');
    };
    
    $scope.uploadMorePoints = function() {
        var modalInstance = $uibModal.open({
            templateUrl: '/views/geojson-upload-modal.tpl.html',
            controller: 'AdminGeoJSONUploadModalController',
            resolve: {
                campaignId: function() { return $scope.campaignId; }
            }
        });
        
        modalInstance.result.then(function() {
            $scope.loadCampaignDetails();
        });
    };
    
    $scope.downloadReport = function() {
        // Gerar relatório CSV
        var csv = 'Relatório da Campanha: ' + $scope.campaignId + '\n\n';
        csv += 'Informações Gerais\n';
        csv += 'Total de Pontos,' + $scope.details.campaign.totalPoints + '\n';
        csv += 'Pontos Concluídos,' + $scope.details.campaign.completedPoints + '\n';
        csv += 'Pontos Pendentes,' + $scope.details.campaign.pendingPoints + '\n';
        csv += 'Progresso,' + $scope.details.campaign.progress + '%\n\n';
        
        csv += 'Top 10 Inspetores\n';
        csv += 'Posição,Usuário,Inspeções\n';
        $scope.details.statistics.users.topInspectors.forEach(function(user, index) {
            csv += (index + 1) + ',' + user._id + ',' + user.inspections + '\n';
        });
        
        csv += '\nDistribuição de Classes\n';
        csv += 'Classe,Quantidade,Percentual\n';
        $scope.details.statistics.classes.distribution.forEach(function(cls) {
            var pct = ((cls.count / $scope.details.campaign.completedPoints) * 100).toFixed(2);
            csv += (cls._id || 'Não classificado') + ',' + cls.count + ',' + pct + '%\n';
        });
        
        // Criar blob e fazer download
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'relatorio_campanha_' + $scope.campaignId + '_' + new Date().toISOString().split('T')[0] + '.csv';
        link.click();
    };
    
    $scope.deleteCampaign = function() {
        if ($scope.details.campaign.totalPoints > 0) {
            alert('Não é possível excluir campanhas com pontos associados');
            return;
        }
        
        if (!confirm('Tem certeza que deseja excluir esta campanha? Esta ação não pode ser desfeita!')) {
            return;
        }
        
        $http.delete('/api/campaigns/' + $scope.campaignId).then(function(response) {
            alert('Campanha excluída com sucesso');
            $location.path('/admin/campaigns');
        }, function(error) {
            alert('Erro ao excluir campanha: ' + (error.data.error || 'Erro desconhecido'));
        });
    };
    
    // Functions for Properties Tab
    $scope.getVisualizationTypeName = function(type) {
        const typeNames = {
            'pie_chart': 'Gráfico de Pizza',
            'bar_chart': 'Gráfico de Barras',
            'treemap': 'Mapa de Árvore',
            'histogram': 'Histograma',
            'box_plot': 'Box Plot',
            'timeline': 'Linha do Tempo',
            'choropleth_map': 'Mapa Coroplético',
            'heat_map': 'Mapa de Calor',
            'heatmap': 'Mapa de Calor',
            'table': 'Tabela'
        };
        return typeNames[type] || type;
    };
    
    $scope.renderPropertyChart = function(recommendation) {
        const index = $scope.details.visualizationRecommendations.indexOf(recommendation);
        const elementId = 'property-chart-' + index;
        
        // Mark as rendered
        recommendation.rendered = true;
        
        // Wait for DOM update
        $timeout(function() {
            const element = document.getElementById(elementId);
            if (!element) return;
            
            // Load property data and render chart based on recommendation type
            switch(recommendation.type) {
                case 'main_classification':
                    $scope.renderPropertyClassificationChart(element, recommendation);
                    break;
                case 'temporal_analysis':
                    $scope.renderPropertyTemporalChart(element, recommendation);
                    break;
                case 'geographic_analysis':
                    $scope.renderPropertyGeographicChart(element, recommendation);
                    break;
                case 'numeric_analysis':
                    $scope.renderPropertyNumericChart(element, recommendation);
                    break;
                case 'cross_analysis':
                    $scope.renderPropertyCrossAnalysisChart(element, recommendation);
                    break;
                default:
                    $scope.showNoDataMessage(element, recommendation.title, 400, 'Tipo de visualização não implementado');
            }
        }, 100);
    };
    
    $scope.renderPropertyClassificationChart = function(element, recommendation) {
        // Get property data from backend
        $http.get('/api/campaigns/' + $scope.campaignId + '/aggregate-property', {
            params: {
                property: recommendation.property,
                type: 'distribution'
            }
        }).then(function(response) {
            const data = response.data;
            
            if (!data || !data.data || data.data.length === 0) {
                $scope.showNoDataMessage(element, recommendation.title, 400);
                return;
            }
            
            const labels = data.data.map(d => d.label || 'Não especificado');
            const values = data.data.map(d => d.value);
            
            const dataChart = [{
                type: recommendation.visualization === 'pie_chart' ? 'pie' : 'bar',
                labels: labels,
                values: values,
                marker: {
                    color: 'rgba(50, 171, 96, 0.7)'
                },
                textinfo: recommendation.visualization === 'pie_chart' ? 'label+percent' : undefined
            }];
            
            const layout = {
                height: 400,
                title: recommendation.title,
                titlefont: { size: 18 },
                showlegend: recommendation.visualization === 'pie_chart'
            };
            
            if (recommendation.visualization === 'bar_chart') {
                layout.xaxis = { title: 'Categoria' };
                layout.yaxis = { title: 'Quantidade' };
            }
            
            Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
        }, function(error) {
            $scope.showNoDataMessage(element, recommendation.title, 400, 'Erro ao carregar dados');
        });
    };
    
    $scope.renderPropertyTemporalChart = function(element, recommendation) {
        // Get temporal data from backend
        $http.get('/api/campaigns/' + $scope.campaignId + '/aggregate-property', {
            params: {
                property: recommendation.property,
                type: 'temporal'
            }
        }).then(function(response) {
            const data = response.data;
            
            if (!data || !data.data || data.data.length === 0) {
                $scope.showNoDataMessage(element, recommendation.title, 400, 'Sem dados temporais');
                return;
            }
            
            const dates = data.data.map(d => d.date);
            const values = data.data.map(d => d.value);
            
            const dataChart = [{
                type: 'scatter',
                mode: 'lines+markers',
                x: dates,
                y: values,
                line: { color: 'rgba(31, 119, 180, 1)' },
                marker: { size: 6 }
            }];
            
            const layout = {
                height: 400,
                title: recommendation.title,
                titlefont: { size: 18 },
                xaxis: { title: 'Data' },
                yaxis: { title: 'Valor' }
            };
            
            Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
        }, function(error) {
            $scope.showNoDataMessage(element, recommendation.title, 400, 'Erro ao carregar dados temporais');
        });
    };
    
    $scope.renderPropertyGeographicChart = function(element, recommendation) {
        // Get geographic data from backend
        $http.get('/api/campaigns/' + $scope.campaignId + '/aggregate-property', {
            params: {
                property: recommendation.property,
                type: 'distribution'
            }
        }).then(function(response) {
            const data = response.data;
            
            if (!data || !data.data || data.data.length === 0) {
                $scope.showNoDataMessage(element, recommendation.title, 400, 'Sem dados geográficos');
                return;
            }
            
            // For geographic data, create a bar chart or scatter plot depending on data type
            if (recommendation.visualization === 'heat_map') {
                // For heat map, create a scatter plot of the numeric values
                const labels = data.data.map(d => d.label || 'Não especificado');
                const values = data.data.map(d => d.value);
                
                const dataChart = [{
                    type: 'scatter',
                    mode: 'markers',
                    x: labels,
                    y: values,
                    marker: {
                        size: values.map(v => Math.max(5, Math.min(20, v / Math.max(...values) * 20))),
                        color: values,
                        colorscale: 'Viridis',
                        showscale: true
                    },
                    text: labels.map((label, i) => `${label}: ${values[i]}`),
                    textposition: 'middle center'
                }];
                
                const layout = {
                    height: 400,
                    title: recommendation.title,
                    titlefont: { size: 18 },
                    xaxis: { title: 'Localização' },
                    yaxis: { title: 'Valor' }
                };
                
                Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
            } else {
                // For choropleth map, create a horizontal bar chart
                const labels = data.data.map(d => d.label || 'Não especificado');
                const values = data.data.map(d => d.value);
                
                const dataChart = [{
                    type: 'bar',
                    orientation: 'h',
                    x: values,
                    y: labels,
                    marker: {
                        color: values,
                        colorscale: 'Blues'
                    }
                }];
                
                const layout = {
                    height: 400,
                    title: recommendation.title,
                    titlefont: { size: 18 },
                    xaxis: { title: 'Quantidade' },
                    yaxis: { title: 'Localização' },
                    margin: { l: 100 }
                };
                
                Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
            }
        }, function(error) {
            $scope.showNoDataMessage(element, recommendation.title, 400, 'Erro ao carregar dados geográficos');
        });
    };
    
    $scope.renderPropertyNumericChart = function(element, recommendation) {
        // Get numeric data from backend
        $http.get('/api/campaigns/' + $scope.campaignId + '/aggregate-property', {
            params: {
                property: recommendation.property,
                type: 'histogram'
            }
        }).then(function(response) {
            const data = response.data;
            
            if (!data || !data.data || data.data.length === 0) {
                $scope.showNoDataMessage(element, recommendation.title, 400, 'Sem dados numéricos');
                return;
            }
            
            if (recommendation.visualization === 'histogram') {
                // Create histogram from aggregated data
                const x = [];
                const y = [];
                
                data.data.forEach(bin => {
                    const midpoint = (bin.range[0] + bin.range[1]) / 2;
                    x.push(midpoint);
                    y.push(bin.count);
                });
                
                const dataChart = [{
                    type: 'bar',
                    x: x,
                    y: y,
                    marker: { color: 'rgba(255, 127, 14, 0.7)' },
                    name: recommendation.property
                }];
                
                const layout = {
                    height: 400,
                    title: recommendation.title,
                    titlefont: { size: 18 },
                    xaxis: { title: recommendation.property },
                    yaxis: { title: 'Frequência' },
                    bargap: 0.05
                };
                
                Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
            } else {
                // Box plot
                if (!data.statistics) {
                    $scope.showNoDataMessage(element, recommendation.title, 400, 'Sem estatísticas disponíveis');
                    return;
                }
                
                const stats = data.statistics;
                const dataChart = [{
                    type: 'box',
                    y: [stats.min, stats.mean - 20, stats.mean, stats.mean + 20, stats.max],
                    boxpoints: false,
                    name: recommendation.property,
                    marker: { color: 'rgba(44, 160, 44, 0.7)' }
                }];
                
                const layout = {
                    height: 400,
                    title: recommendation.title,
                    titlefont: { size: 18 },
                    yaxis: { title: recommendation.property }
                };
                
                Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
            }
        }, function(error) {
            $scope.showNoDataMessage(element, recommendation.title, 400, 'Erro ao carregar dados');
        });
    };
    
    $scope.renderPropertyCrossAnalysisChart = function(element, recommendation) {
        // Placeholder heatmap
        $scope.showNoDataMessage(element, recommendation.title, 400, 'Análise cruzada será implementada em breve');
    };
    
    $scope.loadAvailableProperties = function() {
        $scope.loading = true;
        $http.get('/api/campaigns/' + $scope.campaignId + '/properties').then(function(response) {
            if (response.data) {
                $scope.details.propertyAnalysis = response.data;
                $scope.details.visualizationRecommendations = response.data.visualizationRecommendations || [];
            }
            $scope.loading = false;
        }, function(error) {
            $scope.loading = false;
            alert('Erro ao carregar propriedades: ' + (error.data.error || 'Erro desconhecido'));
        });
    };
    
    $scope.exportPropertyAnalysis = function() {
        if (!$scope.details.propertyAnalysis) {
            alert('Nenhuma análise disponível para exportar');
            return;
        }
        
        // Create JSON export
        const exportData = {
            campaignId: $scope.campaignId,
            analysisDate: new Date().toISOString(),
            propertyAnalysis: $scope.details.propertyAnalysis,
            visualizationRecommendations: $scope.details.visualizationRecommendations
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `property-analysis-${$scope.campaignId}-${Date.now()}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    };
    
    // Inicializar
    $scope.checkAuth();
});
