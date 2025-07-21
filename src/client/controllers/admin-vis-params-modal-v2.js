// Modal Controller V2 para Criar/Editar Parâmetro
Application.controller('AdminVisParamModalV2Controller', function ($scope, $uibModalInstance, param, categories, requester, NotificationDialog, $timeout) {
    $scope.isEdit = !!param;
    $scope.title = $scope.isEdit ? 'Editar Parâmetro de Visualização' : 'Novo Parâmetro de Visualização';
    $scope.categories = categories;
    $scope.loading = false;
    
    // Estados do wizard
    $scope.currentStep = 1;
    
    // Configurações
    $scope.configType = 'unified'; // unified ou per-satellite
    $scope.valueMode = 'per-band'; // unified ou per-band
    $scope.selectedSatellite = null;
    
    // Valores unificados
    $scope.unifiedValues = {
        min: 0,
        max: 1,
        gamma: 1.0
    };
    
    // Dados dos satélites Landsat
    $scope.landsatSatellites = [
        { id: 'LT05', name: 'Landsat 5', collection: 'LANDSAT/LT05/C02/T1_L2' },
        { id: 'LE07', name: 'Landsat 7', collection: 'LANDSAT/LE07/C02/T1_L2' },
        { id: 'LC08', name: 'Landsat 8', collection: 'LANDSAT/LC08/C02/T1_L2' },
        { id: 'LC09', name: 'Landsat 9', collection: 'LANDSAT/LC09/C02/T1_L2' }
    ];
    
    // Bandas disponíveis
    $scope.landsatBands = {
        'LT05': [
            { name: 'SR_B1', description: 'Blue' },
            { name: 'SR_B2', description: 'Green' },
            { name: 'SR_B3', description: 'Red' },
            { name: 'SR_B4', description: 'NIR' },
            { name: 'SR_B5', description: 'SWIR 1' },
            { name: 'SR_B7', description: 'SWIR 2' }
        ],
        'LE07': [
            { name: 'SR_B1', description: 'Blue' },
            { name: 'SR_B2', description: 'Green' },
            { name: 'SR_B3', description: 'Red' },
            { name: 'SR_B4', description: 'NIR' },
            { name: 'SR_B5', description: 'SWIR 1' },
            { name: 'SR_B7', description: 'SWIR 2' }
        ],
        'LC08': [
            { name: 'SR_B2', description: 'Blue' },
            { name: 'SR_B3', description: 'Green' },
            { name: 'SR_B4', description: 'Red' },
            { name: 'SR_B5', description: 'NIR' },
            { name: 'SR_B6', description: 'SWIR 1' },
            { name: 'SR_B7', description: 'SWIR 2' }
        ],
        'LC09': [
            { name: 'SR_B2', description: 'Blue' },
            { name: 'SR_B3', description: 'Green' },
            { name: 'SR_B4', description: 'Red' },
            { name: 'SR_B5', description: 'NIR' },
            { name: 'SR_B6', description: 'SWIR 1' },
            { name: 'SR_B7', description: 'SWIR 2' }
        ]
    };
    
    $scope.sentinelBands = [
        { name: 'B1', description: 'Aerosols' },
        { name: 'B2', description: 'Blue' },
        { name: 'B3', description: 'Green' },
        { name: 'B4', description: 'Red' },
        { name: 'B5', description: 'Red Edge 1' },
        { name: 'B6', description: 'Red Edge 2' },
        { name: 'B7', description: 'Red Edge 3' },
        { name: 'B8', description: 'NIR' },
        { name: 'B8A', description: 'Red Edge 4' },
        { name: 'B11', description: 'SWIR 1' },
        { name: 'B12', description: 'SWIR 2' }
    ];
    
    // Inicializar dados
    if ($scope.isEdit && param) {
        $scope.param = angular.copy(param);
        
        // Garantir que vis_params existe
        if (!$scope.param.vis_params) {
            $scope.param.vis_params = {
                bands: [],
                min: [],
                max: [],
                gamma: []
            };
        }
        
        // Detectar tipo de configuração
        if ($scope.param.satellite_configs && $scope.param.satellite_configs.length > 0) {
            $scope.configType = 'per-satellite';
        } else {
            $scope.configType = 'unified';
        }
        
        // Detectar modo de valores
        if ($scope.param.vis_params && Array.isArray($scope.param.vis_params.min)) {
            $scope.valueMode = 'per-band';
        } else if ($scope.param.vis_params) {
            $scope.valueMode = 'unified';
            $scope.unifiedValues = {
                min: $scope.param.vis_params.min || 0,
                max: $scope.param.vis_params.max || 1,
                gamma: $scope.param.vis_params.gamma || 1.0
            };
        }
    } else {
        $scope.param = {
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
                gamma: []
            },
            band_config: null,
            satellite_configs: []
        };
    }
    
    // Tags sugeridas
    $scope.suggestedTags = [];
    
    // Cache para bandas disponíveis
    $scope.availableBands = [];
    
    // Atualizar bandas disponíveis quando necessário
    function updateAvailableBands() {
        if ($scope.param.category === 'sentinel') {
            $scope.availableBands = angular.copy($scope.sentinelBands);
        } else if ($scope.configType === 'unified') {
            // Para config unificada, mostrar bandas comuns
            $scope.availableBands = [
                { name: 'RED', description: 'Red Band' },
                { name: 'GREEN', description: 'Green Band' },
                { name: 'BLUE', description: 'Blue Band' },
                { name: 'NIR', description: 'Near Infrared' },
                { name: 'SWIR1', description: 'Shortwave Infrared 1' },
                { name: 'SWIR2', description: 'Shortwave Infrared 2' }
            ];
        } else if ($scope.selectedSatellite) {
            $scope.availableBands = angular.copy($scope.landsatBands[$scope.selectedSatellite] || []);
        } else {
            $scope.availableBands = [];
        }
    }
    
    // Watchers
    $scope.$watch('param.category', function(newVal) {
        if (newVal === 'landsat') {
            $scope.suggestedTags = ['landsat', 'multispectral', 'vegetation', 'agriculture'];
        } else if (newVal === 'sentinel') {
            $scope.suggestedTags = ['sentinel2', 'multispectral', 'high-resolution', 'vegetation'];
        }
        updateAvailableBands();
    });
    
    $scope.$watch('configType', function() {
        updateAvailableBands();
    });
    
    $scope.$watch('selectedSatellite', function() {
        updateAvailableBands();
    });
    
    // Tag management
    $scope.newTag = '';
    $scope.addTag = function(event) {
        if (event) {
            event.preventDefault();
        }
        if ($scope.newTag && !$scope.param.tags.includes($scope.newTag)) {
            $scope.param.tags.push($scope.newTag.toLowerCase());
            $scope.newTag = '';
        }
    };
    
    $scope.removeTag = function(index) {
        $scope.param.tags.splice(index, 1);
    };
    
    $scope.addSuggestedTag = function(tag) {
        if (!$scope.param.tags.includes(tag)) {
            $scope.param.tags.push(tag);
        }
    };
    
    // Band management
    
    $scope.isBandSelected = function(band) {
        if (!$scope.param || !$scope.param.vis_params || !$scope.param.vis_params.bands) {
            return false;
        }
        return $scope.param.vis_params.bands.includes(band.name);
    };
    
    $scope.toggleBand = function(band) {
        if (!$scope.param || !$scope.param.vis_params) {
            return;
        }
        
        if (!$scope.param.vis_params.bands) {
            $scope.param.vis_params.bands = [];
        }
        
        const index = $scope.param.vis_params.bands.indexOf(band.name);
        if (index > -1) {
            $scope.removeBand(index);
        } else {
            if ($scope.param.vis_params.bands.length < 3) {
                $scope.param.vis_params.bands.push(band.name);
                $scope.updateMinMaxArrays();
            } else {
                NotificationDialog.show('Você pode selecionar no máximo 3 bandas', 'warning');
            }
        }
    };
    
    $scope.removeBand = function(index) {
        $scope.param.vis_params.bands.splice(index, 1);
        $scope.updateMinMaxArrays();
    };
    
    // Drag and drop para reordenar bandas
    $scope.draggedIndex = null;
    
    $scope.onDragStart = function(event, index) {
        $scope.draggedIndex = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', event.target.innerHTML);
    };
    
    $scope.onDragOver = function(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };
    
    $scope.onDrop = function(event, dropIndex) {
        event.preventDefault();
        if ($scope.draggedIndex !== null && $scope.draggedIndex !== dropIndex) {
            const draggedBand = $scope.param.vis_params.bands[$scope.draggedIndex];
            $scope.param.vis_params.bands.splice($scope.draggedIndex, 1);
            $scope.param.vis_params.bands.splice(dropIndex, 0, draggedBand);
            
            // Reordenar também os arrays min/max/gamma se estiverem em modo per-band
            if ($scope.valueMode === 'per-band') {
                ['min', 'max', 'gamma'].forEach(field => {
                    if (Array.isArray($scope.param.vis_params[field])) {
                        const draggedValue = $scope.param.vis_params[field][$scope.draggedIndex];
                        $scope.param.vis_params[field].splice($scope.draggedIndex, 1);
                        $scope.param.vis_params[field].splice(dropIndex, 0, draggedValue);
                    }
                });
            }
            
            $scope.$apply();
        }
        $scope.draggedIndex = null;
    };
    
    // Update min/max arrays
    $scope.updateMinMaxArrays = function() {
        if (!$scope.param || !$scope.param.vis_params || !$scope.param.vis_params.bands) {
            return;
        }
        
        const bandCount = $scope.param.vis_params.bands.length;
        
        if ($scope.valueMode === 'per-band') {
            ['min', 'max', 'gamma'].forEach(field => {
                if (!Array.isArray($scope.param.vis_params[field])) {
                    $scope.param.vis_params[field] = [];
                }
                
                while ($scope.param.vis_params[field].length < bandCount) {
                    const defaultValue = field === 'gamma' ? 1.0 : (field === 'min' ? 0 : 1);
                    $scope.param.vis_params[field].push(defaultValue);
                }
                
                $scope.param.vis_params[field] = $scope.param.vis_params[field].slice(0, bandCount);
            });
        }
    };
    
    // Value mode management
    $scope.setValueMode = function(mode) {
        $scope.valueMode = mode;
        
        if (mode === 'unified') {
            // Converter arrays para valores únicos
            ['min', 'max', 'gamma'].forEach(field => {
                if (Array.isArray($scope.param.vis_params[field]) && $scope.param.vis_params[field].length > 0) {
                    $scope.unifiedValues[field] = $scope.param.vis_params[field][0];
                }
            });
        } else {
            // Converter valores únicos para arrays
            $scope.updateMinMaxArrays();
            if ($scope.unifiedValues.min !== undefined) {
                for (let i = 0; i < $scope.param.vis_params.bands.length; i++) {
                    $scope.param.vis_params.min[i] = $scope.unifiedValues.min;
                    $scope.param.vis_params.max[i] = $scope.unifiedValues.max;
                    $scope.param.vis_params.gamma[i] = $scope.unifiedValues.gamma;
                }
            }
        }
    };
    
    // Preset application
    $scope.applyPreset = function(field, value) {
        $scope.unifiedValues[field] = value;
    };
    
    $scope.applyCommonPreset = function(preset) {
        switch (preset) {
            case 'natural-color':
                if ($scope.param.category === 'landsat') {
                    $scope.param.vis_params.bands = ['RED', 'GREEN', 'BLUE'];
                } else {
                    $scope.param.vis_params.bands = ['B4', 'B3', 'B2'];
                }
                $scope.unifiedValues = { min: 0, max: 0.3, gamma: 1.2 };
                break;
            case 'false-color':
                if ($scope.param.category === 'landsat') {
                    $scope.param.vis_params.bands = ['NIR', 'RED', 'GREEN'];
                } else {
                    $scope.param.vis_params.bands = ['B8', 'B4', 'B3'];
                }
                $scope.unifiedValues = { min: 0, max: 0.4, gamma: 1.0 };
                break;
            case 'agriculture':
                if ($scope.param.category === 'landsat') {
                    $scope.param.vis_params.bands = ['SWIR1', 'NIR', 'RED'];
                } else {
                    $scope.param.vis_params.bands = ['B11', 'B8', 'B4'];
                }
                $scope.unifiedValues = { min: 0, max: 0.5, gamma: 1.1 };
                break;
            case 'vegetation':
                if ($scope.param.category === 'landsat') {
                    $scope.param.vis_params.bands = ['NIR', 'SWIR1', 'RED'];
                } else {
                    $scope.param.vis_params.bands = ['B8', 'B11', 'B4'];
                }
                $scope.unifiedValues = { min: 0, max: 0.45, gamma: 1.0 };
                break;
        }
        $scope.updateMinMaxArrays();
    };
    
    // Category change
    $scope.onCategoryChange = function() {
        // Reset bands when category changes
        $scope.param.vis_params.bands = [];
        $scope.updateMinMaxArrays();
        updateAvailableBands();
    };
    
    // Satellite selection
    $scope.selectSatellite = function(satelliteId) {
        $scope.selectedSatellite = satelliteId;
    };
    
    $scope.getSatelliteCollection = function(satelliteId) {
        const sat = $scope.landsatSatellites.find(s => s.id === satelliteId);
        return sat ? sat.collection : '';
    };
    
    // Navigation
    $scope.canProceed = function() {
        switch ($scope.currentStep) {
            case 1:
                return $scope.param.name && $scope.param.display_name && $scope.param.category;
            case 2:
                return $scope.param.vis_params.bands.length === 3;
            case 3:
                return true;
            default:
                return false;
        }
    };
    
    $scope.nextStep = function() {
        if ($scope.currentStep < 3 && $scope.canProceed()) {
            $scope.currentStep++;
        }
    };
    
    $scope.previousStep = function() {
        if ($scope.currentStep > 1) {
            $scope.currentStep--;
        }
    };
    
    // Save
    $scope.save = function() {
        if (!$scope.canProceed()) {
            NotificationDialog.show('Por favor, complete todos os campos obrigatórios', 'warning');
            return;
        }
        
        $scope.loading = true;
        
        // Preparar dados para salvar
        const dataToSave = angular.copy($scope.param);
        
        // Aplicar valores unificados se necessário
        if ($scope.valueMode === 'unified') {
            dataToSave.vis_params.min = $scope.unifiedValues.min;
            dataToSave.vis_params.max = $scope.unifiedValues.max;
            dataToSave.vis_params.gamma = $scope.unifiedValues.gamma;
        }
        
        // Se for configuração por satélite, criar satellite_configs
        if ($scope.configType === 'per-satellite' && $scope.param.category === 'landsat') {
            dataToSave.satellite_configs = $scope.landsatSatellites.map(sat => {
                // Mapear bandas genéricas para bandas específicas do satélite
                const bandMapping = {
                    'LT05': { 'RED': 'SR_B3', 'GREEN': 'SR_B2', 'BLUE': 'SR_B1', 'NIR': 'SR_B4', 'SWIR1': 'SR_B5', 'SWIR2': 'SR_B7' },
                    'LE07': { 'RED': 'SR_B3', 'GREEN': 'SR_B2', 'BLUE': 'SR_B1', 'NIR': 'SR_B4', 'SWIR1': 'SR_B5', 'SWIR2': 'SR_B7' },
                    'LC08': { 'RED': 'SR_B4', 'GREEN': 'SR_B3', 'BLUE': 'SR_B2', 'NIR': 'SR_B5', 'SWIR1': 'SR_B6', 'SWIR2': 'SR_B7' },
                    'LC09': { 'RED': 'SR_B4', 'GREEN': 'SR_B3', 'BLUE': 'SR_B2', 'NIR': 'SR_B5', 'SWIR1': 'SR_B6', 'SWIR2': 'SR_B7' }
                };
                
                const mappedBands = dataToSave.vis_params.bands.map(band => 
                    bandMapping[sat.id][band] || band
                );
                
                return {
                    collection_id: sat.collection,
                    vis_params: {
                        bands: mappedBands,
                        min: dataToSave.vis_params.min,
                        max: dataToSave.vis_params.max,
                        gamma: dataToSave.vis_params.gamma
                    }
                };
            });
            
            // Limpar vis_params principal
            dataToSave.vis_params = null;
        }
        
        const endpoint = $scope.isEdit ? 
            '../api/vis-params/' + encodeURIComponent($scope.param.name) : 
            '../api/vis-params';
        
        const method = $scope.isEdit ? requester._put : requester._post;
        
        method(endpoint, dataToSave, function(response) {
            $scope.loading = false;
            NotificationDialog.show(
                $scope.isEdit ? 'Parâmetro atualizado com sucesso!' : 'Parâmetro criado com sucesso!', 
                'success'
            );
            $uibModalInstance.close(response);
        }, function(error) {
            $scope.loading = false;
            NotificationDialog.show('Erro ao salvar parâmetro: ' + (error.message || 'Erro desconhecido'), 'error');
        });
    };
    
    $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel');
    };
    
    // Inicializar
    updateAvailableBands();
});