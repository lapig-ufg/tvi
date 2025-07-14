Application.controller('MosaicDialogController', function ($scope, $uibModalInstance, mosaics, map, point, config, tilesCapabilities, period) {
    mosaics.sort(function(a, b) {
        return b.firstAcquired - a.firstAcquired;
    });
    $scope.tilesCapabilities = tilesCapabilities;
    $scope.getVisParams = function() {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return false;
        const collection = $scope.tilesCapabilities.find(col => col.name === 's2_harmonized');
        if (!collection || !collection.year) return false;
        return collection.visparam;
    };
    $scope.visparams = $scope.getVisParams();
    $scope.mosaics = mosaics;
    $scope.map = map;
    $scope.point = point;
    $scope.config = config;
    $scope.year = new Date(map.date).getFullYear();
    $scope.period = period;
    $scope.selectedMosaicIndex = 0;

    $scope.currentMosaicUrl = $scope.mosaics[$scope.selectedMosaicIndex].name;

    $scope.close = function() {
        $uibModalInstance.dismiss('cancel');
    };
    $scope.updateMosaic = function(evt) {
        $scope.selectedMosaicIndex = evt.index;
        $scope.currentMosaicUrl = $scope.mosaics[evt.index].name;
    };
    // Adiciona a lógica para o slider
    $scope.onSliderChange = function(index) {
        $scope.updateMosaic({ index: index });
    };
    $scope.hasSentinelImageForYear = function(year) {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return false;
        const collection = $scope.tilesCapabilities.find(col => col.name === 's2_harmonized');
        if (!collection || !collection.year) return false;
        return collection.year.includes(year);
    };

    // Adicionar funções para Landsat
    $scope.hasLandsatImageForYear = function(year) {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return false;
        const collection = $scope.tilesCapabilities.find(col => col.name === 'landsat');
        if (!collection || !collection.values) return false;
        // Verifica se há dados para o ano e período especificados
        return collection.values.some(v => v.year === year && v.period === $scope.period);
    };

    $scope.getLandsatVisParams = function() {
        if (!$scope.tilesCapabilities || !$scope.tilesCapabilities.length) return [];
        const collection = $scope.tilesCapabilities.find(col => col.name === 'landsat');
        if (!collection || !collection.values || !collection.values.length) return [];
        
        // Pegar os visparams do primeiro valor disponível
        const visparams = collection.values[0].visparams || [];
        // Filtrar apenas os visparams do Landsat TVI
        return visparams.filter(v => v.startsWith('landsat-tvi-'));
    };

    $scope.landsatVisparams = $scope.getLandsatVisParams();
});
