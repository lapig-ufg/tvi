'use strict';

angular.module('application').directive('bdcMap', function ($window, $timeout, bdcImageryService, bdcTileQueue, mapSyncService, sampleMarkerService) {
    return {
        restrict: 'E',
        scope: { point: '=', year: '=', period: '=', config: '=', profile: '=', selectionId: '=?', historical: '=?',
            selection: '=?', preview: '=?', side: '@?', onViewed: '&?', onCompare: '&?' },
        template: "<div class=\"bdc-card\" ng-keydown=\"informationKeydown($event)\">" +
            "<div class=\"bdc-leaflet-map\" aria-label=\"BDC\"></div>" +
            "<div class=\"bdc-card-status\" role=\"status\" ng-if=\"statusKey !== 'BDC.READY'\">{{ statusKey | i18n }} <button type=\"button\" class=\"btn btn-default btn-sm\" ng-if=\"retryable\" ng-click=\"retry()\">{{ 'BDC.RETRY' | i18n }}</button></div>" +
            "<button type=\"button\" class=\"bdc-information-toggle btn btn-default btn-sm\" ng-click=\"toggleInformation()\" aria-expanded=\"{{informationOpen}}\" aria-controls=\"bdc-information-{{$id}}\" aria-label=\"{{ 'BDC.TITLE' | i18n }}\"><span class=\"glyphicon glyphicon-info-sign\" aria-hidden=\"true\"></span></button>" +
            "<div class=\"bdc-card-information\" id=\"bdc-information-{{$id}}\" ng-show=\"informationOpen\" role=\"region\" aria-label=\"{{ 'BDC.TITLE' | i18n }}\">" +
            "<button type=\"button\" class=\"bdc-information-close btn btn-default btn-sm\" ng-click=\"closeInformation(true)\">{{ 'COMMON.CLOSE' | i18n }}</button>" +
            "<strong>{{ 'BDC.TITLE' | i18n }}</strong><p>{{ statusKey | i18n }}</p>" +
            "<p ng-if=\"preview\">{{ 'BDC.PREVIEW_NOTICE' | i18n }}</p>" +
            "<p ng-if=\"image.datetime\">{{ image.datetime | date:'dd/MM/yyyy':'UTC' }}</p>" +
            "<p ng-if=\"image.cloudPercent != null\">{{ 'BDC.LOCAL_CLOUD' | i18n }}: {{ image.cloudPercent | number:1 }}%</p>" +
            "<p ng-if=\"resolved.revision\">{{ 'BDC.REVISION' | i18n }}: {{resolved.revision}}</p>" +
            "<p>{{ 'BDC.PROFILE' | i18n }}: {{effectiveProfile || profile}}</p>" +
            "<button type=\"button\" class=\"btn btn-default btn-sm\" ng-if=\"resolved.state === 'ready' && resolved.global && onCompare\" ng-click=\"compare()\">{{ 'BDC.COMPARE' | i18n }}</button>" +
            "</div></div>",
        link: function (scope, element) {
            var destroyed = false, visible = !$window.IntersectionObserver, version = 0;
            var unsubscribe, observer, map, layer, marker, renderTask;
            var tileCleanups = [];
            var stateKeys = { pending: 'BDC.QUEUED', running: 'BDC.ANALYZING', no_image: 'BDC.NO_IMAGE', failed: 'BDC.ERROR' };
            scope.statusKey = 'BDC.QUEUED';
            scope.informationOpen = false;
            scope.closeInformation = function (restoreFocus) {
                scope.informationOpen = false;
                if (restoreFocus && !destroyed) {
                    var button = element[0].querySelector('.bdc-information-toggle');
                    if (button && button.focus) button.focus();
                }
            };
            scope.toggleInformation = function () { scope.informationOpen = !scope.informationOpen; };
            scope.informationKeydown = function (event) {
                if (event.key === 'Escape' && scope.informationOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    scope.closeInformation(true);
                }
            };

            function clearLayer() {
                tileCleanups.splice(0).forEach(function (cleanup) { cleanup(); });
                if (layer) { layer.off(); if (map) map.removeLayer(layer); layer = null; }
            }

            function removeMap() {
                clearLayer();
                if (!map) return;
                mapSyncService.unregister(map);
                if (typeof safeDestroyMap === 'function') safeDestroyMap(map);
                else map.remove();
                map = null;
                marker = null;
            }

            function notifyViewed() {
                if (scope.preview || !scope.onViewed || !scope.resolved || !scope.resolved.id) return;
                scope.onViewed({ reference: { selectionId: scope.resolved.id, year: scope.year, period: scope.period,
                    revision: scope.resolved.revision, profile: scope.effectiveProfile || null } });
            }

            function render() {
                if (destroyed || !visible || !scope.resolved || scope.resolved.state !== 'ready') return;
                clearLayer();
                var data = scope.resolved;
                scope.image = data[scope.side || 'local'];
                scope.effectiveProfile = scope.profile;
                var url = bdcImageryService.tileUrl(data, scope.effectiveProfile, scope.side);
                if (!url) { scope.statusKey = 'BDC.PROFILE_UNAVAILABLE'; scope.retryable = false; return; }
                var zoom = Math.max(6, Math.min(18, Number(scope.config && scope.config.zoomLevel) || 13));
                var center = Number.isFinite(data.lat) && Number.isFinite(data.lon)
                    ? [data.lat, data.lon] : [Number(scope.point.lat), Number(scope.point.lon)];
                if (!map) {
                    map = L.map(element[0].querySelector('.bdc-leaflet-map'), { zoomControl: true, minZoom: 6, maxZoom: 18 });
                    mapSyncService.register(map);
                }
                map.setView(center, zoom, { animate: false });
                if (marker) map.removeLayer(marker);
                marker = sampleMarkerService.createLayer(center, scope.config.sampleMarker).addTo(map);
                var renderVersion = version;
                var failedTiles = [], loaded = false;
                scope.statusKey = 'BDC.LOADING_IMAGE';
                scope.retryable = false;
                var QueuedTileLayer = L.TileLayer.extend({
                    createTile: function (coords, done) {
                        var tile = $window.document.createElement('img');
                        var objectUrl, decodeTimer, cancelled = false;
                        tile.alt = '';
                        tile.setAttribute('data-tile-x', coords.x);
                        tile.setAttribute('data-tile-y', coords.y);
                        tile.setAttribute('data-tile-z', coords.z);
                        tile.setAttribute('role', 'presentation');
                        function release() {
                            if (decodeTimer) $window.clearTimeout(decodeTimer);
                            if (objectUrl) { $window.URL.revokeObjectURL(objectUrl); objectUrl = null; }
                        }
                        function complete(error) {
                            tile.onload = tile.onerror = null;
                            release();
                            if (!cancelled) done(error, tile);
                        }
                        var cancelRequest = bdcTileQueue.request(this.getTileUrl(coords), function (error, blob) {
                            if (cancelled) return;
                            if (error) { complete(error); return; }
                            objectUrl = $window.URL.createObjectURL(blob);
                            tile.onload = function () { complete(null); };
                            tile.onerror = function () { complete(new Error('BDC tile decoding failed')); };
                            decodeTimer = $window.setTimeout(function () { complete(new Error('BDC tile decoding timeout')); }, 10000);
                            tile.src = objectUrl;
                        });
                        tile.bdcCleanup = function () {
                            cancelled = true;
                            cancelRequest();
                            tile.onload = tile.onerror = null;
                            release();
                            tile.removeAttribute('src');
                            var index = tileCleanups.indexOf(tile.bdcCleanup);
                            if (index !== -1) tileCleanups.splice(index, 1);
                        };
                        tileCleanups.push(tile.bdcCleanup);
                        return tile;
                    }
                });
                var currentLayer = new QueuedTileLayer(url, { minZoom: 6, maxZoom: 18, attribution: 'Brazil Data Cube / INPE' });
                layer = currentLayer;
                function update(fn) {
                    scope.$evalAsync(function () {
                        if (!destroyed && renderVersion === version && layer === currentLayer) fn();
                    });
                }
                layer.on('tileload', function (event) {
                    loaded = true;
                    if (event && event.tile) failedTiles = failedTiles.filter(function (tile) { return tile !== event.tile; });
                });
                function cleanupTile(event) {
                    if (event && event.tile && event.tile.bdcCleanup) event.tile.bdcCleanup();
                    if (event && event.tile) failedTiles = failedTiles.filter(function (tile) { return tile !== event.tile; });
                }
                layer.on('tileunload', cleanupTile);
                layer.on('tileabort', cleanupTile);
                layer.on('loading', function () {
                    loaded = false;
                    update(function () { scope.statusKey = 'BDC.LOADING_IMAGE'; scope.retryable = false; });
                });
                layer.on('tileerror', function (event) {
                    var tile = event && event.tile || currentLayer;
                    if (failedTiles.indexOf(tile) === -1) failedTiles.push(tile);
                    update(function () { scope.statusKey = 'BDC.IMAGE_ERROR'; scope.retryable = true; });
                });
                layer.on('load', function () {
                    update(function () {
                        scope.statusKey = failedTiles.length || !loaded ? 'BDC.IMAGE_ERROR' : 'BDC.READY';
                        scope.retryable = !!failedTiles.length || !loaded;
                        if (loaded && !failedTiles.length) notifyViewed();
                    });
                });
                layer.addTo(map);
                map.invalidateSize();
            }

            function accept(data, token) {
                if (destroyed || token !== version) return;
                scope.resolved = data;
                scope.effectiveProfile = scope.profile;
                scope.retryable = data.state === 'failed' && data.retryable === true;
                scope.statusKey = stateKeys[data.state] || 'BDC.LOADING_IMAGE';
                if (data.state === 'ready') render();
                if (data.state === 'no_image') notifyViewed();
            }

            function start() {
                scope.closeInformation(false);
                scope.image = null;
                version += 1;
                if (unsubscribe) { unsubscribe(); unsubscribe = null; }
                removeMap();
                scope.resolved = null;
                scope.retryable = false;
                scope.statusKey = 'BDC.QUEUED';
                if (!visible || destroyed || !scope.point || !scope.point._id) return;
                if (scope.selection) { accept(scope.selection, version); return; }
                if (scope.historical && !scope.selectionId) { scope.statusKey = 'BDC.NO_HISTORY'; return; }
                var token = version;
                unsubscribe = bdcImageryService.observe({ pointId: scope.point._id, year: scope.year, period: scope.period,
                    revision: scope.config && scope.config.bdcConfig && scope.config.bdcConfig.selectionRevision,
                    selectionId: scope.selectionId }, function (data) { accept(data, token); });
            }

            scope.retry = function () {
                if (scope.resolved && scope.resolved.state === 'ready') render();
                else if (unsubscribe) unsubscribe.retry();
            };
            scope.compare = function () { if (scope.onCompare) scope.onCompare({ selection: scope.resolved, profile: scope.effectiveProfile }); };
            scope.$watchGroup(['point._id', 'point.lat', 'point.lon', 'year', 'period', 'selectionId', 'historical',
                'config.bdcConfig.selectionRevision', 'selection'], start);
            scope.$watchGroup(['profile', 'config.zoomLevel', 'config.sampleMarker'], function (values, previous) {
                if (values && values === previous) return;
                if (renderTask) $timeout.cancel(renderTask);
                renderTask = $timeout(render);
            });
            if ($window.IntersectionObserver) {
                observer = new $window.IntersectionObserver(function (items) {
                    scope.$evalAsync(function () {
                        if (destroyed) return;
                        var next = items.some(function (item) { return item.isIntersecting; });
                        if (next !== visible) { visible = next; start(); }
                    });
                }, { rootMargin: '160px' });
                observer.observe(element[0]);
            }
            scope.$on('$destroy', function () {
                destroyed = true;
                scope.closeInformation(false);
                version += 1;
                if (observer) observer.disconnect();
                if (unsubscribe) unsubscribe();
                if (renderTask) $timeout.cancel(renderTask);
                removeMap();
            });
        }
    };
});
