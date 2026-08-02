'use strict';

/**
 * <wayback-map> — célula da grade para campanhas Esri Wayback.
 *
 * Recebe a URL de tiles XYZ já resolvida para a release da célula (montada
 * por WaybackGridCore.leafletUrl a partir do itemURL do catálogo). Sem
 * visparam nem período — conceitos que não existem no Wayback. Em erro de
 * tile (release removida/renumerada pela Esri), exibe aviso na célula sem
 * quebrar a grade.
 *
 * Estrutura clonada de landsatMap (others/directives.js:801): registro em
 * mapSyncService no setup e mapSyncService.unregister + safeDestroyMap no
 * $destroy — mesmo contrato de cleanup usado pelas demais diretivas de mapa
 * do projeto (ver others/directives.js:1092-1101 e
 * directives/campaignPointsMap.js:89-107), que neutraliza callbacks
 * pendentes do Leaflet <= 1.9.4 (workaround documentado em
 * others/directives.js:15).
 */
angular.module('application').directive('waybackMap', function ($timeout, mapSyncService) {
    return {
        restrict: 'E',
        template: '<div style="width: 100%; height: 100%; position: relative;">' +
                  '  <div id="wayback-map-{{::$id}}" style="width: 100%; height: 100%;"></div>' +
                  '  <div ng-show="tileError" class="alert alert-warning" ' +
                  '       style="position: absolute; top: 4px; left: 4px; right: 4px; z-index: 1000; padding: 4px 8px; font-size: 11px;">' +
                  "       {{ 'TEMPORAL.MAP.WAYBACK_TILE_ERROR' | i18n }}" +
                  '  </div>' +
                  '</div>',
        scope: {
            lon: '=',
            lat: '=',
            zoom: '=',
            tileUrl: '=',
            mapDate: '='
        },
        controller: function ($scope, $element) {
            $scope._destroyed = false;
            $scope.tileError = false;
            $scope.markerInMap = true;

            // Cria (ou recria) a tile layer da release corrente. Chamada no
            // setup e sempre que tileUrl/mapDate mudarem via watcher.
            function updateTileLayer() {
                if (!$scope.map) return;
                $scope.tileError = false;
                if ($scope.tileLayer) {
                    $scope.tileLayer.off();
                    $scope.map.removeLayer($scope.tileLayer);
                    $scope.tileLayer = null;
                }
                if (!$scope.tileUrl) {
                    $scope.tileError = true;
                    return;
                }
                $scope.tileLayer = L.tileLayer($scope.tileUrl, {
                    attribution: 'Esri Wayback — ' + ($scope.mapDate || ''),
                    maxZoom: $scope.zoom + 6
                });
                $scope.tileLayer.on('tileerror', function () {
                    $timeout(function () { $scope.tileError = true; });
                });
                $scope.tileLayer.addTo($scope.map);
                if ($scope.marker) {
                    $scope.marker.setZIndexOffset(1000);
                }
            }

            $timeout(function () {
                var mapElement = $element[0].querySelector('#wayback-map-' + $scope.$id);
                if (!mapElement || $scope._destroyed) return;

                $scope.map = L.map(mapElement, {
                    center: [$scope.lat, $scope.lon],
                    zoom: $scope.zoom,
                    minZoom: $scope.zoom,
                    maxZoom: $scope.zoom + 6,
                    zoomControl: true,
                    dragging: true,
                    doubleClickZoom: true,
                    scrollWheelZoom: true
                });

                mapSyncService.register($scope.map);

                updateTileLayer();

                $scope.marker = L.marker([$scope.lat, $scope.lon], {
                    icon: L.icon({
                        iconUrl: 'assets/marker2.png',
                        iconSize: [42, 42]
                    }),
                    zIndexOffset: 1000
                }).addTo($scope.map);

                // O ng-repeat da grade usa `track by map.index`: ao trocar de
                // ponto, as células (e estas diretivas) são RECICLADAS, não
                // recriadas — sem watcher a célula ficaria congelada no ponto
                // anterior. Mesmo padrão do landsatMap
                // (others/directives.js:1032-1051), estendido a tileUrl/mapDate
                // porque aqui cada célula também troca de release.
                $scope.$watchGroup(['lon', 'lat', 'tileUrl', 'mapDate'], function (newValues, oldValues) {
                    if ($scope._destroyed || !$scope.map) return;
                    var changed = newValues.some(function (v, i) { return v !== oldValues[i]; });
                    if (!changed) return;
                    if ($scope.lon !== undefined && $scope.lat !== undefined) {
                        $scope.map.setView([$scope.lat, $scope.lon], $scope.zoom, { animate: false });
                        if ($scope.marker) {
                            $scope.marker.setLatLng([$scope.lat, $scope.lon]);
                        }
                    }
                    updateTileLayer();
                });
            });

            $scope.$on('$destroy', function () {
                $scope._destroyed = true;
                if ($scope.map) {
                    if ($scope.tileLayer) {
                        $scope.tileLayer.off();
                        $scope.map.removeLayer($scope.tileLayer);
                    }
                    mapSyncService.unregister($scope.map);
                    // safeDestroyMap é exposto globalmente em others/directives.js
                    if (typeof safeDestroyMap === 'function') {
                        safeDestroyMap($scope.map);
                    } else {
                        try { $scope.map.remove(); } catch (ignored) {}
                    }
                    $scope.map = null;
                }
            });
        }
    };
});
