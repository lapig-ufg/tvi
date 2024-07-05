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
        template: '<div id="map-{{::$id}}" style="width: 100%; height: 300px;"></div>',
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
              $scope.tileLayer = L.tileLayer($scope.mosaicUrl).addTo($scope.map);
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
    .directive('sentinelMap', function($timeout, $http) {
      return {
        template: `
            <div>
                <h4 style="text-align: center">Imagem COPERNICUS/S2_HARMONIZED {{::period}} - {{::year}}</h4>
                <div style="text-align: center">
                    <label ng-repeat="param in visparams" class="radio-visparam">
                        <input type="radio" ng-model="$parent.selectedVisparam" ng-value="param" ng-change="updateTileLayer()">
                        {{param}}
                    </label>
                </div>
                <div id="sentinel-map-{{::$id}}" style="width: 100%; height: 300px;"></div>
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
        controller: function($scope, $element) {
          console.log('selectedVisparam', $scope.visparams)

          $scope.selectedVisparam = $scope.visparams[0]; // Seleciona o primeiro visparam por padrão
          $timeout(function() {
            var mapElement = $element[0].querySelector(`#sentinel-map-${$scope.$id}`);
            if (!mapElement) {
              console.error('Elemento do mapa não encontrado!');
              return;
            }

            if (!$scope.period || !$scope.year) {
              console.error('Parâmetros de período ou ano não disponíveis!');
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

            $scope.updateTileLayer = function() {
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

              var tileUrl = `https://tm{s}.lapig.iesa.ufg.br/api/layers/s2_harmonized/{x}/{y}/{z}?visparam=${$scope.selectedVisparam}&period=${$scope.period}&year=${$scope.year}`;
              $scope.tileLayer = L.tileLayer(tileUrl, {
                subdomains: ['1', '2', '3', '4', '5'],
                attribution: `${$scope.period} - ${$scope.year}`,
                attributionControl: true,
              }).addTo($scope.map);
            };

            $scope.$watchGroup(['period', 'year'], function(newVals) {
              if (newVals[0] && newVals[1]) {
                $scope.updateTileLayer();
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

            $scope.updateTileLayer();

            L.control.scale({ metric: true, imperial: false }).addTo($scope.map);
          }, 0);
        }
      }
    })
  .directive('combinedMaps', function() {
      return {
        template: `
                <div style="display: flex; justify-content: space-between;">
                    <div style="flex: 1; margin-right: 10px;">
                        <small  class="text-center">Imagem da Campanha</small>
                        <inspection-map lon="lon" lat="lat" tms-url="tmsUrl" zoom="zoom" bounds="bounds"></inspection-map>
                    </div>
                    <div style="flex: 1;">
                        <small class="text-center">Imagen Planet</small>
                        <planet-map lon="lon" lat="lat" zoom="zoom" mosaic-url="mosaicUrl"></planet-map>
                    </div>
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
    });