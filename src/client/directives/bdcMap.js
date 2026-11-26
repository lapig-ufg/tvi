'use strict';

angular.module('application').directive('bdcMap', function ($window, $timeout, bdcImageryService, mapSyncService, sampleMarkerService) {
    return {
        restrict: 'E',
        scope: { point: '=', year: '=', period: '=', config: '=', profile: '=', selectionId: '=?', historical: '=?',
            selection: '=?', side: '@?', onViewed: '&?', onCompare: '&?' },
        template: '<div class="bdc-card">' +
            '<div class="bdc-card-status" role="status">{{ statusKey | i18n }}</div>' +
            '<div ng-if="resolved.state === \'ready\'" class="bdc-card-metadata">' +
            '<span>{{ image.datetime | date:\'dd/MM/yyyy\':\'UTC\' }} · {{ \'BDC.LOCAL_CLOUD\' | i18n }}: {{ image.cloudPercent | number:1 }}%</span>' +
            '<span>{{ \'BDC.REVISION\' | i18n }} {{resolved.revision}} · {{effectiveProfile}}</span>' +
            '</div><div class="bdc-leaflet-map" aria-label="BDC"></div>' +
            '<div class="bdc-card-actions">' +
            '<button type="button" class="btn btn-default btn-sm" ng-if="retryable" ng-click="retry()">{{ \'BDC.RETRY\' | i18n }}</button>' +
            '<button type="button" class="btn btn-default btn-sm" ng-if="resolved.state === \'ready\' && resolved.global && onCompare" ng-click="compare()">{{ \'BDC.COMPARE\' | i18n }}</button>' +
            '</div></div>',
        link: function (scope, element) {
            var destroyed = false, visible = !$window.IntersectionObserver, version = 0;
            var unsubscribe, observer, map, layer, marker, tileDeadline, renderTask;
            var stateKeys = { pending: 'BDC.QUEUED', running: 'BDC.ANALYZING', no_image: 'BDC.NO_IMAGE', failed: 'BDC.ERROR' };
            scope.statusKey = 'BDC.QUEUED';

            function clearLayer() {
                if (tileDeadline) $timeout.cancel(tileDeadline);
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
                if (!scope.onViewed || !scope.resolved || !scope.resolved.id) return;
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
                if (!url && scope.historical && Array.isArray(data.profiles)) {
                    var alternative = data.profiles.find(function (profile) { return bdcImageryService.tileUrl(data, profile.id, scope.side); });
                    if (alternative) {
                        scope.effectiveProfile = alternative.id;
                        url = bdcImageryService.tileUrl(data, alternative.id, scope.side);
                    }
                }
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
                var currentLayer = L.tileLayer(url, { minZoom: 6, maxZoom: 18, attribution: 'Brazil Data Cube / INPE' });
                layer = currentLayer;
                function update(fn) {
                    scope.$evalAsync(function () {
                        if (!destroyed && renderVersion === version && layer === currentLayer) fn();
                    });
                }
                function armDeadline() {
                    if (tileDeadline) $timeout.cancel(tileDeadline);
                    tileDeadline = $timeout(function () {
                        update(function () { scope.statusKey = 'BDC.IMAGE_ERROR'; scope.retryable = true; });
                    }, 30000);
                }
                layer.on('tileload', function (event) {
                    loaded = true;
                    if (event && event.tile) failedTiles = failedTiles.filter(function (tile) { return tile !== event.tile; });
                });
                layer.on('tileunload', function (event) {
                    if (event && event.tile) failedTiles = failedTiles.filter(function (tile) { return tile !== event.tile; });
                });
                layer.on('loading', function () {
                    loaded = false;
                    armDeadline();
                    update(function () { scope.statusKey = 'BDC.LOADING_IMAGE'; scope.retryable = false; });
                });
                layer.on('tileerror', function (event) {
                    var tile = event && event.tile || currentLayer;
                    if (failedTiles.indexOf(tile) === -1) failedTiles.push(tile);
                    update(function () { scope.statusKey = 'BDC.IMAGE_ERROR'; scope.retryable = true; });
                });
                layer.on('load', function () {
                    if (tileDeadline) $timeout.cancel(tileDeadline);
                    update(function () {
                        scope.statusKey = failedTiles.length || !loaded ? 'BDC.IMAGE_ERROR' : 'BDC.READY';
                        scope.retryable = !!failedTiles.length || !loaded;
                        if (loaded && !failedTiles.length) notifyViewed();
                    });
                });
                armDeadline();
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
            scope.$watchGroup(['profile', 'config.zoomLevel', 'config.sampleMarker'], function () {
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
                version += 1;
                if (observer) observer.disconnect();
                if (unsubscribe) unsubscribe();
                if (renderTask) $timeout.cancel(renderTask);
                removeMap();
            });
        }
    };
});
