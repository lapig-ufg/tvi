'use strict';

/**
 * waybackGridService — obtém o catálogo de releases do backend (com cache em
 * memória e dedupe de promise, mesmo padrão do capabilitiesService em
 * others/services.js:284) e expõe o núcleo puro WaybackGridCore para os
 * controllers temporal/supervisor.
 */
angular.module('application').factory('waybackGridService', function ($q, requester) {

    var releasesIndexCache = null;
    var releasesPromise = null;

    function getReleasesIndex() {
        if (releasesIndexCache) {
            return $q.resolve(releasesIndexCache);
        }
        if (releasesPromise) {
            return releasesPromise;
        }

        var deferred = $q.defer();

        function onSuccess(data) {
            var index = {};
            (data || []).forEach(function (r) {
                index[r.releaseNum] = r;
            });
            releasesIndexCache = index;
            releasesPromise = null;
            deferred.resolve(index);
        }
        onSuccess.error = function (error) {
            releasesPromise = null;
            deferred.reject(error);
        };

        requester._get('wayback/releases', onSuccess);
        releasesPromise = deferred.promise;
        return releasesPromise;
    }

    return {
        getReleasesIndex: getReleasesIndex,
        core: window.WaybackGridCore
    };
});
