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
 * A amostra é desenhada pelo sampleMarkerService conforme a configuração da
 * campanha (marcador tradicional, quadrado ou círculo de raio configurável):
 * sobre imagem de alta resolução o intérprete precisa ver a área que
 * classifica, e o cadastro decide o símbolo.
 *
 * Estrutura clonada de landsatMap (others/directives.js:801): registro em
 * mapSyncService no setup e mapSyncService.unregister + safeDestroyMap no
 * $destroy — mesmo contrato de cleanup usado pelas demais diretivas de mapa
 * do projeto (ver others/directives.js:1092-1101 e
 * directives/campaignPointsMap.js:89-107), que neutraliza callbacks
 * pendentes do Leaflet <= 1.9.4 (workaround documentado em
 * others/directives.js:15).
 */
angular.module('application').directive('waybackMap', function ($timeout, mapSyncService, sampleMarkerService) {
    // Último nível do TileMatrixSet do World Imagery Wayback da Esri.
    var WAYBACK_MAX_TILE_LEVEL = 23;
    // Último nível com tiles nativos nas releases do Wayback (do 20 em diante
    // não há tile em nenhuma região sondada). Acima dele o Leaflet reamostra o
    // nível 19 em vez de pedir tiles inexistentes, cujo 404 dispararia o aviso
    // da célula. Nos níveis 18 e 19 a cobertura varia por região e release;
    // nesses casos o aviso de tile continua valendo.
    var WAYBACK_MAX_NATIVE_ZOOM = 19;

    function maxZoomFor(zoom) {
        return Math.min(zoom + 6, WAYBACK_MAX_TILE_LEVEL);
    }

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
            mapDate: '=',
            sampleMarker: '='
        },
        controller: function ($scope, $element) {
            $scope._destroyed = false;
            $scope.tileError = false;

            function createSampleLayer() {
                return sampleMarkerService.createLayer([$scope.lat, $scope.lon], $scope.sampleMarker);
            }

            // Cria (ou recria) a tile layer da release corrente. Chamada no
            // setup e sempre que tileUrl/mapDate/zoom mudarem via watcher.
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
                    maxZoom: maxZoomFor($scope.zoom),
                    maxNativeZoom: WAYBACK_MAX_NATIVE_ZOOM
                });
                $scope.tileLayer.on('tileerror', function () {
                    $timeout(function () { $scope.tileError = true; });
                });
                // 'loading' dispara a cada novo lote de tiles (troca de zoom ou
                // de posição), limpando o aviso de um lote anterior sem
                // cobertura; 'load' não serve porque dispara mesmo quando
                // todos os tiles falharam.
                $scope.tileLayer.on('loading', function () {
                    $timeout(function () { $scope.tileError = false; });
                });
                $scope.tileLayer.addTo($scope.map);
            }

            $timeout(function () {
                var mapElement = $element[0].querySelector('#wayback-map-' + $scope.$id);
                if (!mapElement || $scope._destroyed) return;

                $scope.map = L.map(mapElement, {
                    center: [$scope.lat, $scope.lon],
                    zoom: $scope.zoom,
                    minZoom: $scope.zoom,
                    maxZoom: maxZoomFor($scope.zoom),
                    zoomControl: true,
                    dragging: true,
                    doubleClickZoom: true,
                    scrollWheelZoom: true
                });

                mapSyncService.register($scope.map);

                updateTileLayer();

                $scope.marker = createSampleLayer().addTo($scope.map);

                // O ng-repeat da grade usa `track by map.index`: ao trocar de
                // ponto, as células (e estas diretivas) são RECICLADAS, não
                // recriadas — sem watcher a célula ficaria congelada no ponto
                // anterior. Mesmo padrão do landsatMap
                // (others/directives.js:1032-1051), estendido a tileUrl/mapDate
                // porque aqui cada célula também troca de release, e a zoom
                // porque a campanha pode ser reconfigurada entre pontos.
                $scope.$watchGroup(['lon', 'lat', 'tileUrl', 'mapDate', 'zoom'], function (newValues, oldValues) {
                    if ($scope._destroyed || !$scope.map) return;
                    var changed = newValues.some(function (v, i) { return v !== oldValues[i]; });
                    if (!changed) return;
                    if (newValues[4] !== oldValues[4]) {
                        $scope.map.setMinZoom($scope.zoom);
                        $scope.map.setMaxZoom(maxZoomFor($scope.zoom));
                    }
                    if ($scope.lon !== undefined && $scope.lat !== undefined) {
                        $scope.map.setView([$scope.lat, $scope.lon], $scope.zoom, { animate: false });
                        if ($scope.marker) {
                            $scope.marker.setLatLng([$scope.lat, $scope.lon]);
                        }
                    }
                    updateTileLayer();
                });

                // A configuração do símbolo é um objeto: watch profundo, à parte
                // do $watchGroup (que compara por referência). Símbolo ou estilo
                // novos exigem outra camada Leaflet.
                $scope.$watch('sampleMarker', function (newValue, oldValue) {
                    if ($scope._destroyed || !$scope.map || newValue === oldValue) return;
                    if ($scope.marker) {
                        $scope.map.removeLayer($scope.marker);
                    }
                    $scope.marker = createSampleLayer().addTo($scope.map);
                }, true);
            });

            $scope.$on('$destroy', function () {
                $scope._destroyed = true;
                if ($scope.map) {
                    if ($scope.tileLayer) {
                        $scope.tileLayer.off();
                        $scope.map.removeLayer($scope.tileLayer);
                    }
                    if ($scope.marker) {
                        $scope.map.removeLayer($scope.marker);
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
