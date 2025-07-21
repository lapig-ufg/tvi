'use strict';

Application.controller('MosaicDialogController', function ($scope, $uibModalInstance, mosaics, map, point, config, tilesCapabilities, period, $injector, $timeout) {
    // Inicialização básica
    $scope.tilesCapabilities = tilesCapabilities || [];
    $scope.mosaics = mosaics;
    $scope.map = map;
    $scope.point = point;
    $scope.config = config;
    $scope.year = map.year || new Date(map.date).getFullYear();
    $scope.period = period;
    
    // Timers para debounce
    var updateTimers = {
        month: null,
        visparam: null
    };
    
    // Implementação customizada de swipe
    
    // Estados e configurações
    $scope.showMonthlyView = false;
    $scope.selectedMonth = new Date().getMonth() + 1;
    
    // Obter AppConfig se disponível
    var tilesUrl = '/api/tiles/xyz/';
    if ($injector.has('AppConfig')) {
        var AppConfig = $injector.get('AppConfig');
        if (AppConfig.tilesApiUrl) {
            tilesUrl = AppConfig.tilesApiUrl + '/xyz/';
        }
    }
    
    // Processar capabilities do Sentinel
    $scope.getVisParams = function() {
        if (!Array.isArray($scope.tilesCapabilities) || !$scope.tilesCapabilities.length) return [];
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'sentinel');
        if (!collection || !collection.visparam) return [];
        return collection.visparam || [];
    };
    $scope.sentinelVisparams = $scope.getVisParams();
    $scope.selectedSentinelVisparam = $scope.sentinelVisparams.length > 0 ? $scope.sentinelVisparams[0] : null;
    
    // Processar capabilities do Landsat
    $scope.getLandsatVisParams = function() {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return [];
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'landsat');
        if (!collection || !collection.visparam) return [];
        return collection.visparam;
    };
    $scope.landsatVisparams = $scope.getLandsatVisParams();
    $scope.selectedLandsatVisparam = $scope.landsatVisparams.length > 0 ? $scope.landsatVisparams[0] : null;
    
    // Obter detalhes dos visparam
    $scope.getVisParamDetails = function() {
        if (!Array.isArray($scope.tilesCapabilities) || !$scope.tilesCapabilities.length) return [];
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'sentinel');
        if (!collection || !collection.visparam_details) return [];
        return collection.visparam_details || [];
    };
    $scope.sentinelVisparamDetails = $scope.getVisParamDetails();
    
    $scope.getLandsatVisParamDetails = function() {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return [];
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'landsat');
        if (!collection || !collection.visparam_details) return [];
        return collection.visparam_details;
    };
    $scope.landsatVisparamDetails = $scope.getLandsatVisParamDetails();
    
    // Funções auxiliares
    $scope.hasSentinelImageForYear = function(year) {
        if (!Array.isArray($scope.tilesCapabilities) || !$scope.tilesCapabilities.length) {
            return false;
        }
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'sentinel');
        if (!collection || !Array.isArray(collection.year)) {
            return false;
        }
        const yearNum = parseInt(year);
        return collection.year.includes(yearNum);
    };

    $scope.hasLandsatImageForYear = function(year) {
        if (!Array.isArray($scope.tilesCapabilities) || !$scope.tilesCapabilities.length) {
            return false;
        }
        const collection = $scope.tilesCapabilities.find(col => col.satellite === 'landsat');
        if (!collection || !Array.isArray(collection.year)) {
            return false;
        }
        const yearNum = parseInt(year);
        return collection.year.includes(yearNum);
    };
    
    $scope.getMonthName = function(monthNumber) {
        var months = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return months[monthNumber - 1] || '';
    };
    
    $scope.getVisparamDisplayName = function(visparamName, satellite) {
        var details = satellite === 'landsat' ? $scope.landsatVisparamDetails : $scope.sentinelVisparamDetails;
        var detail = details.find(function(vp) {
            return vp.name === visparamName;
        });
        return detail ? detail.display_name : visparamName;
    };
    
    
    // Atualizar configurações dos mapas com debounce
    $scope.updateMapLayers = function(updateOnlyRight, isMonthChange) {
        // Se for mudança de mês, aplicar debounce
        if (isMonthChange) {
            // Cancelar timer anterior se existir
            if (updateTimers.month) {
                $timeout.cancel(updateTimers.month);
            }
            
            // Criar novo timer com delay
            updateTimers.month = $timeout(function() {
                doUpdateMapLayers(updateOnlyRight);
                updateTimers.month = null;
            }, 300); // 300ms de delay
            
            return;
        }
        
        // Para outras mudanças, atualizar imediatamente
        doUpdateMapLayers(updateOnlyRight);
    };
    
    function doUpdateMapLayers(updateOnlyRight) {
        // Configuração da camada esquerda (Landsat) - só atualizar se não for updateOnlyRight
        if (!updateOnlyRight) {
            if ($scope.hasLandsatImageForYear($scope.year) && $scope.selectedLandsatVisparam) {
                $scope.leftMapConfig = {
                    collection: 'landsat',
                    period: $scope.period,
                    year: $scope.year,
                    visparam: $scope.selectedLandsatVisparam,
                    attribution: 'Landsat ' + $scope.year,
                    bounds: $scope.map.bounds
                };
                $scope.leftLayerLabel = 'Landsat ' + $scope.year + ' - ' + $scope.period;
            } else {
                $scope.leftMapConfig = null;
                $scope.leftLayerLabel = 'Landsat não disponível';
            }
        }
        
        // Configuração da camada direita (Sentinel)
        if ($scope.hasSentinelImageForYear($scope.year) && $scope.selectedSentinelVisparam) {
            var sentinelPeriod = $scope.showMonthlyView ? 'MONTH' : $scope.period;
            var sentinelMonth = $scope.showMonthlyView ? $scope.selectedMonth : null;
            
            $scope.rightMapConfig = {
                collection: 's2_harmonized',
                period: sentinelPeriod,
                year: $scope.year,
                visparam: $scope.selectedSentinelVisparam,
                month: sentinelMonth,
                attribution: 'Sentinel-2 ' + $scope.year,
                bounds: $scope.map.bounds
            };
            
            if ($scope.showMonthlyView) {
                $scope.rightLayerLabel = 'Sentinel ' + $scope.year + ' - ' + $scope.getMonthName($scope.selectedMonth);
            } else {
                $scope.rightLayerLabel = 'Sentinel ' + $scope.year + ' - ' + $scope.period;
            }
        } else {
            $scope.rightMapConfig = null;
            $scope.rightLayerLabel = 'Sentinel não disponível';
        }
    }
    
    // Funções para seleção de visparam com botões
    $scope.selectLandsatVisparam = function(visparam) {
        if ($scope.selectedLandsatVisparam !== visparam) {
            // Cancelar timer anterior se existir
            if (updateTimers.visparam) {
                $timeout.cancel(updateTimers.visparam);
            }
            
            $scope.selectedLandsatVisparam = visparam;
            
            // Aplicar pequeno delay para evitar mudanças muito rápidas
            updateTimers.visparam = $timeout(function() {
                $scope.updateMapLayers(false); // Atualizar ambas as camadas
                updateTimers.visparam = null;
            }, 150);
        }
    };
    
    $scope.selectSentinelVisparam = function(visparam) {
        if ($scope.selectedSentinelVisparam !== visparam) {
            // Cancelar timer anterior se existir
            if (updateTimers.visparam) {
                $timeout.cancel(updateTimers.visparam);
            }
            
            $scope.selectedSentinelVisparam = visparam;
            
            // Aplicar pequeno delay para evitar mudanças muito rápidas
            updateTimers.visparam = $timeout(function() {
                $scope.updateMapLayers(true); // Atualizar apenas a camada direita
                updateTimers.visparam = null;
            }, 150);
        }
    };
    
    // Função auxiliar para verificar se um visparam está selecionado
    $scope.isLandsatVisparamSelected = function(visparam) {
        return $scope.selectedLandsatVisparam === visparam;
    };
    
    $scope.isSentinelVisparamSelected = function(visparam) {
        return $scope.selectedSentinelVisparam === visparam;
    };
    
    // Inicializar as camadas
    $scope.updateMapLayers();
    
    // Fechar modal
    $scope.close = function() {
        // Cancelar timers pendentes
        if (updateTimers.month) {
            $timeout.cancel(updateTimers.month);
        }
        if (updateTimers.visparam) {
            $timeout.cancel(updateTimers.visparam);
        }
        
        $uibModalInstance.dismiss('cancel');
    };
    
    // Limpar timers quando o scope for destruído
    $scope.$on('$destroy', function() {
        if (updateTimers.month) {
            $timeout.cancel(updateTimers.month);
        }
        if (updateTimers.visparam) {
            $timeout.cancel(updateTimers.visparam);
        }
    });
});