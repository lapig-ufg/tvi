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
            console.log('Não autenticado ou erro na verificação');
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
                console.log('Login bem-sucedido, redirecionando para admin/campaigns');
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
        console.log('Admin mode activated:', $scope.$root.isAdminMode);
        
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
        console.log('loadCampaigns called with page:', page);
        console.log('Current path before loadCampaigns:', $location.path());
        console.log('Current admin mode before loadCampaigns:', $scope.$root.isAdminMode);
        
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
        
        console.log('Making API call to:', '/api/campaigns' + params);
        
        $http.get('/api/campaigns' + params).then(function(response) {
            console.log('API call successful, response received');
            $scope.campaigns = response.data.campaigns;
            $scope.pagination = response.data.pagination;
            $scope.loading = false;
        }, function(error) {
            console.error('Error loading campaigns:', error);
            console.log('Current path after error:', $location.path());
            $scope.loading = false;
            if (error.status === 401) {
                console.log('Redirecting to /admin/login due to 401 error');
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
        console.log('goToPage called with page:', page);
        console.log('Current admin mode:', $scope.$root.isAdminMode);
        console.log('Current pagination:', $scope.pagination);
        
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
        console.log('Criando nova conexão socket global...');
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
                console.log('Socket global conectado:', window.adminSocket.id);
            });
            
            window.adminSocket.on('disconnect', function() {
                console.log('Socket global desconectado');
            });
            
            window.adminSocket.on('connect_error', function(error) {
                console.error('Erro na conexão socket global:', error);
            });
            
            window.adminSocket.on('reconnect', function(attemptNumber) {
                console.log('Socket global reconectado após', attemptNumber, 'tentativas');
            });
            
        } catch (error) {
            console.error('Erro ao criar socket global:', error);
            window.adminSocket = io();
        }
    } else {
        console.log('Reutilizando socket global existente:', window.adminSocket.id);
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
            alert('Selecione um arquivo GeoJSON');
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
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            
            $http.post('/api/campaigns/upload-geojson', {
                campaignId: campaignId,
                geojsonContent: content,
                filename: $scope.file.name
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
                    
                    console.log('Upload concluído com sucesso:', response.data);
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
                    $scope.uploadProgress.error = error.data?.error || 'Erro de conexão';
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

Application.controller('AdminCampaignPointsModalController', function ($scope, $uibModalInstance, $http, $location, campaign) {
    $scope.campaign = campaign;
    $scope.points = [];
    $scope.loading = false;
    $scope.currentPage = 1;
    $scope.pageSize = 50;
    $scope.totalPoints = 0;
    $scope.searchId = '';
    $scope.Math = Math;
    
    $scope.loadPoints = function() {
        $scope.loading = true;
        const skip = ($scope.currentPage - 1) * $scope.pageSize;
        let url = `/api/campaigns/${campaign._id}/points?limit=${$scope.pageSize}&skip=${skip}`;
        
        // Se há busca por ID, adicionar ao query
        if ($scope.searchId && $scope.searchId.trim()) {
            url += `&search=${encodeURIComponent($scope.searchId.trim())}`;
        }
        
        $http.get(url).then(function(response) {
            $scope.points = response.data.points;
            $scope.totalPoints = response.data.total;
            $scope.loading = false;
        }, function(error) {
            console.error('Error loading points:', error);
            $scope.loading = false;
            if (error.status === 401) {
                $uibModalInstance.dismiss('unauthorized');
                $location.path('/admin/login');
            }
        });
    };
    
    $scope.searchPoints = function() {
        // Reset para primeira página quando faz busca
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
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
    
    // Inicializar
    $scope.loadPoints();
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
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Distribuição de classes de uso do solo', 500);
            return;
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
            title: 'Distribuição de Classes de Uso do Solo',
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
            y: data.map(state => state._id || 'N/A'),
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
            y: data.map(biome => biome._id || 'N/A'),
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
    $scope.showNoDataMessage = function(element, title, height) {
        var layout = {
            height: height,
            title: title,
            titlefont: {
                size: 18
            },
            xaxis: {
                visible: false
            },
            yaxis: {
                visible: false
            },
            annotations: [{
                text: 'Nenhum dado disponível',
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                font: {
                    size: 20,
                    color: 'grey'
                },
                x: 0.5,
                y: 0.5
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
    
    // Inicializar
    $scope.checkAuth();
});
