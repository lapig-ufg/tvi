'use strict';

/**
 * sampleMarkerService: cria a camada Leaflet que representa a amostra em uma
 * célula da grade conforme a configuração da campanha (SampleMarkerCore):
 * marcador tradicional (L.Marker), quadrado (SampleSquare) ou círculo
 * (SampleCircle), estes com a cruz opcional no ponto central.
 *
 * As camadas vetoriais implementam setLatLng e setZIndexOffset para que as
 * diretivas de mapa as tratem exatamente como tratam o marcador (recentrar
 * ao trocar de ponto, trazer ao topo após carregar tiles). As camadas
 * vetoriais vivem no overlayPane, sempre acima dos tiles; a cruz central é
 * um L.Marker no markerPane, acima da forma, que entra e sai do mapa junto
 * com ela (inclusive no Shift + clique que oculta a amostra).
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

    function createCross(latlng, iconUrl, options) {
        return L.marker(latlng, L.extend({
            icon: L.icon({
                iconUrl: iconUrl,
                iconSize: [42, 42]
            }),
            zIndexOffset: 1000
        }, options));
    }

    // A forma não é interativa (preserva arrastar e zoom da célula), por isso
    // a dica de tooltip só aparece quando há cruz para recebê-la.
    function withCenterMark(Base) {
        return Base.extend({
            onAdd: function (map) {
                Base.prototype.onAdd.call(this, map);
                if (this._centerMarker) {
                    map.addLayer(this._centerMarker);
                }
            },
            onRemove: function (map) {
                Base.prototype.onRemove.call(this, map);
                if (this._centerMarker) {
                    map.removeLayer(this._centerMarker);
                }
            },
            setLatLng: function (latlng) {
                Base.prototype.setLatLng.call(this, latlng);
                if (this._centerMarker) {
                    this._centerMarker.setLatLng(latlng);
                }
                return this;
            },
            setZIndexOffset: function (offset) {
                bringToFrontWhenOnMap.call(this);
                if (this._centerMarker) {
                    this._centerMarker.setZIndexOffset(offset);
                }
                return this;
            },
            bindTooltip: function (content, options) {
                if (this._centerMarker) {
                    this._centerMarker.bindTooltip(content, options);
                    return this;
                }
                return Base.prototype.bindTooltip.call(this, content, options);
            }
        });
    }

    var SampleSquare = withCenterMark(L.Polygon.extend({
        initialize: function (latlng, radiusMeters, options) {
            var center = L.latLng(latlng);
            this._radiusMeters = radiusMeters;
            L.Polygon.prototype.initialize.call(this, core.squareLatLngs(center.lat, center.lng, radiusMeters), options);
        },
        setLatLng: function (latlng) {
            var center = L.latLng(latlng);
            return this.setLatLngs(core.squareLatLngs(center.lat, center.lng, this._radiusMeters));
        }
    }));

    var SampleCircle = withCenterMark(L.Circle);

    function createLayer(latlng, config, options) {
        var settings = core.normalize(config);
        var shape = null;
        if (settings.symbol === 'square') {
            shape = new SampleSquare(latlng, settings.radiusMeters, core.pathStyle(settings));
        } else if (settings.symbol === 'circle') {
            shape = new SampleCircle(latlng, L.extend({ radius: settings.radiusMeters }, core.pathStyle(settings)));
        }
        if (!shape) {
            return createCross(latlng, (options && options.iconUrl) || 'assets/marker2.png');
        }
        var centerIconUrl = core.centerMarkIconUrl(settings);
        if (centerIconUrl) {
            // A cruz recebe o mouse por causa da dica; com a propagação, o clique
            // também chega ao mapa, como acontecia com a forma não interativa, e
            // o Shift + clique sobre ela continua ocultando a amostra.
            shape._centerMarker = createCross(latlng, centerIconUrl, { bubblingMouseEvents: true });
        }
        return shape;
    }

    return {
        createLayer: createLayer,
        core: core
    };
});
