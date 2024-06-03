Application.controller('MosaicDialogController', function ($scope, $uibModalInstance, mosaics, map, point, config) {
    mosaics.sort(function(a, b) {
        return b.firstAcquired - a.firstAcquired;
    });
    $scope.mosaics = mosaics;
    $scope.map = map;
    $scope.point = point;
    $scope.config = config;
    $scope.selectedMosaicIndex = 0;
    $scope.currentMosaicUrl = $scope.mosaics[$scope.selectedMosaicIndex].tiles;

    $scope.close = function() {
        $uibModalInstance.dismiss('cancel');
    };

    $scope.updateMosaic = function(evt) {
        $scope.selectedMosaicIndex = evt.index;
        $scope.currentMosaicUrl = $scope.mosaics[evt.index].tiles;
    };
    // Adiciona a lógica para o slider
    $scope.onSliderChange = function(index) {
        $scope.updateMosaic({ index: index });
    };
});