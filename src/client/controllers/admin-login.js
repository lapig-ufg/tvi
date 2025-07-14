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

    // Carregar campanhas (mesmo código do controller anterior)
    $scope.loadCampaigns = function(page) {
        if (page) {
            $scope.pagination.currentPage = page;
        }
        
        $scope.loading = true;
        const params = `?page=${$scope.pagination.currentPage}&limit=${$scope.pagination.limit}`;
        
        $http.get('/api/campaigns' + params).then(function(response) {
            $scope.campaigns = response.data.campaigns;
            $scope.pagination = response.data.pagination;
            $scope.loading = false;
        }, function(error) {
            console.error('Error loading campaigns:', error);
            $scope.loading = false;
            if (error.status === 401) {
                $scope.checkAuth(); // Tentar reautenticar
            } else {
                alert('Erro ao carregar campanhas');
            }
        });
    };

    // Funções de navegação
    $scope.goToPage = function(page) {
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
        landUse: [
            "Pastagem Natural", 
            "Vegetação nativa", 
            "Pastagem Cultivada", 
            "Não observado", 
            "Agricultura Anual", 
            "Em regeneração", 
            "Agricultura Perene", 
            "Mosaico de ocupação", 
            "Água", 
            "Solo Exposto", 
            "Cana-de-açucar", 
            "Desmatamento", 
            "Área urbana", 
            "Silvicultura"
        ],
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
            size: 'md',
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

    $scope.getProgressClass = function(progress) {
        if (progress < 33) return 'progress-bar-danger';
        if (progress < 66) return 'progress-bar-warning';
        return 'progress-bar-success';
    };

    // Verificar autenticação ao carregar
    $scope.checkAuth();
});

// Controllers dos modais (adaptados para admin)
Application.controller('AdminGeoJSONUploadModalController', function ($scope, $uibModalInstance, $http, $location, campaignId) {
    $scope.uploading = false;
    $scope.file = null;
    $scope.skipGeoprocessing = false;
    
    $scope.setFile = function(element) {
        $scope.$apply(function() {
            $scope.file = element.files[0];
        });
    };
    
    $scope.upload = function() {
        if (!$scope.file) {
            alert('Selecione um arquivo GeoJSON');
            return;
        }
        
        $scope.uploading = true;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            
            $http.post('/api/campaigns/upload-geojson', {
                campaignId: campaignId,
                skipGeoprocessing: $scope.skipGeoprocessing,
                geojsonContent: content,
                filename: $scope.file.name
            }).then(function(response) {
                $scope.uploading = false;
                $uibModalInstance.close(response.data);
            }, function(error) {
                $scope.uploading = false;
                if (error.status === 401) {
                    $uibModalInstance.dismiss('unauthorized');
                    $location.path('/admin/login');
                } else {
                    alert('Erro no upload: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        };
        
        reader.onerror = function() {
            $scope.uploading = false;
            alert('Erro ao ler o arquivo');
        };
        
        reader.readAsText($scope.file);
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
    
    $scope.loadPoints = function() {
        $scope.loading = true;
        const skip = ($scope.currentPage - 1) * $scope.pageSize;
        
        $http.get(`/api/campaigns/${campaign._id}/points?limit=${$scope.pageSize}&skip=${skip}`).then(function(response) {
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
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
    
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