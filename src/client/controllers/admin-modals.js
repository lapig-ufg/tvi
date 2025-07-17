'use strict';

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
            NotificationDialog.warning('Selecione um arquivo GeoJSON ou ZIP');
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
    $scope.pageSize = 10;
    $scope.totalPoints = 0;
    $scope.searchId = '';
    $scope.Math = Math;
    
    // Tab management
    $scope.activeTab = 'filters';
    $scope.itemsPerPage = 10;
    $scope.totalPages = 1;
    
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
    
    // Tab management
    $scope.activeTab = 'filters';
    
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
    };
    
    $scope.loadPoints = function() {
        $scope.loading = true;
        let url = `/api/campaigns/${campaign._id}/points?limit=${$scope.pageSize}&page=${$scope.currentPage}&includeInspections=true`;
        
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
            
            // Pre-calculate computed values to avoid digest cycles
            $scope.points.forEach(function(point) {
                const inspectionCount = point.userName ? point.userName.length : 0;
                point._inspectionCount = inspectionCount;
                point._progress = Math.min(100, (inspectionCount / campaign.numInspec) * 100);
                
                if (inspectionCount >= campaign.numInspec) {
                    point._statusClass = 'completed';
                    point._statusText = 'Completo';
                } else if (inspectionCount > 0) {
                    point._statusClass = 'in-progress';
                    point._statusText = 'Em andamento';
                } else {
                    point._statusClass = 'not-started';
                    point._statusText = 'Não iniciado';
                }
            });
            
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
        NotificationDialog.confirm(`Tem certeza que deseja remover ${$scope.removalPreview.length} inspeções? Esta ação não pode ser desfeita!`, 'Confirmar Remoção').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            // Implement actual removal logic here
            $http.post(`/api/campaigns/${campaign._id}/remove-inspections`, {
                criteria: $scope.removalCriteria,
                preview: $scope.removalPreview
            }).then(function(response) {
                if (response.data.success) {
                    NotificationDialog.success(`${response.data.removedCount} inspeções removidas com sucesso!`);
                    $scope.loadPoints();
                    $scope.removalPreview = [];
                } else {
                    NotificationDialog.error('Erro ao remover inspeções: ' + response.data.error);
                }
            }, function(error) {
                NotificationDialog.error('Erro ao remover inspeções: ' + (error.data?.error || 'Erro desconhecido'));
            });
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
            windowClass: 'modal-80-percent',
            resolve: {
                point: function() { return point; },
                campaign: function() { return campaign; }
            }
        }).result.then(function() {
            $scope.loadPoints();
        });
    };
    
    $scope.removePointInspections = function(point) {
        NotificationDialog.confirm(`Tem certeza que deseja remover todas as inspeções do ponto ${point._id}?`, 'Confirmar Remoção').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            $http.delete(`/api/campaigns/${campaign._id}/points/${point._id}/inspections`).then(function(response) {
                if (response.data.success) {
                    NotificationDialog.success('Inspeções removidas com sucesso!');
                    $scope.loadPoints();
                } else {
                    NotificationDialog.error('Erro ao remover inspeções: ' + response.data.error);
                }
            }, function(error) {
                NotificationDialog.error('Erro ao remover inspeções: ' + (error.data?.error || 'Erro desconhecido'));
            });
        });
    };
    
    // Bulk actions
    $scope.bulkEditInspections = function() {
        NotificationDialog.info('Funcionalidade de edição em lote será implementada em breve');
    };
    
    $scope.bulkRemoveInspections = function() {
        NotificationDialog.confirm(`Tem certeza que deseja remover as inspeções de ${$scope.selectedPoints.length} pontos selecionados?`, 'Confirmar Remoção em Lote').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            const pointIds = $scope.selectedPoints.map(p => p._id);
            $http.post(`/api/campaigns/${campaign._id}/bulk-remove-inspections`, { pointIds }).then(function(response) {
                if (response.data.success) {
                    NotificationDialog.success(`Inspeções removidas de ${response.data.removedCount} pontos!`);
                    $scope.loadPoints();
                } else {
                    NotificationDialog.error('Erro na remoção em lote: ' + response.data.error);
                }
            }, function(error) {
                NotificationDialog.error('Erro na remoção em lote: ' + (error.data?.error || 'Erro desconhecido'));
            });
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
    
    // Selection functions for the table
    $scope.toggleSelectAll = function() {
        $scope.selectedPoints = [];
        if ($scope.selectAll) {
            $scope.selectedPoints = angular.copy($scope.points);
            $scope.points.forEach(function(point) {
                point.selected = true;
            });
        } else {
            $scope.points.forEach(function(point) {
                point.selected = false;
            });
        }
    };
    
    $scope.updateSelection = function() {
        $scope.selectedPoints = $scope.points.filter(function(point) {
            return point.selected;
        });
        $scope.selectAll = $scope.selectedPoints.length === $scope.points.length;
    };
    
    // Point status functions
    $scope.getStatusClass = function(point) {
        const inspectionCount = point.userName ? point.userName.length : 0;
        if (inspectionCount >= campaign.numInspec) {
            return 'completed';
        } else if (inspectionCount > 0) {
            return 'in-progress';
        } else {
            return 'not-started';
        }
    };
    
    $scope.getStatusText = function(point) {
        const inspectionCount = point.userName ? point.userName.length : 0;
        if (inspectionCount >= campaign.numInspec) {
            return 'Completo';
        } else if (inspectionCount > 0) {
            return 'Em andamento';
        } else {
            return 'Não iniciado';
        }
    };
    
    $scope.getPointProgress = function(point) {
        const inspectionCount = point.userName ? point.userName.length : 0;
        return Math.min(100, (inspectionCount / campaign.numInspec) * 100);
    };
    
    // Point actions
    $scope.viewPoint = function(point) {
        $uibModal.open({
            templateUrl: 'views/point-details-modal.tpl.html',
            controller: 'PointDetailsModalController',
            size: 'lg',
            resolve: {
                point: function() {
                    return point;
                },
                campaign: function() {
                    return campaign;
                }
            }
        });
    };
    
    $scope.editPoint = function(point) {
        $uibModal.open({
            templateUrl: 'views/point-inspections-edit-modal.tpl.html',
            controller: 'PointInspectionsEditModalController',
            size: 'xl',
            windowClass: 'modal-80-percent',
            resolve: {
                point: function() {
                    return point;
                },
                campaign: function() {
                    return campaign;
                }
            }
        }).result.then(function(result) {
            if (result === 'saved') {
                $scope.loadPoints(); // Reload points after edit
            }
        });
    };
    
    // Missing applyFilters function
    $scope.applyFilters = function() {
        $scope.currentPage = 1;
        $scope.loadPoints();
    };

    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
    
    // Get display points (for pagination)
    $scope.getDisplayPoints = function() {
        // If we have filtered points from frontend filtering, use those
        if ($scope.filteredPoints) {
            const start = ($scope.currentPage - 1) * $scope.pageSize;
            const end = start + $scope.pageSize;
            return $scope.filteredPoints.slice(start, end);
        }
        // Otherwise, return the points from backend (already paginated)
        return $scope.points;
    };
    
    // Functions for the new template
    $scope.clearFilters = function() {
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
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    $scope.searchPointById = function() {
        $scope.currentPage = 1;
        $scope.loadPoints();
    };
    
    $scope.setStatusFilter = function(status) {
        $scope.filters.status = status === 'all' ? '' : status;
        $scope.applyFilters();
    };
    
    $scope.getPageNumbers = function() {
        const totalPages = $scope.getTotalPages();
        const pages = [];
        const current = $scope.currentPage;
        
        // Always show first page
        if (current > 3) {
            pages.push(1);
            if (current > 4) pages.push('...');
        }
        
        // Show current page and neighbors
        const start = Math.max(1, current - 2);
        const end = Math.min(totalPages, current + 2);
        
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        
        // Always show last page
        if (current < totalPages - 2) {
            if (current < totalPages - 3) pages.push('...');
            pages.push(totalPages);
        }
        
        return pages;
    };
    
    $scope.previousPage = function() {
        if ($scope.currentPage > 1) {
            $scope.goToPage($scope.currentPage - 1);
        }
    };
    
    $scope.nextPage = function() {
        if ($scope.currentPage < $scope.getTotalPages()) {
            $scope.goToPage($scope.currentPage + 1);
        }
    };
    
    $scope.viewInspectorPoints = function() {
        if ($scope.selectedInspector) {
            const inspector = $scope.inspectorsList.find(i => i.name === $scope.selectedInspector);
            if (inspector) {
                $scope.inspectorStats = inspector;
            }
        }
    };
    
    $scope.downloadSelected = function() {
        if ($scope.selectedPoints.length === 0) {
            NotificationDialog.warning('Nenhum ponto selecionado');
            return;
        }
        $scope.exportSelectedPoints();
    };
    
    $scope.bulkEditSelected = function() {
        if ($scope.selectedPoints.length === 0) {
            NotificationDialog.warning('Nenhum ponto selecionado');
            return;
        }
        $scope.bulkEditInspections();
    };
    
    $scope.bulkRemoveSelected = function() {
        if ($scope.selectedPoints.length === 0) {
            NotificationDialog.warning('Nenhum ponto selecionado');
            return;
        }
        $scope.bulkRemoveInspections();
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
    
    // Pre-calculate values to avoid digest cycles
    const inspectionCount = $scope.point.userName ? $scope.point.userName.length : 0;
    $scope.inspectionCount = inspectionCount;
    $scope.uniqueInspectors = $scope.point.userName ? new Set($scope.point.userName).size : 0;
    $scope.completionPercentage = Math.round((inspectionCount / $scope.campaign.numInspec) * 100);
    
    // Pre-calculate inspection details using actual backend structure
    if ($scope.point.inspection && $scope.point.inspection.length > 0) {
        // Use the actual backend structure with inspection array
        $scope.inspectionDetails = $scope.point.inspection.map(function(inspection, index) {
            var dateObj = new Date();
            
            // Handle date conversion safely - try fillDate first, then date
            try {
                var dateField = inspection.fillDate || inspection.date;
                if (dateField) {
                    dateObj = new Date(dateField);
                    if (isNaN(dateObj.getTime())) {
                        dateObj = new Date();
                    }
                } else {
                    dateObj = new Date();
                }
            } catch (error) {
                dateObj = new Date();
            }
            
            // Get user name from userName array at point level
            var userName = $scope.point.userName && $scope.point.userName[index];
            
            // Extract land use classes and pixel border info from form
            var landUseClasses = [];
            var pixelBorderInfo = [];
            if (inspection.form && Array.isArray(inspection.form)) {
                inspection.form.forEach(function(form) {
                    if (form.landUse) {
                        landUseClasses.push(form.landUse + ' (' + form.initialYear + '-' + form.finalYear + ')');
                        pixelBorderInfo.push({
                            landUse: form.landUse,
                            years: form.initialYear + '-' + form.finalYear,
                            value: form.pixelBorder || false
                        });
                    }
                });
            }
            
            return {
                user: userName || 'Usuário ' + (index + 1),
                date: dateObj,
                time: inspection.counter || null,
                landUseClasses: landUseClasses,
                pixelBorderInfo: pixelBorderInfo
            };
        });
    } else if ($scope.point.userName) {
        // Fallback to basic data with userName array only
        $scope.inspectionDetails = $scope.point.userName.map(function(user, index) {
            return {
                user: user,
                date: new Date(Date.now() - (index * 24 * 60 * 60 * 1000)),
                time: Math.floor(Math.random() * 300) + 60,
                landUseClasses: []
            };
        });
    } else {
        $scope.inspectionDetails = [];
    }
    
    // Keep the functions for backward compatibility but return pre-calculated values
    $scope.getInspectionCount = function() {
        return $scope.inspectionCount;
    };
    
    $scope.getUniqueInspectors = function() {
        return $scope.uniqueInspectors;
    };
    
    $scope.getCompletionPercentage = function() {
        return $scope.completionPercentage;
    };
    
    $scope.getInspectionDetails = function() {
        return $scope.inspectionDetails;
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
        NotificationDialog.info('Funcionalidade de edição individual será implementada em breve');
    };
    
    $scope.removeInspection = function(inspection, index) {
        NotificationDialog.confirm(`Tem certeza que deseja remover a inspeção de ${inspection.user}?`, 'Confirmar Remoção').then(function(confirmed) {
            if (confirmed) {
                // Implementar remoção individual
                NotificationDialog.info('Remoção individual será implementada em breve');
            }
        });
    };
    
    $scope.viewInTemporal = function() {
        // Abrir o admin-temporal em nova aba com o ponto selecionado
        var url = window.location.origin + '/#/admin/temporal?pointId=' + $scope.point._id;
        window.open(url, '_blank');
        $scope.close();
    };
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
});

// Controller para o modal de edição de inspeções
Application.controller('PointInspectionsEditModalController', function ($scope, $uibModalInstance, $http, point, campaign, NotificationDialog) {
    $scope.point = point;
    $scope.campaign = campaign;
    $scope.inspections = [];
    $scope.originalInspections = [];
    $scope.validationErrors = [];
    
    // Inicializar inspeções baseado nos dados do ponto
    $scope.initializeInspections = function() {
        $scope.inspections = [];
        
        // Se o ponto tem dados de inspeção estruturados (formato atual do backend)
        if ($scope.point.inspection && $scope.point.inspection.length > 0) {
            $scope.inspections = $scope.point.inspection.map(function(inspection, index) {
                var dateObj = new Date();
                var dateInput = '';
                
                // Handle date conversion safely - try fillDate first, then date
                try {
                    var dateField = inspection.fillDate || inspection.date;
                    if (dateField) {
                        dateObj = new Date(dateField);
                        if (!isNaN(dateObj.getTime())) {
                            dateInput = dateObj.toISOString().slice(0, 16);
                        } else {
                            dateObj = new Date();
                            dateInput = dateObj.toISOString().slice(0, 16);
                        }
                    } else {
                        dateInput = dateObj.toISOString().slice(0, 16);
                    }
                } catch (e) {
                    dateObj = new Date();
                    dateInput = dateObj.toISOString().slice(0, 16);
                }
                
                // Get user name from userName array at point level
                var userName = '';
                if ($scope.point.userName && $scope.point.userName[index]) {
                    userName = $scope.point.userName[index];
                }
                
                return {
                    user: userName,
                    date: dateObj,
                    dateInput: dateInput,
                    time: inspection.counter || null, // counter is the time spent
                    form: inspection.form && inspection.form.length > 0 ? inspection.form : [{
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
        // Fallback for structured inspections format
        else if ($scope.point.inspections && $scope.point.inspections.length > 0) {
            $scope.inspections = $scope.point.inspections.map(function(inspection) {
                var dateObj = new Date();
                var dateInput = '';
                
                // Handle date conversion safely
                try {
                    if (inspection.date) {
                        dateObj = new Date(inspection.date);
                        if (!isNaN(dateObj.getTime())) {
                            dateInput = dateObj.toISOString().slice(0, 16);
                        } else {
                            dateObj = new Date();
                            dateInput = dateObj.toISOString().slice(0, 16);
                        }
                    } else {
                        dateInput = dateObj.toISOString().slice(0, 16);
                    }
                } catch (e) {
                    dateObj = new Date();
                    dateInput = dateObj.toISOString().slice(0, 16);
                }
                
                return {
                    user: inspection.user || inspection.userName || '',
                    date: dateObj,
                    dateInput: dateInput,
                    time: inspection.time || null,
                    form: inspection.form && inspection.form.length > 0 ? inspection.form : [{
                        initialYear: $scope.campaign.initialYear || 2020,
                        finalYear: $scope.campaign.finalYear || 2024,
                        landUse: inspection.landUse || '',
                        pixelBorder: inspection.pixelBorder || false
                    }],
                    editing: false,
                    isNew: false
                };
            });
        }
        // Se o ponto só tem array de userName (formato antigo)
        else if ($scope.point.userName && $scope.point.userName.length > 0) {
            // Para cada usuário criar uma inspeção com dados básicos
            $scope.inspections = $scope.point.userName.map(function(user, index) {
                // Tentar extrair dados adicionais se disponíveis
                var inspectionDate = $scope.point.inspectionDates && $scope.point.inspectionDates[index] ? 
                    new Date($scope.point.inspectionDates[index]) : new Date();
                var inspectionTime = $scope.point.inspectionTimes && $scope.point.inspectionTimes[index] ? 
                    $scope.point.inspectionTimes[index] : null;
                var landUseClass = $scope.point.landUseClasses && $scope.point.landUseClasses[index] ? 
                    $scope.point.landUseClasses[index] : '';
                
                var dateInput = '';
                try {
                    if (inspectionDate && !isNaN(inspectionDate.getTime())) {
                        dateInput = inspectionDate.toISOString().slice(0, 16);
                    } else {
                        inspectionDate = new Date();
                        dateInput = inspectionDate.toISOString().slice(0, 16);
                    }
                } catch (e) {
                    inspectionDate = new Date();
                    dateInput = inspectionDate.toISOString().slice(0, 16);
                }
                
                return {
                    user: user,
                    date: inspectionDate,
                    dateInput: dateInput,
                    time: inspectionTime,
                    form: [{
                        initialYear: $scope.campaign.initialYear || 2020,
                        finalYear: $scope.campaign.finalYear || 2024,
                        landUse: landUseClass,
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
        
        // Handle date conversion safely
        try {
            if (inspection.date) {
                var dateObj = new Date(inspection.date);
                if (!isNaN(dateObj.getTime())) {
                    inspection.dateInput = dateObj.toISOString().slice(0, 16);
                } else {
                    inspection.dateInput = new Date().toISOString().slice(0, 16);
                }
            } else {
                inspection.dateInput = new Date().toISOString().slice(0, 16);
            }
        } catch (e) {
            inspection.dateInput = new Date().toISOString().slice(0, 16);
        }
    };
    
    $scope.saveInspection = function(inspection, index) {
        // Validar inspeção
        if (!inspection.user || inspection.user.trim() === '') {
            NotificationDialog.warning('Nome do usuário é obrigatório');
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
            NotificationDialog.warning('Pelo menos uma classe de uso da terra deve ser especificada');
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
        NotificationDialog.confirm('Tem certeza que deseja remover esta inspeção?', 'Confirmar Remoção').then(function(confirmed) {
            if (confirmed) {
                $scope.inspections.splice(index, 1);
            }
        });
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
        NotificationDialog.confirm('Tem certeza que deseja descartar todas as alterações?', 'Confirmar Descarte').then(function(confirmed) {
            if (confirmed) {
                $scope.inspections = angular.copy($scope.originalInspections);
                $scope.validationErrors = [];
            }
        });
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
                NotificationDialog.success(`${$scope.inspections.length} inspeções salvas com sucesso!`);
                $uibModalInstance.close('saved');
            });
        }, 500);
    };
    
    $scope.close = function() {
        if ($scope.hasChanges()) {
            NotificationDialog.confirm('Você tem alterações não salvas. Tem certeza que deseja fechar?', 'Confirmar Fechamento').then(function(confirmed) {
                if (confirmed) {
                    $uibModalInstance.dismiss('cancel');
                }
            });
        } else {
            $uibModalInstance.dismiss('cancel');
        }
    };
    
    // Inicializar
    $scope.initializeInspections();
});

// Controller do modal de formulário
Application.controller('CampaignFormModalController', function ($scope, $uibModalInstance, campaign, isNew, NotificationDialog) {
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
            NotificationDialog.error('ID da campanha é obrigatório');
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