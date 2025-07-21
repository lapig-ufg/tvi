// Modal Controller para Criar/Editar Parâmetro
Application.controller('AdminVisParamModalController', function ($scope, $uibModalInstance, param, categories, requester, NotificationDialog) {
    $scope.isEdit = !!param;
    $scope.title = $scope.isEdit ? 'Editar Parâmetro de Visualização' : 'Novo Parâmetro de Visualização';
    $scope.categories = categories;
    $scope.loading = false;
    
    // Inicializar dados
    $scope.param = param || {
        name: '',
        display_name: '',
        description: '',
        category: 'landsat',
        active: true,
        tags: [],
        vis_params: {
            bands: [],
            min: [],
            max: [],
            gamma: 1.0
        },
        band_config: {
            original_bands: [],
            mapped_bands: []
        }
    };

    // Tag input
    $scope.newTag = '';
    $scope.addTag = function() {
        if ($scope.newTag && !$scope.param.tags.includes($scope.newTag)) {
            $scope.param.tags.push($scope.newTag);
            $scope.newTag = '';
        }
    };
    $scope.removeTag = function(index) {
        $scope.param.tags.splice(index, 1);
    };

    // Bands management
    $scope.bandInput = '';
    $scope.addBand = function() {
        if ($scope.bandInput) {
            const bands = $scope.bandInput.split(',').map(b => b.trim()).filter(b => b);
            bands.forEach(band => {
                if (!$scope.param.vis_params.bands.includes(band)) {
                    $scope.param.vis_params.bands.push(band);
                }
            });
            $scope.bandInput = '';
            $scope.updateMinMaxArrays();
        }
    };
    $scope.removeBand = function(index) {
        $scope.param.vis_params.bands.splice(index, 1);
        $scope.updateMinMaxArrays();
    };

    // Update min/max arrays when bands change
    $scope.updateMinMaxArrays = function() {
        const bandCount = $scope.param.vis_params.bands.length;
        
        // Ajustar arrays min/max
        if (Array.isArray($scope.param.vis_params.min)) {
            while ($scope.param.vis_params.min.length < bandCount) {
                $scope.param.vis_params.min.push(0);
            }
            $scope.param.vis_params.min = $scope.param.vis_params.min.slice(0, bandCount);
        }
        
        if (Array.isArray($scope.param.vis_params.max)) {
            while ($scope.param.vis_params.max.length < bandCount) {
                $scope.param.vis_params.max.push(3000);
            }
            $scope.param.vis_params.max = $scope.param.vis_params.max.slice(0, bandCount);
        }
    };

    // Alternar entre valor único e array para min/max/gamma
    $scope.toggleArrayMode = function(field) {
        if (Array.isArray($scope.param.vis_params[field])) {
            // Converter para valor único (usar o primeiro valor)
            $scope.param.vis_params[field] = $scope.param.vis_params[field][0] || 0;
        } else {
            // Converter para array
            const value = $scope.param.vis_params[field];
            $scope.param.vis_params[field] = [];
            for (let i = 0; i < $scope.param.vis_params.bands.length; i++) {
                $scope.param.vis_params[field].push(value);
            }
        }
    };

    // Salvar
    $scope.save = function() {
        if ($scope.paramForm.$invalid) {
            NotificationDialog.show('Por favor, preencha todos os campos obrigatórios', 'warning');
            return;
        }

        $scope.loading = true;
        
        const endpoint = $scope.isEdit ? 
            '../api/vis-params/' + encodeURIComponent($scope.param.name) : 
            '../api/vis-params';
        
        const method = $scope.isEdit ? requester._put : requester._post;
        
        method(endpoint, $scope.param, function(response) {
            $scope.loading = false;
            $uibModalInstance.close(response);
        }, function(error) {
            $scope.loading = false;
            NotificationDialog.show('Erro ao salvar parâmetro: ' + (error.message || 'Erro desconhecido'), 'error');
        });
    };

    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

// Modal Controller para Visualizar Detalhes
Application.controller('AdminVisParamDetailsController', function ($scope, $uibModalInstance, param) {
    $scope.param = param;
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
});

// Modal Controller para Clonar Parâmetro
Application.controller('AdminVisParamCloneController', function ($scope, $uibModalInstance, originalParam) {
    $scope.originalParam = originalParam;
    $scope.newName = originalParam.name + '_copy';
    
    $scope.clone = function() {
        if (!$scope.newName || $scope.newName === originalParam.name) {
            return;
        }
        $uibModalInstance.close($scope.newName);
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

// Modal Controller para Testar Parâmetro
Application.controller('AdminVisParamTestController', function ($scope, $uibModalInstance, param, requester, NotificationDialog) {
    $scope.param = param;
    $scope.test = {
        x: 123,
        y: 456,
        z: 10,
        layer_type: param.category === 'sentinel2' ? 'sentinel2' : 'landsat'
    };
    $scope.loading = false;
    $scope.result = null;
    
    $scope.runTest = function() {
        $scope.loading = true;
        $scope.result = null;
        
        const testData = {
            vis_params: param.vis_params,
            x: parseInt($scope.test.x),
            y: parseInt($scope.test.y),
            z: parseInt($scope.test.z),
            layer_type: $scope.test.layer_type
        };
        
        requester._post('../api/vis-params/test', testData, function(response) {
            $scope.loading = false;
            $scope.result = response;
        }, function(error) {
            $scope.loading = false;
            NotificationDialog.show('Erro ao testar parâmetro', 'error');
        });
    };
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
});

// Modal Controller para Importar Parâmetros
Application.controller('AdminVisParamImportController', function ($scope, $uibModalInstance, requester, NotificationDialog) {
    $scope.importData = {
        file: null,
        content: null,
        overwrite: false
    };
    $scope.loading = false;
    
    // File reader
    $scope.onFileSelect = function(files) {
        if (files && files.length > 0) {
            const file = files[0];
            const reader = new FileReader();
            
            reader.onload = function(e) {
                try {
                    $scope.importData.content = JSON.parse(e.target.result);
                    $scope.$apply();
                } catch (error) {
                    NotificationDialog.show('Arquivo JSON inválido', 'error');
                }
            };
            
            reader.readAsText(file);
        }
    };
    
    $scope.import = function() {
        if (!$scope.importData.content) {
            NotificationDialog.show('Selecione um arquivo para importar', 'warning');
            return;
        }
        
        $scope.loading = true;
        
        requester._post('../api/vis-params/import?overwrite=' + $scope.importData.overwrite, 
            $scope.importData.content, 
            function(response) {
                $scope.loading = false;
                $uibModalInstance.close({
                    message: 'Importação concluída com sucesso'
                });
            }, 
            function(error) {
                $scope.loading = false;
                NotificationDialog.show('Erro ao importar parâmetros', 'error');
            }
        );
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

// Modal Controller para Editar Landsat Collections
Application.controller('AdminLandsatCollectionsController', function ($scope, $uibModalInstance, collections, requester, NotificationDialog) {
    $scope.collections = collections || [];
    $scope.loading = false;
    
    $scope.addCollection = function() {
        $scope.collections.push({
            start_year: 2020,
            end_year: 2025,
            collection: '',
            satellite: ''
        });
    };
    
    $scope.removeCollection = function(index) {
        $scope.collections.splice(index, 1);
    };
    
    $scope.save = function() {
        $scope.loading = true;
        
        requester._put('../api/vis-params/landsat-collections', $scope.collections, function(response) {
            $scope.loading = false;
            $uibModalInstance.close();
        }, function(error) {
            $scope.loading = false;
            NotificationDialog.show('Erro ao salvar collections', 'error');
        });
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

// Modal Controller para Editar Sentinel Collections
Application.controller('AdminSentinelCollectionsController', function ($scope, $uibModalInstance, collections, requester, NotificationDialog) {
    $scope.data = collections || {
        collections: [],
        default_collection: '',
        cloud_filter_params: {
            max_cloud_coverage: 20,
            use_cloud_score: true,
            cloud_score_threshold: 0.5
        }
    };
    $scope.loading = false;
    
    $scope.save = function() {
        $scope.loading = true;
        
        requester._put('../api/vis-params/sentinel-collections', $scope.data, function(response) {
            $scope.loading = false;
            $uibModalInstance.close();
        }, function(error) {
            $scope.loading = false;
            NotificationDialog.show('Erro ao salvar collections', 'error');
        });
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});

// Modal Controller para Visualizar Bandas
Application.controller('AdminCollectionBandsController', function ($scope, $uibModalInstance, collectionName, bands) {
    $scope.collectionName = collectionName;
    $scope.bands = bands;
    
    $scope.close = function() {
        $uibModalInstance.dismiss('close');
    };
});

// Modal Controller para Confirmação
Application.controller('ConfirmDialogController', function ($scope, $uibModalInstance, title, message) {
    $scope.title = title;
    $scope.message = message;
    
    $scope.confirm = function() {
        $uibModalInstance.close(true);
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
});