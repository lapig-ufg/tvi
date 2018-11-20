'use strict';
Application
  .directive('numberFormat', function($filter) {
    return {
      require: 'ngModel',
      link: function(scope, element, attrs, ngModel) {

        var prepare = function(value) {
          var numb = Number(value);
          if (isNaN(numb)) {
            return value;
          }
          return Number(numb).toFixed(2);
        }

        var parse = function(viewValue, noRender) {
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

        ngModel.doRender = function() {
          var clean = parse(prepare(ngModel.$viewValue), true);

          if (!clean) {
            return element.val('0,00');
          }
          element.val($filter('number')(clean, 2));
        }

        scope.$watch(attrs.ngModel, function() {
          ngModel.doRender();
        });
      }
    }
  })
  .directive('inspectionMap', function() {
    return {
      template: '<div id="map-{{::$id}}" style="width: 100%; height: 300px;"></div>',
      scope: {
        lon: '=',
        lat: '=',
        tmsUrl: '@',
        zoom: '=',
        bounds: '='
      },
      controller: function($scope, $element) {
        angular.element($element).ready(function () {

          $scope.tmsLayer = new L.ImageOverlay($scope.tmsUrl, $scope.bounds);
          $scope.marker = L.marker([$scope.lat, $scope.lon], {
            icon: L.icon({
              iconUrl: 'assets/marker.png',
              iconSize: [42, 42]
            })
          });

          $scope.markerInMap = true;
          $scope.map = new L.map($element[0].childNodes[0], {
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
                new L.control.scale({ metric:true, imperial: false })
              ]
          });
          
          $scope.map.on('click', function() {
            if($scope.markerInMap) {
              $scope.map.removeLayer($scope.marker);
              $scope.markerInMap = false;
            } else {
              $scope.map.addLayer($scope.marker);
              $scope.markerInMap = true;
            }
          });

          L.control.scale({ metric:true, imperial: false }).addTo($scope.map);

        });
      }
    }
  });