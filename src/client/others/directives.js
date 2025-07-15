'use strict';
Application
    .directive('numberFormat', function ($filter) {
      return {
        require: 'ngModel',
        link: function (scope, element, attrs, ngModel) {

          var prepare = function (value) {
            var numb = Number(value);
            if (isNaN(numb)) {
              return value;
            }
            return Number(numb).toFixed(2);
          }

          var parse = function (viewValue, noRender) {
            if (!viewValue) {
              return viewValue;
            }
            var clean = String(viewValue).replace(/[^0-9.]+/g, '').replace(/\./g, '').replace(/,/g, '');

            if (!clean || clean.length == 0) {
              clean = '000';
            } else if (clean.length <= 2) {
              clean = '00' + clean
            }
            clean = clean.slice(0, -2) + '.' + clean.slice(-2);

            if (!noRender) {
              ngModel.doRender();
            }
            return Number(clean);
          }

          ngModel.$parsers.unshift(parse);

          ngModel.doRender = function () {
            var clean = parse(prepare(ngModel.$viewValue), true);

            if (!clean) {
              return element.val('0,00');
            }
            element.val($filter('number')(clean, 2));
          }

          scope.$watch(attrs.ngModel, function () {
            ngModel.doRender();
          });
        }
      }
    })
    .directive('inspectionMap', function () {
      return {
        template: '<div id="map-{{::$id}}" style="width: 100%; height: 100%;"></div>',
        scope: {
          lon: '=',
          lat: '=',
          tmsUrl: '=',
          zoom: '=',
          bounds: '='
        },
        controller: function ($scope, $element) {
          angular.element($element).ready(function () {

            $scope.tmsLayer = new L.ImageOverlay($scope.tmsUrl, $scope.bounds);
            $scope.marker = L.marker([$scope.lat, $scope.lon], {
              icon: L.icon({
                iconUrl: 'assets/marker.png',
                iconSize: [42, 42]
              })
            });

            $scope.markerInMap = true;
            var mapElement = $element[0].querySelector(`#map-${$scope.$id}`);
            if (!mapElement) {
              console.error('Elemento do mapa não encontrado!');
              return;
            }

            $scope.map = new L.map(mapElement, {
              layers: [$scope.tmsLayer, $scope.marker],
              center: [$scope.lat, $scope.lon],
              zoomControl: true,
              dragging: false,
              doubleClickZoom: false,
              scrollWheelZoom: false,
              zoom: $scope.zoom,
              minZoom: $scope.zoom,
              maxZoom: $scope.zoom + 2,
              controls: [
                new L.control.scale({metric: true, imperial: false})
              ]
            });

            $scope.map.on('click', function () {
              if ($scope.markerInMap) {
                $scope.map.removeLayer($scope.marker);
                $scope.markerInMap = false;
              } else {
                $scope.map.addLayer($scope.marker);
                $scope.markerInMap = true;
              }
            });

            L.control.scale({metric: true, imperial: false}).addTo($scope.map);
            
            // Force map to recalculate size after initialization
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
              }
            }, 200);
            
            // Additional check for single map scenarios
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
              }
            }, 500);

          });
        }
      }
    })
    .directive('planetMap', function($timeout) {
      return {
        template: `
                <div>
                    <div id="planet-map-{{::$id}}" style="width: 100%; height: 300px;"></div>
                </div>
            `,
        scope: {
          lon: '=',
          lat: '=',
          zoom: '=',
          mosaicUrl: '='
        },
        controller: function($scope, $element) {
          $timeout(function() {
            var mapElement = $element[0].querySelector(`#planet-map-${$scope.$id}`);
            if (!mapElement) {
              console.error('Elemento do mapa não encontrado!');
              return;
            }

            if (!$scope.mosaicUrl) {
              console.error('Nenhum mosaico disponível!');
              return;
            }
            $scope.markerInMap = true;
            $scope.map = L.map(mapElement, {
              center: [$scope.lat, $scope.lon],
              zoomControl: true,
              dragging: true,
              doubleClickZoom: true,
              scrollWheelZoom: true,
              zoom: $scope.zoom,
              minZoom: $scope.zoom,
              maxZoom: $scope.zoom + 6,
            });

            function updateTileLayer() {
              if ($scope.tileLayer) {
                $scope.map.removeLayer($scope.marker);
                $scope.map.removeLayer($scope.tileLayer);
              }
              $scope.marker = L.marker([$scope.lat, $scope.lon], {
                icon: L.icon({
                  iconUrl: 'assets/marker2.png',
                  iconSize: [42, 42]
                })
              }).addTo($scope.map);

              $scope.tileLayer = L.tileLayer.wms('/service/mapbiomas/wms', {
                layers: $scope.mosaicUrl,
                format: 'image/png',
                version: '1.3.0',
                uppercase: true,
              }).addTo($scope.map);
            }

            $scope.$watch('mosaicUrl', function(newVal) {
              if (newVal) {
                updateTileLayer();
              }
            });

            $scope.map.on('click', function () {
              if ($scope.markerInMap) {
                $scope.map.removeLayer($scope.marker);
                $scope.markerInMap = false;
              } else {
                $scope.map.addLayer($scope.marker);
                $scope.markerInMap = true;
              }
            });

            updateTileLayer();

            L.control.scale({ metric: true, imperial: false }).addTo($scope.map);
          }, 0);
        }
      }
    })
    // .directive('sentinelMap', function($timeout, $http) {
    //   return {
    //     template: `
    //         <div>
    //             <h4 style="text-align: center">Imagem COPERNICUS/S2_HARMONIZED {{::period}} - {{::year}}</h4>
    //             <div style="text-align: center">
    //                 <label ng-repeat="param in visparams" class="radio-visparam">
    //                     <input type="radio" ng-model="$parent.selectedVisparam" ng-value="param" ng-change="updateTileLayer()">
    //                     {{param}}
    //                 </label>
    //             </div>
    //             <div id="sentinel-map-{{::$id}}" style="width: 100%; height: 300px;"></div>
    //         </div>
    //     `,
    //     scope: {
    //       lon: '=',
    //       lat: '=',
    //       zoom: '=',
    //       period: '=',
    //       year: '=',
    //       visparams: '='
    //     },
    //     controller: function($scope, $element) {
    //       $scope.selectedVisparam = $scope.visparams[0]; // Seleciona o primeiro visparam por padrão
    //       $timeout(function() {
    //         var mapElement = $element[0].querySelector(`#sentinel-map-${$scope.$id}`);
    //         if (!mapElement) {
    //           console.error('Elemento do mapa não encontrado!');
    //           return;
    //         }
    //
    //         if (!$scope.period || !$scope.year) {
    //           console.error('Parâmetros de período ou ano não disponíveis!');
    //           return;
    //         }
    //
    //         $scope.markerInMap = true;
    //         $scope.map = L.map(mapElement, {
    //           center: [$scope.lat, $scope.lon],
    //           zoomControl: true,
    //           dragging: true,
    //           doubleClickZoom: true,
    //           scrollWheelZoom: true,
    //           zoom: $scope.zoom,
    //           minZoom: $scope.zoom,
    //           maxZoom: $scope.zoom + 6,
    //         });
    //
    //         $scope.updateTileLayer = function() {
    //           if ($scope.tileLayer) {
    //             $scope.map.removeLayer($scope.marker);
    //             $scope.map.removeLayer($scope.tileLayer);
    //           }
    //           $scope.marker = L.marker([$scope.lat, $scope.lon], {
    //             icon: L.icon({
    //               iconUrl: 'assets/marker2.png',
    //               iconSize: [42, 42]
    //             })
    //           }).addTo($scope.map);
    //
    //           var tileUrl = `https://tm{s}.lapig.iesa.ufg.br/api/layers/s2_harmonized/{x}/{y}/{z}?visparam=${$scope.selectedVisparam}&period=${$scope.period}&year=${$scope.year}`;
    //           $scope.tileLayer = L.tileLayer(tileUrl, {
    //             subdomains: ['1', '2', '3', '4', '5'],
    //             attribution: `${$scope.period} - ${$scope.year}`,
    //             attributionControl: true,
    //           }).addTo($scope.map);
    //         };
    //
    //         $scope.$watchGroup(['period', 'year'], function(newVals) {
    //           if (newVals[0] && newVals[1]) {
    //             $scope.updateTileLayer();
    //           }
    //         });
    //
    //         $scope.map.on('click', function () {
    //           if ($scope.markerInMap) {
    //             $scope.map.removeLayer($scope.marker);
    //             $scope.markerInMap = false;
    //           } else {
    //             $scope.map.addLayer($scope.marker);
    //             $scope.markerInMap = true;
    //           }
    //         });
    //
    //         $scope.updateTileLayer();
    //
    //         L.control.scale({ metric: true, imperial: false }).addTo($scope.map);
    //       }, 0);
    //     }
    //   }
    // })
    .directive('sentinelMap', function ($timeout) {
      return {
        template: `
      <div>
        <h4 style="text-align:center">
          Imagem COPERNICUS/S2_HARMONIZED {{::period}} – {{::year}}
        </h4>

        <!-- Seletor de visparam -->
        <div style="text-align:center">
          <label ng-repeat="param in visparams" class="radio-visparam">
            <input  type="radio"
                    ng-model="$parent.selectedVisparam"
                    ng-value="param"
                    ng-change="updateTileLayer()">
            {{param}}
          </label>
        </div>
        <div id="sentinel-map-{{::$id}}" style="width:100%;height:300px;"></div>
                <div class="slider-container"
             ng-if="period === 'MONTH' && mosaics.length">
          <label for="mosaicSlider-{{::$id}}">Mês: &nbsp;<strong>{{selectedMonth}}/{{year}}</strong></label>
          <input  id="mosaicSlider-{{::$id}}"
                  type="range"
                  min="0"
                  max="{{mosaics.length-1}}"
                  step="1"
                  class="slider"
                  ng-model="selectedMosaicIndex"
                  ng-change="onSliderChange(selectedMosaicIndex)">
         
        </div>
      </div>
    `,
        scope: {
          lon:       '=',
          lat:       '=',
          zoom:      '=',
          period:    '=',
          year:      '=',
          visparams: '='
        },
        controller: function ($scope, $element) {

          /* ---------- estado ---------- */
          $scope.selectedVisparam    = $scope.visparams[0];
          $scope.mosaics             = [];
          $scope.selectedMosaicIndex = 0;
          $scope.selectedMonth       = null;
          $scope.period = 'MONTH';

          /* ---------- gera meses 01-12 (ou 01-mês_atual) ---------- */
          function refreshMonths () {
            if ($scope.period !== 'MONTH' || !$scope.year) {
              $scope.mosaics = [];
              return;
            }
            const now        = new Date();
            const isCurrent  = +$scope.year === now.getFullYear();
            const lastMonth  = isCurrent ? now.getMonth() + 1 : 12;
            $scope.mosaics   = Array.from({ length: lastMonth }, (_, i) => i + 1);
            $scope.selectedMosaicIndex = 0;
            $scope.selectedMonth       = $scope.mosaics[0];
          }

          /* ---------- helpers ---------- */
          function buildTileUrl () {
            const periodOrMonth = $scope.period === 'MONTH' ? 'MONTH' : $scope.period;
            const monthParam    = periodOrMonth === 'MONTH'
                ? `&month=${$scope.selectedMonth}`
                : '';
            return `https://tm{s}.lapig.iesa.ufg.br/api/layers/s2_harmonized/{x}/{y}/{z}` +
                `?period=${periodOrMonth}` +
                `&year=${$scope.year}` +
                `&visparam=${$scope.selectedVisparam}${monthParam}`;
          }

          /* ---------- inicia Leaflet ---------- */
          $timeout(function () {
            const mapElement = $element[0]
                .querySelector('#sentinel-map-' + $scope.$id);
            if (!mapElement) return;

            $scope.map = L.map(mapElement, {
              center:  [$scope.lat, $scope.lon],
              zoom:    $scope.zoom,
              minZoom: $scope.zoom,
              maxZoom: $scope.zoom + 6
            });

            $scope.marker = L.marker([$scope.lat, $scope.lon], {
              icon: L.icon({ iconUrl: 'assets/marker2.png', iconSize: [42, 42] })
            }).addTo($scope.map);

            $scope.updateTileLayer = function () {
              if ($scope.tileLayer) $scope.map.removeLayer($scope.tileLayer);
              $scope.tileLayer = L.tileLayer(buildTileUrl(), {
                subdomains: ['1','2','3','4','5'],
                attribution: `${$scope.period} – ${$scope.year}`
              }).addTo($scope.map);
            };

            $scope.onSliderChange = function (idx) {
              $scope.selectedMonth = $scope.mosaics[idx];
              $scope.updateTileLayer();
            };

            /* watchers */
            $scope.$watchGroup(['period','year'], function () {
              refreshMonths();
              $scope.updateTileLayer();
            });

            /* primeira renderização */
            refreshMonths();
            $scope.updateTileLayer();
            L.control.scale({ metric:true, imperial:false }).addTo($scope.map);
          }, 0);
        }
      };
    })
  .directive('combinedMaps', function() {
      return {
        template: `
                <div style="display: flex; justify-content: space-between;">
                    <div style="flex: 1; margin-right: 10px;">
                        <small  class="text-center">Imagem da Campanha</small>
                        <inspection-map lon="lon" lat="lat" tms-url="tmsUrl" zoom="zoom" bounds="bounds"></inspection-map>
                    </div>
<!--                    <div style="flex: 1;">-->
<!--                        <small class="text-center">Imagen Planet</small>-->
<!--                        <planet-map lon="lon" lat="lat" zoom="zoom" mosaic-url="mosaicUrl"></planet-map>-->
<!--                    </div>-->
                </div>
            `,
        scope: {
          lon: '=',
          lat: '=',
          tmsUrl: '=',
          zoom: '=',
          bounds: '=',
          mosaicUrl: '='
        }
      }
    })
    .directive('landsatMap', function ($timeout, capabilitiesService) {
      return {
        template: `
          <div style="width: 100%; height: 100%;">
            <div id="landsat-map-{{::$id}}" style="width: 100%; height: 100%;"></div>
          </div>
        `,
        scope: {
          lon: '=',
          lat: '=',
          zoom: '=',
          period: '=',
          year: '=',
          visparams: '='
        },
        controller: function ($scope, $element) {
          /* ---------- estado ---------- */
          // Obter visparam do scope pai (supervisor controller)
          $scope.selectedVisparam = $scope.$parent.landsatVisparam || localStorage.getItem('landsatVisparam') || 'landsat-tvi-false';
          
          $scope.tilesCapabilities = [];
          $scope.markerInMap = true;
          
          // Escutar mudanças de visparam do scope pai
          $scope.$on('landsatVisparamChanged', function(event, newVisparam) {
            $scope.selectedVisparam = newVisparam;
            if ($scope.map && $scope.period && $scope.year) {
              $scope.updateTileLayer();
            }
          });

          /* ---------- buscar capabilities ---------- */
          function fetchCapabilities() {
            capabilitiesService.getCapabilities()
              .then(function(data) {
                if (data && data.length > 0) {
                  // Encontrar a capability específica do Landsat
                  const landsatCap = data.find(c => c.name === 'landsat');
                  if (landsatCap) {
                    $scope.tilesCapabilities = landsatCap;
                    validateYearAndPeriod();
                  }
                }
              })
              .catch(function(error) {
                console.error('Erro ao buscar capabilities:', error);
              });
          }

          /* ---------- validar ano e período ---------- */
          function validateYearAndPeriod() {
            if (!$scope.tilesCapabilities) {
              return;
            }

            // Encontrar a capability específica do Landsat
            let landsatCapability = null;
            if (Array.isArray($scope.tilesCapabilities)) {
              landsatCapability = $scope.tilesCapabilities.find(c => c.name === 'landsat');
            } else if ($scope.tilesCapabilities.name === 'landsat') {
              landsatCapability = $scope.tilesCapabilities;
            }

            if (!landsatCapability || !landsatCapability.values) {
              return;
            }

            // Validar ano
            const availableYears = landsatCapability.values
              .filter(v => v.period === $scope.period)
              .map(v => v.year);

            if (availableYears.length > 0 && !availableYears.includes($scope.year)) {
              console.warn(`Ano ${$scope.year} não disponível para período ${$scope.period}`);
            }

            // Validar visparams
            const availableVisparams = landsatCapability.values[0]?.visparams || [];
            const landsatVisparams = availableVisparams.filter(v => 
              v.startsWith('landsat-tvi-')
            );

            if (landsatVisparams.length > 0 && !landsatVisparams.includes($scope.selectedVisparam)) {
              $scope.selectedVisparam = landsatVisparams[0];
            }
          }

          /* ---------- helpers ---------- */
          function buildTileUrl() {
            // Salvar preferência no localStorage
            localStorage.setItem('landsat_visparam', $scope.selectedVisparam);
            
            return `https://tm{s}.lapig.iesa.ufg.br/api/layers/landsat/{x}/{y}/{z}` +
              `?period=${$scope.period}` +
              `&year=${$scope.year}` +
              `&visparam=${$scope.selectedVisparam}`;
          }

          /* ---------- Define updateTileLayer antes de usar ---------- */
          $scope.updateTileLayer = function () {
            if (!$scope.map) return;
            
            if ($scope.tileLayer) {
              $scope.map.removeLayer($scope.tileLayer);
            }
            
            $scope.tileLayer = L.tileLayer(buildTileUrl(), {
              subdomains: ['1', '2', '3', '4', '5'],
              attribution: `Landsat ${$scope.period} – ${$scope.year}`,
              maxZoom: 18
            }).addTo($scope.map);
            
            // Garantir que o marcador esteja sempre no topo
            if ($scope.marker && $scope.markerInMap) {
              $scope.marker.bringToFront();
            }
          };

          /* ---------- inicia Leaflet ---------- */
          $timeout(function () {
            const mapElement = $element[0]
              .querySelector('#landsat-map-' + $scope.$id);
            if (!mapElement) return;

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

            // Criar marcador com z-index alto para garantir que fique acima dos tiles
            $scope.marker = L.marker([$scope.lat, $scope.lon], {
              icon: L.icon({ 
                iconUrl: 'assets/marker2.png', 
                iconSize: [42, 42] 
              }),
              zIndexOffset: 1000
            }).addTo($scope.map);

            // Toggle do marcador ao clicar no mapa
            $scope.map.on('click', function () {
              if ($scope.markerInMap) {
                $scope.map.removeLayer($scope.marker);
                $scope.markerInMap = false;
              } else {
                $scope.map.addLayer($scope.marker);
                $scope.markerInMap = true;
              }
            });

            /* watchers */
            $scope.$watchGroup(['period', 'year', 'selectedVisparam'], function (newValues, oldValues) {
              if ($scope.period && $scope.year) {
                validateYearAndPeriod();
                $scope.updateTileLayer();
              }
            });
            
            // Adicionar evento para garantir que o marcador permaneça visível quando os tiles carregam
            $scope.map.on('layeradd', function(e) {
              if (e.layer !== $scope.marker && $scope.marker && $scope.markerInMap) {
                setTimeout(function() {
                  $scope.marker.bringToFront();
                }, 50);
              }
            });

            /* primeira renderização */
            fetchCapabilities();
            if ($scope.period && $scope.year) {
              $scope.updateTileLayer();
            }
            L.control.scale({ metric: true, imperial: false }).addTo($scope.map);
            
            // Force map to recalculate size and ensure marker is visible
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
                // Garantir que o marcador esteja visível após o redimensionamento
                if ($scope.marker && $scope.markerInMap) {
                  $scope.marker.bringToFront();
                }
              }
            }, 100);
            
            // Additional check for grid scenarios with multiple maps
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
                // Re-adicionar o marcador se ele não estiver visível
                if ($scope.marker && $scope.markerInMap && !$scope.map.hasLayer($scope.marker)) {
                  $scope.map.addLayer($scope.marker);
                }
              }
            }, 500);
          }, 0);
        }
      };
    });
