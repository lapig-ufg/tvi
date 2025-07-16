'use strict';

Application.directive('olInspectionMap', function () {
  return {
    template: '<div id="ol-map-{{::$id}}" style="width: 100%; height: 100%;"></div>',
    scope: {
      lon: '=',
      lat: '=',
      tmsUrl: '=',
      zoom: '=',
      bounds: '='
    },
    controller: function ($scope, $element) {
      angular.element($element).ready(function () {
        
        var mapElement = $element[0].querySelector(`#ol-map-${$scope.$id}`);
        if (!mapElement) {
          console.error('Elemento do mapa OpenLayers não encontrado!');
          return;
        }

        // Verificar se ol está disponível
        if (typeof ol === 'undefined') {
          console.error('OpenLayers não está carregado');
          return;
        }

        // Converter coordenadas para EPSG:3857 (Web Mercator)
        var centerCoords = ol.proj.fromLonLat([$scope.lon, $scope.lat]);
        
        // Converter bounds para EPSG:3857 se fornecidos
        var extent = null;
        if ($scope.bounds && $scope.bounds.length === 4) {
          // bounds formato: [south, west, north, east]
          var southWest = ol.proj.fromLonLat([$scope.bounds[1], $scope.bounds[0]]);
          var northEast = ol.proj.fromLonLat([$scope.bounds[3], $scope.bounds[2]]);
          extent = [southWest[0], southWest[1], northEast[0], northEast[1]];
        }

        // Criar layer de imagem usando ImageStatic para uma única imagem
        var imageLayer = new ol.layer.Image({
          source: new ol.source.ImageStatic({
            url: $scope.tmsUrl,
            imageExtent: extent || ol.proj.transformExtent(
              [$scope.lon - 0.02, $scope.lat - 0.02, $scope.lon + 0.02, $scope.lat + 0.02],
              'EPSG:4326', 'EPSG:3857'
            ),
            projection: 'EPSG:3857'
          })
        });

        // Criar marcador
        var markerFeature = new ol.Feature({
          geometry: new ol.geom.Point(centerCoords)
        });

        var markerStyle = new ol.style.Style({
          image: new ol.style.Icon({
            src: 'assets/marker.png',
            scale: 1,
            anchor: [0.5, 1]
          })
        });

        markerFeature.setStyle(markerStyle);

        var vectorSource = new ol.source.Vector({
          features: [markerFeature]
        });

        var vectorLayer = new ol.layer.Vector({
          source: vectorSource
        });

        // Criar mapa com configurações similares ao Leaflet
        $scope.map = new ol.Map({
          target: mapElement,
          layers: [imageLayer, vectorLayer],
          view: new ol.View({
            center: centerCoords,
            zoom: $scope.zoom,
            minZoom: $scope.zoom,
            maxZoom: $scope.zoom + 2,
            projection: 'EPSG:3857'
          }),
          interactions: ol.interaction.defaults({
            dragPan: false,
            doubleClickZoom: false,
            mouseWheelZoom: false
          }),
          controls: ol.control.defaults().extend([
            new ol.control.ScaleLine({
              units: 'metric'
            })
          ])
        });

        // Toggle do marcador ao clicar
        $scope.markerVisible = true;
        $scope.map.on('click', function () {
          if ($scope.markerVisible) {
            vectorLayer.setVisible(false);
            $scope.markerVisible = false;
          } else {
            vectorLayer.setVisible(true);
            $scope.markerVisible = true;
          }
        });

        // Redimensionar mapa após inicialização
        setTimeout(function() {
          if ($scope.map) {
            $scope.map.updateSize();
          }
        }, 200);

        setTimeout(function() {
          if ($scope.map) {
            $scope.map.updateSize();
          }
        }, 500);

        // Ajustar quando o extent for definido
        if (extent) {
          setTimeout(function() {
            if ($scope.map) {
              $scope.map.getView().fit(extent, { padding: [10, 10, 10, 10] });
            }
          }, 100);
        }
      });
    }
  }
});