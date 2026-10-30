'use strict';

/**
 * sampleMarkerService: cria a camada Leaflet que representa a amostra em uma
 * célula da grade conforme a configuração da campanha (SampleMarkerCore):
 * marcador tradicional (L.Marker), quadrado (SampleSquare) ou círculo
 * (SampleCircle).
 *
 * As camadas vetoriais implementam setLatLng e setZIndexOffset para que as
 * diretivas de mapa as tratem exatamente como tratam o marcador (recentrar
 * ao trocar de ponto, trazer ao topo após carregar tiles). As camadas
 * vetoriais vivem no overlayPane, sempre acima dos tiles.
 */
angular.module('application').factory('sampleMarkerService', function () {
    var core = window.SampleMarkerCore;

    // O renderer SVG só cria o elemento da camada no onAdd; antes disso
    // bringToFront desreferenciaria um elemento inexistente.
    function bringToFrontWhenOnMap() {
        if (this._map) {
            this.bringToFront();
        }
        return this;
    }

    var SampleSquare = L.Polygon.extend({
        initialize: function (latlng, radiusMeters, options) {
            var center = L.latLng(latlng);
            this._radiusMeters = radiusMeters;
            L.Polygon.prototype.initialize.call(this, core.squareLatLngs(center.lat, center.lng, radiusMeters), options);
        },
        setLatLng: function (latlng) {
            var center = L.latLng(latlng);
            return this.setLatLngs(core.squareLatLngs(center.lat, center.lng, this._radiusMeters));
        },
        setZIndexOffset: bringToFrontWhenOnMap
    });

    var SampleCircle = L.Circle.extend({
        setZIndexOffset: bringToFrontWhenOnMap
    });

    function createLayer(latlng, config, options) {
        var settings = core.normalize(config);
        if (settings.symbol === 'square') {
            return new SampleSquare(latlng, settings.radiusMeters, core.pathStyle(settings));
        }
        if (settings.symbol === 'circle') {
            return new SampleCircle(latlng, L.extend({ radius: settings.radiusMeters }, core.pathStyle(settings)));
        }
        return L.marker(latlng, {
            icon: L.icon({
                iconUrl: (options && options.iconUrl) || 'assets/marker2.png',
                iconSize: [42, 42]
            }),
            zIndexOffset: 1000
        });
    }

    return {
        createLayer: createLayer,
        core: core
    };
});
