'use strict';

angular.module('application').factory('bdcQueuedTileLayer', function ($window, bdcTileQueue) {
    return { create: function (url, options) {
        if (typeof url !== 'string' || !/^\/service\/[^\\\s]*$/.test(url)) return null;
        var cleanups = [];
        var QueuedLayer = L.TileLayer.extend({
            createTile: function (coords, done) {
                var tile = $window.document.createElement('img');
                var objectUrl, timer, cancelled = false;
                tile.alt = '';
                tile.setAttribute('role', 'presentation');
                function release() {
                    if (timer) $window.clearTimeout(timer);
                    if (objectUrl) { $window.URL.revokeObjectURL(objectUrl); objectUrl = null; }
                }
                function complete(error) {
                    tile.onload = tile.onerror = null;
                    release();
                    if (!cancelled) done(error, tile);
                }
                var cancel = bdcTileQueue.request(this.getTileUrl(coords), function (error, blob) {
                    if (cancelled) return;
                    if (error) { complete(error); return; }
                    objectUrl = $window.URL.createObjectURL(blob);
                    tile.onload = function () { complete(null); };
                    tile.onerror = function () { complete(new Error('BDC image decoding failed')); };
                    timer = $window.setTimeout(function () { complete(new Error('BDC image decoding timeout')); }, 10000);
                    tile.src = objectUrl;
                });
                tile.bdcCleanup = function () {
                    cancelled = true;
                    cancel();
                    tile.onload = tile.onerror = null;
                    release();
                    tile.removeAttribute('src');
                    var index = cleanups.indexOf(tile.bdcCleanup);
                    if (index !== -1) cleanups.splice(index, 1);
                };
                cleanups.push(tile.bdcCleanup);
                return tile;
            }
        });
        var layer = new QueuedLayer(url, options);
        function cleanup(event) { if (event && event.tile && event.tile.bdcCleanup) event.tile.bdcCleanup(); }
        layer.on('tileabort', cleanup);
        layer.on('tileunload', cleanup);
        layer.on('remove', function () { cleanups.splice(0).forEach(function (cancel) { cancel(); }); });
        return layer;
    } };
});
