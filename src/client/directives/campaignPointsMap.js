'use strict';

/**
 * Diretiva `campaignPointsMap`
 *
 * Renderiza a aba "Visualização Espacial" do modal de pontos da campanha
 * (TKT-000032). Consome o endpoint `/api/campaigns/:id/points/geojson` e
 * plota os pontos em um mapa Leaflet com agrupamento (markercluster),
 * popup por ponto e legenda por status.
 *
 * Padrão de construção do mapa segue o utilizado em
 * `controllers/cache-manager-tiles.js:936` (L.map + L.tileLayer +
 * L.markerClusterGroup + L.circleMarker). A destruição é delegada ao
 * helper global `safeDestroyMap` definido em `others/directives.js:15`,
 * que neutraliza callbacks pendentes do Leaflet <= 1.9.4.
 *
 * Entradas:
 *  - campaign-id: ID da campanha (obrigatório).
 *  - active:      expressão booleana — a renderização só ocorre quando
 *                 a aba está visível (`true`). Isso evita criar mapa
 *                 antes do container ter dimensões (o Leaflet precisa de
 *                 width/height > 0 em display:block).
 *
 * Segurança: popup e legenda são construídos via DOM API (createElement +
 * textContent). Nenhum conteúdo externo é interpolado em innerHTML —
 * defesa em profundidade contra XSS caso um ID de ponto ou propriedade
 * eventualmente venha de fonte não confiável.
 */
angular.module('application')
.directive('campaignPointsMap', function($http, $timeout) {
    return {
        restrict: 'E',
        scope: {
            campaignId: '@',
            active: '='
        },
        template:
            '<div class="cpm-root">' +
            '  <div ng-if="state.loading" class="cpm-state cpm-loading">' +
            '    <div class="loading-spinner"></div>' +
            '    <p>Carregando pontos no mapa...</p>' +
            '  </div>' +
            '  <div ng-if="!state.loading && state.error" class="cpm-state cpm-error">' +
            '    <i class="glyphicon glyphicon-exclamation-sign"></i>' +
            '    <p ng-bind="state.error"></p>' +
            '  </div>' +
            '  <div ng-if="!state.loading && !state.error && state.empty" class="cpm-state cpm-empty">' +
            '    <i class="glyphicon glyphicon-map-marker"></i>' +
            '    <p>Esta campanha ainda não possui pontos para visualização.</p>' +
            '  </div>' +
            '  <div ng-if="!state.loading && !state.error && !state.empty && state.truncated" class="cpm-warning">' +
            '    <i class="glyphicon glyphicon-info-sign"></i>' +
            '    Exibindo apenas os primeiros {{ state.returned | number }} pontos de um total de {{ state.total | number }} (limite de segurança).' +
            '  </div>' +
            '  <div class="cpm-map-wrapper" ng-show="!state.loading && !state.error && !state.empty">' +
            '    <div class="cpm-map" id="{{ mapId }}"></div>' +
            '    <div class="cpm-summary" ng-if="state.loaded">' +
            '      <span><strong>{{ state.returned | number }}</strong> pontos plotados</span>' +
            '      <span ng-if="!state.truncated">de <strong>{{ state.total | number }}</strong></span>' +
            '    </div>' +
            '  </div>' +
            '</div>',
        link: function(scope, element) {
            // Cores por status — alinhadas com os badges do modal
            // (ver .points-modal-wide .status-badge.* em campaign-points-modal.tpl.html)
            var STATUS_META = {
                'completed':   { color: '#15803d', label: 'Completo' },
                'in-progress': { color: '#b45309', label: 'Em andamento' },
                'not-started': { color: '#6b7280', label: 'Não iniciado' }
            };

            scope.mapId = 'campaign-points-map-' + Math.random().toString(36).slice(2, 10);
            scope.state = {
                loading: false,
                loaded: false,
                error: null,
                empty: false,
                truncated: false,
                total: 0,
                returned: 0
            };

            var _map = null;
            var _markerCluster = null;
            var _legend = null;
            var _destroyed = false;
            var _initialized = false;

            function destroyMap() {
                if (_map) {
                    try {
                        if (_legend) {
                            _map.removeControl(_legend);
                        }
                    } catch (ignored) {}
                    // safeDestroyMap é exposto globalmente em others/directives.js
                    if (typeof safeDestroyMap === 'function') {
                        safeDestroyMap(_map);
                    } else {
                        try { _map.remove(); } catch (ignored) {}
                    }
                }
                _map = null;
                _markerCluster = null;
                _legend = null;
                _initialized = false;
            }

            // Cria elementos via DOM API — nunca usa innerHTML com dados dinâmicos.
            function createLine(labelText, valueText, valueStyle) {
                var line = document.createElement('div');
                if (labelText) {
                    var label = document.createElement('strong');
                    label.textContent = labelText + ' ';
                    line.appendChild(label);
                }
                var value = document.createElement('span');
                value.textContent = valueText == null ? '' : String(valueText);
                if (valueStyle) {
                    Object.keys(valueStyle).forEach(function(k) {
                        value.style[k] = valueStyle[k];
                    });
                }
                line.appendChild(value);
                return line;
            }

            function createTag(text, cssClass) {
                var wrap = document.createElement('div');
                var tag = document.createElement('span');
                tag.className = 'cpm-tag' + (cssClass ? ' ' + cssClass : '');
                tag.textContent = text;
                wrap.appendChild(tag);
                return wrap;
            }

            function buildPopupNode(feature) {
                var props = feature.properties || {};
                var meta = STATUS_META[props.status] || STATUS_META['not-started'];
                var coords = feature.geometry && feature.geometry.coordinates;
                var lon = coords ? Number(coords[0]) : null;
                var lat = coords ? Number(coords[1]) : null;

                var root = document.createElement('div');
                root.className = 'cpm-popup';

                var title = document.createElement('div');
                title.className = 'cpm-popup-title';
                title.textContent = props._id ? String(props._id) : '—';
                root.appendChild(title);

                root.appendChild(createLine('Status:', meta.label, { color: meta.color, fontWeight: '500' }));
                root.appendChild(createLine('Inspeções:', props.inspectionCount || 0));

                if (props.pointEdited) {
                    root.appendChild(createTag('Ponto editado'));
                }
                if (props.hasClassConsolidated) {
                    root.appendChild(createTag('Classe consolidada', 'cpm-tag-ok'));
                }
                if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
                    var coord = document.createElement('div');
                    coord.className = 'cpm-popup-coord';
                    coord.textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
                    root.appendChild(coord);
                }

                return root;
            }

            function addLegend(map) {
                if (!L || !L.control) return null;
                var ctrl = L.control({ position: 'bottomright' });
                ctrl.onAdd = function() {
                    var div = L.DomUtil.create('div', 'cpm-legend');
                    var h = document.createElement('h4');
                    h.textContent = 'Status';
                    div.appendChild(h);

                    Object.keys(STATUS_META).forEach(function(key) {
                        var m = STATUS_META[key];
                        var item = document.createElement('div');
                        item.className = 'cpm-legend-item';

                        var sw = document.createElement('span');
                        sw.className = 'cpm-legend-swatch';
                        sw.style.background = m.color;
                        item.appendChild(sw);

                        var lbl = document.createElement('span');
                        lbl.textContent = m.label;
                        item.appendChild(lbl);

                        div.appendChild(item);
                    });
                    return div;
                };
                ctrl.addTo(map);
                return ctrl;
            }

            function renderMap(geojson) {
                if (_destroyed) return;
                if (typeof L === 'undefined') {
                    scope.state.error = 'Biblioteca Leaflet indisponível';
                    return;
                }

                // Garante que o container existe no DOM (ng-show usa display:none,
                // mas o elemento permanece no DOM — portanto getElementById funciona)
                var container = document.getElementById(scope.mapId);
                if (!container) {
                    // Aguarda próximo ciclo se o container ainda não foi renderizado
                    $timeout(function() { renderMap(geojson); }, 50);
                    return;
                }

                destroyMap();

                _map = L.map(container, {
                    center: [-15.0, -50.0],
                    zoom: 4,
                    zoomControl: true,
                    preferCanvas: true
                });

                L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                    attribution: '© Google Maps',
                    maxZoom: 18
                }).addTo(_map);

                _markerCluster = L.markerClusterGroup({
                    chunkedLoading: true,
                    chunkInterval: 100,
                    maxClusterRadius: 60
                });

                var features = (geojson && geojson.features) || [];
                var bounds = null;

                for (var i = 0; i < features.length; i++) {
                    var feat = features[i];
                    var coords = feat.geometry && feat.geometry.coordinates;
                    if (!coords || coords.length < 2) continue;

                    var lon = Number(coords[0]);
                    var lat = Number(coords[1]);
                    if (isNaN(lon) || isNaN(lat)) continue;

                    var meta = STATUS_META[feat.properties && feat.properties.status] || STATUS_META['not-started'];

                    var marker = L.circleMarker([lat, lon], {
                        radius: 5,
                        fillColor: meta.color,
                        color: '#ffffff',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.85
                    });

                    // Closure preserva a feature específica do ponto
                    (function(fixedFeat) {
                        marker.bindPopup(function() {
                            return buildPopupNode(fixedFeat);
                        });
                    })(feat);

                    _markerCluster.addLayer(marker);

                    if (!bounds) {
                        bounds = L.latLngBounds([[lat, lon], [lat, lon]]);
                    } else {
                        bounds.extend([lat, lon]);
                    }
                }

                _map.addLayer(_markerCluster);
                _legend = addLegend(_map);

                if (bounds && bounds.isValid()) {
                    _map.fitBounds(bounds.pad(0.15));
                }

                // invalidateSize — protege contra o container ter nascido com width=0
                // quando a aba foi trocada via ng-show
                $timeout(function() {
                    if (_destroyed || !_map) return;
                    _map.invalidateSize();
                }, 100);

                _initialized = true;
            }

            function loadData() {
                if (!scope.campaignId) {
                    scope.state.error = 'ID da campanha não informado';
                    return;
                }
                scope.state.loading = true;
                scope.state.loaded = false;
                scope.state.error = null;
                scope.state.empty = false;
                scope.state.truncated = false;

                var url = '/api/campaigns/' + encodeURIComponent(scope.campaignId) + '/points/geojson';
                $http.get(url).then(function(response) {
                    if (_destroyed) return;
                    var data = response.data || {};
                    scope.state.total = data.total || 0;
                    scope.state.returned = data.returned || 0;
                    scope.state.truncated = !!data.truncated;

                    if (!data.features || data.features.length === 0) {
                        scope.state.empty = true;
                        scope.state.loading = false;
                        scope.state.loaded = true;
                        destroyMap();
                        return;
                    }

                    scope.state.loading = false;
                    scope.state.loaded = true;

                    // Próximo tick para garantir que o ng-show torne o wrapper visível
                    $timeout(function() { renderMap(data); }, 0);
                }, function(err) {
                    if (_destroyed) return;
                    scope.state.loading = false;
                    if (err && err.status === 404) {
                        scope.state.error = 'Campanha não encontrada.';
                    } else if (err && err.status === 401) {
                        scope.state.error = 'Sessão expirada — faça login novamente.';
                    } else {
                        scope.state.error = 'Falha ao carregar pontos da campanha.';
                    }
                });
            }

            // Carrega apenas quando a aba fica ativa — evita requisição desnecessária
            // e garante que o container tenha dimensões no momento da inicialização.
            scope.$watch('active', function(isActive) {
                if (_destroyed) return;
                if (isActive && !_initialized && !scope.state.loading) {
                    loadData();
                } else if (isActive && _map) {
                    // Usuário retornou à aba — revalida tamanho
                    $timeout(function() {
                        if (_destroyed || !_map) return;
                        _map.invalidateSize();
                    }, 50);
                }
            });

            scope.$on('$destroy', function() {
                _destroyed = true;
                destroyMap();
            });
        }
    };
});
