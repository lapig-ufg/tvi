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
    .directive('sentinelMap', function ($timeout, $injector, capabilitiesService) {
      return {
        template: `
          <div style="width: 100%; height: 100%;">
            <div id="sentinel-map-{{::$id}}" style="width: 100%; height: 100%;"></div>
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
        controller: function ($scope, $element, $injector) {

          /* ---------- estado ---------- */
          // Função para obter o visparam atual
          function getCurrentVisparam() {
            // Primeiro tentar do scope pai direto
            if ($scope.$parent && $scope.$parent.sentinelVisparam) {
              return $scope.$parent.sentinelVisparam;
            }
            // Tentar do scope avô (quando ng-if cria scope isolado)
            if ($scope.$parent && $scope.$parent.$parent && $scope.$parent.$parent.sentinelVisparam) {
              return $scope.$parent.$parent.sentinelVisparam;
            }
            // Depois do localStorage
            return localStorage.getItem('sentinelVisparam') || 'tvi-green';
          }
          
          // Obter visparam do scope pai (similar ao landsat-map)
          $scope.selectedVisparam = getCurrentVisparam();
          
          // Garantir que sempre temos um array de visparams válido
          if (!$scope.visparams || !Array.isArray($scope.visparams) || $scope.visparams.length === 0) {
              // Visparams padrão do Sentinel se nenhum for fornecido
              $scope.visparams = ['tvi-green'];
          }
          
          $scope.tilesCapabilities = [];
          $scope.markerInMap = true;
          
          // Escutar mudanças de visparam do scope pai
          $scope.$on('sentinelVisparamChanged', function(event, newVisparam) {
            console.log('sentinel-map: recebido sentinelVisparamChanged:', newVisparam);
            $scope.selectedVisparam = newVisparam;
            if ($scope.map && $scope.period && $scope.year) {
              $scope.updateTileLayer();
            }
          });
          
          // Também observar mudanças diretas no visparam do pai
          $scope.$watch(function() {
            // Checar múltiplos níveis de scope devido ao ng-if
            if ($scope.$parent && $scope.$parent.sentinelVisparam) {
              return $scope.$parent.sentinelVisparam;
            }
            if ($scope.$parent && $scope.$parent.$parent && $scope.$parent.$parent.sentinelVisparam) {
              return $scope.$parent.$parent.sentinelVisparam;
            }
            return null;
          }, function(newVal, oldVal) {
            if (newVal && newVal !== oldVal) {
              $scope.selectedVisparam = newVal;
              if ($scope.map && $scope.period && $scope.year) {
                $scope.updateTileLayer();
              }
            }
          });

          /* ---------- buscar capabilities ---------- */
          function fetchCapabilities() {
            capabilitiesService.getCapabilities()
              .then(function(data) {
                if (data && data.length > 0) {
                  // Já filtrado para Sentinel no service
                  $scope.tilesCapabilities = data;
                  validateYearAndPeriod();
                }
              })
              .catch(function(error) {
                console.error('Erro ao buscar capabilities do Sentinel:', error);
              });
          }

          /* ---------- validar ano e período ---------- */
          function validateYearAndPeriod() {
            if (!$scope.tilesCapabilities || $scope.tilesCapabilities.length === 0) {
              return;
            }

            // Encontrar a capability específica do Sentinel
            const sentinelCapability = $scope.tilesCapabilities[0];
            if (!sentinelCapability || !sentinelCapability.year) {
              return;
            }

            // Validar ano
            const availableYears = sentinelCapability.year;
            if (availableYears && !availableYears.includes($scope.year)) {
              console.warn(`Ano ${$scope.year} não disponível para Sentinel`);
            }

            // Validar visparams se disponíveis
            if (sentinelCapability.visparam_details && sentinelCapability.visparam_details.length > 0) {
              const availableVisparams = sentinelCapability.visparam_details.map(v => v.name);
              if (!availableVisparams.includes($scope.selectedVisparam)) {
                $scope.selectedVisparam = availableVisparams[0];
              }
            }
          }

          /* ---------- helpers ---------- */
          function buildTileUrl() {
            // Salvar preferência no localStorage
            localStorage.setItem('sentinelVisparam', $scope.selectedVisparam);
            
            // Usar configuração de ambiente se disponível
            if ($injector.has('AppConfig')) {
              const AppConfig = $injector.get('AppConfig');
              return AppConfig.buildTileUrl('s2_harmonized', {
                period: $scope.period,
                year: $scope.year,
                visparam: $scope.selectedVisparam
              });
            }
            
            // Fallback para URL hardcoded se config não estiver disponível
            return `https://tm{s}.lapig.iesa.ufg.br/api/layers/s2_harmonized/{x}/{y}/{z}` +
              `?period=${$scope.period}` +
              `&year=${$scope.year}` +
              `&visparam=${$scope.selectedVisparam}`;
          }

          /* ---------- Define updateTileLayer antes de usar ---------- */
          $scope.updateTileLayer = function () {
            if (!$scope.map) return;
            
            console.log('sentinel-map updateTileLayer: visparam =', $scope.selectedVisparam);
            
            if ($scope.tileLayer) {
              $scope.map.removeLayer($scope.tileLayer);
            }
            
            var tileUrl = buildTileUrl();
            console.log('sentinel-map: tile URL =', tileUrl);
            
            $scope.tileLayer = L.tileLayer(tileUrl, {
              subdomains: ['1', '2', '3', '4', '5'],
              attribution: `Sentinel-2 ${$scope.period} – ${$scope.year}`,
              maxZoom: 18
            }).addTo($scope.map);
            
            // Garantir que o marcador esteja sempre no topo usando setZIndexOffset
            if ($scope.marker && $scope.markerInMap) {
              $scope.marker.setZIndexOffset(1000);
            }
          };

          /* ---------- inicia Leaflet ---------- */
          $timeout(function () {
            const mapElement = $element[0]
                .querySelector('#sentinel-map-' + $scope.$id);
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
                  if ($scope.marker && $scope.map.hasLayer($scope.marker)) {
                    $scope.marker.setZIndexOffset(1000);
                  }
                }, 50);
              }
            });

            /* primeira renderização */
            fetchCapabilities();
            
            // Garantir que temos o visparam mais atual antes da primeira renderização
            $scope.selectedVisparam = getCurrentVisparam();
            
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
                  $scope.marker.setZIndexOffset(1000);
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
    .directive('landsatMap', function ($timeout, capabilitiesService, $injector) {
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
        controller: function ($scope, $element, $injector) {
          /* ---------- estado ---------- */
          // Função para obter o visparam atual
          function getCurrentVisparam() {
            // Primeiro tentar do scope pai direto
            if ($scope.$parent && $scope.$parent.landsatVisparam) {
              return $scope.$parent.landsatVisparam;
            }
            // Tentar do scope avô (quando ng-if cria scope isolado)
            if ($scope.$parent && $scope.$parent.$parent && $scope.$parent.$parent.landsatVisparam) {
              return $scope.$parent.$parent.landsatVisparam;
            }
            // Depois do localStorage
            return localStorage.getItem('landsatVisparam') || 'landsat-tvi-false';
          }
          
          // Obter visparam do scope pai (supervisor controller)
          $scope.selectedVisparam = getCurrentVisparam();
          
          // Garantir que sempre temos um array de visparams válido
          if (!$scope.visparams || !Array.isArray($scope.visparams) || $scope.visparams.length === 0) {
              // Visparams padrão do Landsat se nenhum for fornecido
              $scope.visparams = ['landsat-tvi-false'];
          }
          
          $scope.tilesCapabilities = [];
          $scope.markerInMap = true;
          
          // Escutar mudanças de visparam do scope pai
          $scope.$on('landsatVisparamChanged', function(event, newVisparam) {
            $scope.selectedVisparam = newVisparam;
            if ($scope.map && $scope.period && $scope.year) {
              $scope.updateTileLayer();
            }
          });
          
          // Também observar mudanças diretas no visparam do pai
          $scope.$watch(function() {
            // Checar múltiplos níveis de scope devido ao ng-if
            if ($scope.$parent && $scope.$parent.landsatVisparam) {
              return $scope.$parent.landsatVisparam;
            }
            if ($scope.$parent && $scope.$parent.$parent && $scope.$parent.$parent.landsatVisparam) {
              return $scope.$parent.$parent.landsatVisparam;
            }
            return null;
          }, function(newVal, oldVal) {
            if (newVal && newVal !== oldVal) {
              $scope.selectedVisparam = newVal;
              if ($scope.map && $scope.period && $scope.year) {
                $scope.updateTileLayer();
              }
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
            localStorage.setItem('landsatVisparam', $scope.selectedVisparam);
            
            // Usar configuração de ambiente se disponível
            if ($injector.has('AppConfig')) {
              const AppConfig = $injector.get('AppConfig');
              return AppConfig.buildTileUrl('landsat', {
                period: $scope.period,
                year: $scope.year,
                visparam: $scope.selectedVisparam
              });
            }
            
            // Fallback para URL hardcoded se config não estiver disponível
            return `https://tm{s}.lapig.iesa.ufg.br/api/layers/landsat/{x}/{y}/{z}` +
              `?period=${$scope.period}` +
              `&year=${$scope.year}` +
              `&visparam=${$scope.selectedVisparam}`;
          }

          /* ---------- Define updateTileLayer antes de usar ---------- */
          $scope.updateTileLayer = function () {
            if (!$scope.map) return;
            
            // Garantir que estamos usando o visparam mais atual
            if (!$scope.selectedVisparam || $scope.selectedVisparam !== getCurrentVisparam()) {
              $scope.selectedVisparam = getCurrentVisparam();
            }
            
            if ($scope.tileLayer) {
              $scope.map.removeLayer($scope.tileLayer);
            }
            
            $scope.tileLayer = L.tileLayer(buildTileUrl(), {
              subdomains: ['1', '2', '3', '4', '5'],
              attribution: `Landsat ${$scope.period} – ${$scope.year}`,
              maxZoom: 18
            }).addTo($scope.map);
            
            // Garantir que o marcador esteja sempre no topo usando setZIndexOffset
            if ($scope.marker && $scope.markerInMap) {
              $scope.marker.setZIndexOffset(1000);
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
                  if ($scope.marker && $scope.map.hasLayer($scope.marker)) {
                    $scope.marker.setZIndexOffset(1000);
                  }
                }, 50);
              }
            });

            /* primeira renderização */
            fetchCapabilities();
            
            // Garantir que temos o visparam mais atual antes da primeira renderização
            $scope.selectedVisparam = getCurrentVisparam();
            
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
                  $scope.marker.setZIndexOffset(1000);
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
    })
    .directive('wmsMap', function($timeout, $injector) {
      return {
        template: `
          <div style="width: 100%; height: 100%; min-height: 300px; position: relative;">
            <div id="wms-map-{{::$id}}" style="width: 100%; height: 100%; min-height: 300px;"></div>
            <div ng-show="loading" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000;">
              <div style="text-align: center;">
                <i class="fa fa-spinner fa-spin" style="font-size: 2em; color: #337ab7;"></i>
                <p style="margin-top: 10px; color: #666;">Carregando mapa ...</p>
              </div>
            </div>
          </div>
        `,
        scope: {
          lon: '=',
          lat: '=',
          zoom: '=',
          period: '=',
          year: '=',
          wmsConfig: '='
        },
        controller: function($scope, $element) {
          $scope.markerInMap = true;
          $scope.loading = false; // Começar sem loading, será mostrado quando tiles iniciarem
          $scope.tileRetryCount = {}; // Contador de tentativas por tile
          $scope.maxRetries = 3; // Reduzido de 10 para 3 para evitar loops longos
          $scope.loadingTimeout = null; // Para controlar timeout do loading
          
          // Função para construir URL WMS
          function buildWmsUrl() {
            if (!$scope.wmsConfig || !$scope.wmsConfig.baseUrl) {
              return null;
            }
            
            // Encontrar a configuração para o ano atual
            var layerConfig = $scope.wmsConfig.layers.find(function(layer) {
              return layer.year === $scope.year;
            });
            
            if (!layerConfig) {
              console.warn('WMS: Nenhuma configuração encontrada para o ano', $scope.year);
              return null;
            }
            
            // Determinar qual layer usar baseado no período
            var layerName = null;
            console.log('WMS: Selecionando layer para período', $scope.period, '- Config:', layerConfig);
            
            if ($scope.period === 'DRY' && layerConfig.dryUrl) {
              layerName = layerConfig.dryUrl;
              console.log('WMS: Usando layer DRY:', layerName);
            } else if ($scope.period === 'WET' && layerConfig.wetUrl) {
              layerName = layerConfig.wetUrl;
              console.log('WMS: Usando layer WET:', layerName);
            } else {
              // Fallback: usar qualquer layer disponível
              layerName = layerConfig.dryUrl || layerConfig.wetUrl;
              console.log('WMS: Usando layer fallback:', layerName);
            }
            
            if (!layerName) {
              console.warn('WMS: Nenhuma camada configurada para', $scope.year, $scope.period);
              return null;
            }
            
            return {
              baseUrl: $scope.wmsConfig.baseUrl,
              layerName: layerName
            };
          }
          
          // Variáveis de controle de tiles - declaradas no escopo do controller
          var tilesLoading = 0;
          var firstTileLoaded = false;
          var retryInProgress = {}; // Controlar retries em andamento
          var totalRetries = 0; // Contador global de retries
          var maxTotalRetries = 20; // Limite total de retries para evitar loops
          
          // Função para atualizar layer WMS
          $scope.updateWmsLayer = function() {
            console.log('WMS: Atualizando layer - Período:', $scope.period, 'Ano:', $scope.year);
            if (!$scope.map) return;
            
            // Remover layer anterior se existir
            if ($scope.wmsLayer) {
              console.log('WMS: Removendo layer anterior');
              
              // Cancelar todos os timeouts de retry pendentes
              if ($scope.wmsLayer._tiles) {
                for (var key in $scope.wmsLayer._tiles) {
                  var tile = $scope.wmsLayer._tiles[key];
                  if (tile && tile._retryTimeout) {
                    clearTimeout(tile._retryTimeout);
                    tile._retryTimeout = null;
                  }
                }
              }
              
              $scope.map.removeLayer($scope.wmsLayer);
              $scope.wmsLayer = null;
              
              // Limpar contadores de retry e flags
              $scope.tileRetryCount = {};
              retryInProgress = {};
              totalRetries = 0; // Resetar contador global
              
              // Cancelar timeout de loading se existir
              if ($scope.loadingTimeout) {
                $timeout.cancel($scope.loadingTimeout);
                $scope.loadingTimeout = null;
              }
              
              // Resetar loading
              $scope.loading = true;
            }
            
            // Resetar contadores ao atualizar layer
            tilesLoading = 0;
            firstTileLoaded = false;
            
            // Mostrar loading ao iniciar atualização
            $scope.loading = true;
            
            // Pequeno delay para garantir limpeza completa
            $timeout(function() {
              var wmsInfo = buildWmsUrl();
              if (!wmsInfo) {
                console.warn('WMS: Não foi possível construir URL WMS');
                $scope.loading = false;
                return;
              }
              
              // Adicionar parâmetro TIME no formato ISO8601 baseado no ano
              var timeParam = $scope.year + '-01-01T00:00:00.000Z';
              
              console.log('WMS: Carregando camada', wmsInfo.layerName, 'do servidor', wmsInfo.baseUrl);
              console.log('WMS: Parâmetro TIME:', timeParam);
            
            // Corrigir URL se necessário - remover parte duplicada do path
            var baseUrl = wmsInfo.baseUrl;
            if (baseUrl.includes('/ows')) {
              baseUrl = baseUrl.replace(/\/[^\/]+\/ows$/, '/ows');
            }
            
            console.log('WMS: URL base corrigida:', baseUrl);
            
            $scope.wmsLayer = L.tileLayer.wms(baseUrl, {
              layers: wmsInfo.layerName,
              format: 'image/png',
              transparent: true,
              version: '1.3.0',
              uppercase: true,
              maxZoom: 18,
              attribution: `WMS ${$scope.period} - ${$scope.year}`,
              time: timeParam,
              tiled: true,
              opacity: 1.0,
              // Adicionar mais parâmetros que podem ser necessários
              crs: L.CRS.EPSG3857,
              width: 256,
              height: 256
            }).addTo($scope.map);
            
            // Configurar eventos de tile
            $scope.wmsLayer.on('tileloadstart', function(e) {
              tilesLoading++;
              console.log('WMS: Tile iniciando carregamento. Total carregando:', tilesLoading);
              
              // Sempre mostrar loading quando tiles estão carregando
              if (!$scope.loading) {
                $scope.loading = true;
                $scope.$apply();
              }
              
              // Cancelar timeout anterior se existir
              if ($scope.loadingTimeout) {
                $timeout.cancel($scope.loadingTimeout);
              }
              
              // Timeout de segurança apenas para casos extremos (30 segundos)
              $scope.loadingTimeout = $timeout(function() {
                if ($scope.loading && tilesLoading > 0) {
                  console.warn('WMS: Timeout de segurança - alguns tiles não responderam após 30s');
                  console.warn('WMS: Tiles ainda carregando:', tilesLoading);
                  $scope.loading = false;
                  tilesLoading = 0;
                }
              }, 30000);
            });
            
            // Evento quando todos os tiles são carregados (pode disparar prematuramente)
            $scope.wmsLayer.on('load', function() {
              console.log('WMS: Evento load disparado - tilesLoading:', tilesLoading);
              
              // Não confiar apenas neste evento, verificar contador de tiles
              if (tilesLoading === 0) {
                // Verificar se realmente todos os tiles foram carregados sem erro
                var hasErrors = false;
                for (var key in $scope.tileRetryCount) {
                  if ($scope.tileRetryCount[key] > 0 && $scope.tileRetryCount[key] <= $scope.maxRetries) {
                    hasErrors = true;
                    break;
                  }
                }
                
                if (!hasErrors && firstTileLoaded) {
                  $timeout(function() {
                    if (tilesLoading === 0 && $scope.loading) {
                      console.log('WMS: Confirmado - todos os tiles carregados');
                      $scope.loading = false;
                    }
                  }, 500);
                }
              }
            });
            
            // Gerenciar erros de tiles com retry
            $scope.wmsLayer.on('tileerror', function(error) {
              var tile = error.tile;
              var coords = error.coords;
              var tileKey = coords.x + ':' + coords.y + ':' + coords.z;
              
              // Ignorar se o tile está sendo retentado
              if (tile && tile._isRetrying) {
                console.log('WMS: Ignorando erro de tile em retry:', tileKey);
                return;
              }
              
              // Inicializar contador de retry para este tile
              if (!$scope.tileRetryCount[tileKey]) {
                $scope.tileRetryCount[tileKey] = 0;
              }
              
              // Verificar se já não excedeu o limite ANTES de incrementar
              if ($scope.tileRetryCount[tileKey] >= $scope.maxRetries) {
                console.log('WMS: Tile', tileKey, 'já excedeu limite de tentativas - ignorando');
                // Decrementar contador de tiles loading se necessário
                if (tilesLoading > 0) {
                  tilesLoading--;
                }
                // Limpar retry em andamento se existir
                delete retryInProgress[tileKey];
                
                // Verificar se deve esconder loading
                if (tilesLoading === 0) {
                  $timeout(function() {
                    if ($scope.loading) {
                      console.log('WMS: Escondendo loading após máximo de tentativas');
                      $scope.loading = false;
                    }
                  }, 500);
                }
                return;
              }
              
              // Verificar se já há retry em andamento para este tile
              if (retryInProgress[tileKey]) {
                console.log('WMS: Retry já em andamento para tile', tileKey, '- ignorando');
                return;
              }
              
              // Verificar limite global de retries
              if (totalRetries >= maxTotalRetries) {
                console.warn('WMS: Limite global de retries atingido (' + maxTotalRetries + ') - ignorando novos retries');
                // Decrementar contador de tiles loading
                if (tilesLoading > 0) {
                  tilesLoading--;
                }
                return;
              }
              
              // Incrementar contador APENAS se não está em retry
              $scope.tileRetryCount[tileKey]++;
              totalRetries++; // Incrementar contador global
              
              if ($scope.tileRetryCount[tileKey] <= $scope.maxRetries) {
                console.log('WMS: Erro no tile', tileKey, '- Tentativa', $scope.tileRetryCount[tileKey], 'de', $scope.maxRetries);
                
                // Log mais detalhado do erro na primeira tentativa
                if ($scope.tileRetryCount[tileKey] === 1) {
                  console.error('WMS: Detalhes do erro:', {
                    url: tile.src,
                    coords: coords,
                    error: error.error || 'Timeout ou erro de rede'
                  });
                }
                
                // Calcular delay com backoff exponencial (começando em 1s, máximo 8s)
                var delay = Math.min(1000 * Math.pow(2, $scope.tileRetryCount[tileKey] - 1), 8000);
                
                // Marcar retry em andamento
                retryInProgress[tileKey] = true;
                
                // Cancelar timeout anterior se existir
                if (tile._retryTimeout) {
                  clearTimeout(tile._retryTimeout);
                  tile._retryTimeout = null;
                }
                
                // Usar timeout com referência para poder cancelar se necessário
                tile._retryTimeout = setTimeout(function() {
                  // Limpar flag de retry em andamento
                  delete retryInProgress[tileKey];
                  
                  // Verificar se ainda deve tentar
                  if (tile && tile.src && $scope.wmsLayer && $scope.map && $scope.map.hasLayer($scope.wmsLayer) && 
                      $scope.tileRetryCount[tileKey] <= $scope.maxRetries) {
                    // Salvar URL original
                    var originalSrc = tile.src.split('&_retry=')[0].split('?_retry=')[0];
                    
                    // Adicionar flag para evitar loop infinito
                    tile._isRetrying = true;
                    
                    // Forçar novo carregamento alterando src
                    tile.src = '';
                    setTimeout(function() {
                      if ($scope.wmsLayer && $scope.map && $scope.map.hasLayer($scope.wmsLayer)) {
                        tile.src = originalSrc + (originalSrc.indexOf('?') === -1 ? '?' : '&') + '_retry=' + Date.now();
                        // Remover flag após definir novo src
                        setTimeout(function() {
                          if (tile) {
                            tile._isRetrying = false;
                          }
                        }, 100);
                      }
                    }, 50);
                  } else {
                    // Se não vai mais tentar, garantir que o tile seja contabilizado
                    if (tilesLoading > 0) {
                      tilesLoading--;
                    }
                  }
                }, delay);
              } else {
                console.error('WMS: Tile', tileKey, 'falhou após', $scope.maxRetries, 'tentativas');
                
                // Decrementar contador de tiles loading
                if (tilesLoading > 0) {
                  tilesLoading--;
                }
                
                // Marcar o tile como falho permanentemente
                if (tile && tile.style) {
                  tile.style.opacity = '0.3';
                  tile.style.backgroundColor = '#ffcccc';
                }
                
                // Limpar flag de retry
                delete retryInProgress[tileKey];
                
                // Verificar se deve esconder loading após falhas
                if (tilesLoading === 0) {
                  $timeout(function() {
                    if ($scope.loading) {
                      console.log('WMS: Escondendo loading após falhas de tiles');
                      $scope.loading = false;
                    }
                  }, 500);
                }
              }
            });
            
            // Resetar contadores quando tile carrega com sucesso
            $scope.wmsLayer.on('tileload', function(e) {
              var coords = e.coords;
              var tileKey = coords.x + ':' + coords.y + ':' + coords.z;
              
              // Marcar que pelo menos um tile foi carregado
              firstTileLoaded = true;
              
              // Decrementar contador
              if (tilesLoading > 0) {
                tilesLoading--;
              }
              
              console.log('WMS: Tile carregado com sucesso. Restam:', tilesLoading);
              
              // Limpar contador de retry para este tile
              if ($scope.tileRetryCount[tileKey]) {
                delete $scope.tileRetryCount[tileKey];
              }
              
              // Verificar se deve esconder loading
              if (tilesLoading === 0) {
                // Pequeno delay para garantir que não há mais tiles iniciando
                $timeout(function() {
                  if (tilesLoading === 0 && $scope.loading) {
                    console.log('WMS: Todos os tiles carregados - escondendo loading');
                    $scope.loading = false;
                  }
                }, 500);
              } else {
                console.log('WMS: Ainda carregando', tilesLoading, 'tiles');
              }
            });
            
            // Log para debug
            console.log('WMS Layer adicionado ao mapa:', $scope.wmsLayer);
            
            // Forçar atualização do layer
            setTimeout(function() {
              if ($scope.wmsLayer && $scope.map) {
                $scope.wmsLayer.redraw();
                $scope.map.invalidateSize();
              }
            }, 500);
            
            // Garantir que o marcador esteja sempre no topo
            if ($scope.marker && $scope.markerInMap) {
              $scope.marker.setZIndexOffset(1000);
            }
            
            // Fallback: se nenhum tile começar a carregar em 3 segundos, esconder loading
            $timeout(function() {
              if ($scope.loading && tilesLoading === 0) {
                console.log('WMS: Nenhum tile iniciou carregamento após 3s - escondendo loading');
                $scope.loading = false;
              }
            }, 3000);
            
            }, 100); // Fechando o timeout do delay
          };
          
          // Inicializar mapa
          $timeout(function() {
            var mapElement = $element[0].querySelector('#wms-map-' + $scope.$id);
            if (!mapElement) {
              console.error('Elemento do mapa WMS não encontrado!');
              return;
            }
            
            // Criar mapa
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
            
            // Adicionar marcador
            $scope.marker = L.marker([$scope.lat, $scope.lon], {
              icon: L.icon({
                iconUrl: 'assets/marker2.png',
                iconSize: [42, 42]
              }),
              zIndexOffset: 1000
            }).addTo($scope.map);
            
            // Toggle do marcador ao clicar no mapa
            $scope.map.on('click', function() {
              if ($scope.markerInMap) {
                $scope.map.removeLayer($scope.marker);
                $scope.markerInMap = false;
              } else {
                $scope.map.addLayer($scope.marker);
                $scope.markerInMap = true;
              }
            });
            
            // Observar mudanças
            var unwatch = $scope.$watchGroup(['period', 'year', 'wmsConfig'], function(newValues, oldValues) {
              console.log('WMS: Watch disparado - Nova config:', {
                period: newValues[0],
                year: newValues[1],
                wmsConfig: newValues[2] ? 'presente' : 'ausente'
              });
              console.log('WMS: Antiga config:', {
                period: oldValues[0],
                year: oldValues[1],
                wmsConfig: oldValues[2] ? 'presente' : 'ausente'
              });
              
              if ($scope.period && $scope.year && $scope.wmsConfig) {
                $scope.updateWmsLayer();
              }
            });
            
            // Cleanup completo quando o scope é destruído
            $scope.$on('$destroy', function() {
              console.log('WMS: Destruindo componente');
              
              // Cancelar watch
              if (unwatch) {
                unwatch();
              }
              
              // Cancelar timeout de loading
              if ($scope.loadingTimeout) {
                $timeout.cancel($scope.loadingTimeout);
              }
              
              // Remover layer WMS
              if ($scope.wmsLayer && $scope.map) {
                $scope.map.removeLayer($scope.wmsLayer);
                $scope.wmsLayer = null;
              }
              
              // Remover mapa
              if ($scope.map) {
                $scope.map.remove();
                $scope.map = null;
              }
            });
            
            // Adicionar evento para garantir que o marcador permaneça visível
            $scope.map.on('layeradd', function(e) {
              if (e.layer !== $scope.marker && $scope.marker && $scope.markerInMap) {
                setTimeout(function() {
                  if ($scope.marker && $scope.map.hasLayer($scope.marker)) {
                    $scope.marker.setZIndexOffset(1000);
                  }
                }, 50);
              }
            });
            
            // Carregar layer inicial
            if ($scope.period && $scope.year && $scope.wmsConfig) {
              $scope.updateWmsLayer();
            }
            
            // Adicionar controle de escala
            L.control.scale({ metric: true, imperial: false }).addTo($scope.map);
            
            // Forçar recalculo do tamanho do mapa
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
                if ($scope.marker && $scope.markerInMap) {
                  $scope.marker.setZIndexOffset(1000);
                }
              }
            }, 100);
            
            
            // Check adicional para cenários com múltiplos mapas
            setTimeout(function() {
              if ($scope.map) {
                $scope.map.invalidateSize();
                if ($scope.marker && $scope.markerInMap && !$scope.map.hasLayer($scope.marker)) {
                  $scope.map.addLayer($scope.marker);
                }
              }
            }, 500);
            
          }, 0);
        }
      };
    })
    .directive('visparamSelector', function() {
      return {
        template: `
          <div class="visparam-section">
            <style>
              .visparam-section {
                display: inline-flex;
                align-items: center;
                margin: 0;
                vertical-align: middle;
              }
              
              .visparam-header {
                display: none;
              }
              
              .visparam-buttons {
                display: inline-flex;
                align-items: stretch;
                border-radius: 20px;
                background: #f0f0f0;
                padding: 3px;
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
              }
              
              .visparam-btn {
                padding: 5px 16px;
                border: none;
                background: transparent;
                color: #666;
                border-radius: 17px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 12px;
                font-weight: 500;
                position: relative;
                line-height: 1.4;
                white-space: nowrap;
                outline: none;
                text-decoration: none;
                margin: 0 2px;
              }
              
              .visparam-btn:first-child {
                margin-left: 0;
              }
              
              .visparam-btn:last-child {
                margin-right: 0;
              }
              
              .visparam-btn:hover {
                color: #333;
              }
              
              .visparam-btn.active {
                background: #fff;
                color: #337ab7;
                font-weight: 600;
                box-shadow: 0 1px 3px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1);
              }
              
              .visparam-btn.active:hover {
                background: #fff;
                color: #286090;
              }
              
              /* Tooltip wrapper */
              .visparam-btn {
                position: relative;
              }
              
              .visparam-tooltip {
                position: absolute;
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%) scale(0.95);
                background: #333;
                color: #fff;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 11px;
                white-space: normal;
                width: max-content;
                max-width: 200px;
                opacity: 0;
                pointer-events: none;
                transition: all 0.15s ease;
                z-index: 1000;
                font-weight: normal;
                line-height: 1.3;
                text-align: center;
              }
              
              .visparam-btn:hover .visparam-tooltip {
                opacity: 1;
                transform: translateX(-50%) scale(1);
              }
              
              /* Arrow do tooltip */
              .visparam-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 4px solid transparent;
                border-top-color: #333;
              }
              
              /* Remover badges de tags para simplificar */
              .visparam-tags {
                display: none;
              }
              
              /* Indicador animado para seleção ativa */
              .visparam-btn {
                overflow: hidden;
              }
              
              /* Efeito de scale suave ao clicar */
              .visparam-btn:active {
                transform: scale(0.95);
              }
              
              /* Responsividade */
              @media (max-width: 768px) {
                .visparam-buttons {
                  flex-wrap: wrap;
                  border-radius: 12px;
                }
                
                .visparam-btn {
                  font-size: 11px;
                  padding: 4px 12px;
                  border-radius: 10px;
                }
              }
            </style>
            
            <div class="visparam-header" ng-if="showHeader">
              <i class="fa" ng-class="headerIcon || 'fa-satellite-dish'"></i>
              <span>{{headerText || 'Visualização'}}</span>
            </div>
            
            <div class="visparam-buttons">
              <button ng-repeat="vp in visparams"
                      class="visparam-btn"
                      ng-class="{'active': isSelected(vp)}"
                      ng-click="selectVisparam(vp)"
                      type="button">
                {{vp.display_name || vp.name}}
                <span class="visparam-tooltip" ng-if="vp.description">
                  {{vp.description}}
                </span>
              </button>
            </div>
          </div>
        `,
        restrict: 'E',
        scope: {
          visparams: '=',
          ngModel: '=',
          onChange: '&',
          showHeader: '@',
          headerText: '@',
          headerIcon: '@'
        },
        link: function(scope, element) {
          // Verificar se o visparam está selecionado
          scope.isSelected = function(vp) {
            if (!vp || !scope.ngModel) return false;
            
            // Suportar comparação tanto por string (name) quanto por objeto
            if (typeof scope.ngModel === 'string') {
              return vp.name === scope.ngModel;
            } else if (scope.ngModel && scope.ngModel.name) {
              return vp.name === scope.ngModel.name;
            }
            return false;
          };
          
          // Selecionar visparam
          scope.selectVisparam = function(vp) {
            if (!vp) return;
            
            // Log para debug
            console.log('Selecionando visparam:', vp.name, 'Display:', vp.display_name);
            
            // Sempre atribuir apenas o name (string)
            scope.ngModel = vp.name;
            
            if (scope.onChange) {
              scope.onChange({value: vp.name});
            }
          };
          
          // Watch para garantir que temos sempre o name correto
          scope.$watch('ngModel', function(newVal, oldVal) {
            if (newVal !== oldVal) {
              console.log('ngModel mudou de', oldVal, 'para', newVal);
            }
          });
        }
      };
    });
