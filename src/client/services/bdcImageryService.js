'use strict';

angular.module('application').factory('bdcImageryService', function ($http, $timeout, $q) {
    var entries = Object.create(null);
    var queue = [];
    var active = 0;

    function publish(entry, value) {
        if (entry.disposed) return;
        entry.value = value;
        entry.listeners.slice().forEach(function (listener) { listener(value); });
    }

    function enqueue(entry, method) {
        if (entry.disposed || entry.queued || entry.inflight) return;
        entry.queued = true;
        queue.push({ entry: entry, method: method });
        pump();
    }

    function pump() {
        while (active < 2 && queue.length) {
            var task = queue.shift();
            task.entry.queued = false;
            if (!task.entry.disposed) request(task.entry, task.method);
        }
    }

    function request(entry, method) {
        active += 1;
        entry.inflight = true;
        var cancel = $q.defer();
        entry.cancel = cancel;
        var deadline = $timeout(function () { cancel.resolve(); }, 30000);
        var opts = entry.options;
        var params = opts.selectionId ? { selectionId: opts.selectionId } : { year: opts.year, period: opts.period };
        if (method === 'post' && entry.retryRequested) { params.retry = true; entry.retryRequested = false; }
        var config = { hideLoading: true, timeout: cancel.promise };
        var url = '/service/points/' + encodeURIComponent(opts.pointId) + '/bdc-selections';
        var promise = method === 'post' ? $http.post(url, params, config)
            : $http.get(url, Object.assign({ params: params }, config));
        promise.then(function (response) {
            if (entry.disposed) return;
            var value = response.data;
            if (!value || !['pending', 'running', 'ready', 'no_image', 'failed', 'not_started'].includes(value.state)) {
                publish(entry, { state: 'failed', retryable: true, error: 'invalid_response' });
                return;
            }
            if (value.state === 'not_started' && !opts.selectionId && method !== 'post') {
                entry.next = 'post';
                return;
            }
            publish(entry, value);
            if (value.state === 'pending' || value.state === 'running') {
                entry.polls += 1;
                if (entry.polls > 300) {
                    publish(entry, { state: 'failed', retryable: true, error: 'wait_timeout' });
                    return;
                }
                var delay = Math.max(2, Math.min(Number(value.retryAfterSeconds) || 3, 30)) * 1000;
                entry.timer = $timeout(function () { entry.timer = null; enqueue(entry, 'get'); }, delay);
            }
        }, function (error) {
            if (entry.disposed) return;
            if (error.status === 404 && !opts.selectionId && method === 'get') entry.next = 'post';
            else publish(entry, { state: 'failed', retryable: error.status <= 0 || error.status >= 500 || error.status === 408 || error.status === 429,
                error: error.data && error.data.error || 'request_failed' });
        }).finally(function () {
            $timeout.cancel(deadline);
            entry.inflight = false;
            entry.cancel = null;
            active -= 1;
            if (entry.next) {
                var next = entry.next;
                entry.next = null;
                enqueue(entry, next);
            }
            pump();
        });
    }

    function observe(options, listener) {
        var key = JSON.stringify([options.pointId, options.year, options.period, options.revision, options.selectionId || null]);
        var entry = entries[key];
        if (!entry) {
            entry = entries[key] = { options: Object.assign({}, options), listeners: [], polls: 0, value: { state: 'pending' } };
        }
        entry.listeners.push(listener);
        listener(entry.value);
        if (!entry.started) { entry.started = true; enqueue(entry, 'get'); }
        var removed = false;
        function unsubscribe() {
            if (removed) return;
            removed = true;
            entry.listeners = entry.listeners.filter(function (item) { return item !== listener; });
            if (!entry.listeners.length) {
                if (entry.timer) $timeout.cancel(entry.timer);
                if (entry.cancel) entry.cancel.resolve();
                entry.disposed = true;
                delete entries[key];
            }
        }
        unsubscribe.retry = function () {
            if (removed || entry.inflight || entry.queued) return;
            entry.polls = 0;
            entry.retryRequested = true;
            publish(entry, { state: 'pending' });
            enqueue(entry, options.selectionId ? 'get' : 'post');
        };
        return unsubscribe;
    }

    function tileUrl(selection, profile, side) {
        var image = selection && selection[side || 'local'];
        var url = image && image.tiles && image.tiles[profile];
        return typeof url === 'string' && /^\/service\/[^\\\s]*$/.test(url) && url.indexOf('//') !== 0 ? url : null;
    }

    function bindGrid(scope, supervision) {
        scope.bdc = { view: supervision ? 'history' : 'current', inspectors: [], inspectionIndex: 0, references: [], profile: null };
        function historicalReferences() {
            var inspection = scope.bdc.inspectors[scope.bdc.inspectionIndex];
            return inspection && Array.isArray(inspection.bdcSelections) ? inspection.bdcSelections : [];
        }
        scope.bdcSelectionId = function (year, period) {
            if (scope.bdc.view !== 'history') return null;
            var reference = historicalReferences().find(function (item) { return item.year === year && item.period === period; });
            return reference ? reference.selectionId : null;
        };
        scope.bdcSelectionProfile = function (year, period) {
            var reference = historicalReferences().find(function (item) { return item.year === year && item.period === period; });
            return reference ? reference.profile : scope.bdc.profile;
        };
        scope.buildBdcMaps = function () {
            var years = scope.bdc.view === 'history' ? historicalReferences().map(function (reference) { return reference.year; }) : [];
            if (!years.length) {
                var initial = Number(scope.config.initialYear), final = Number(scope.config.finalYear);
                if (Number.isInteger(initial) && Number.isInteger(final) && initial >= 1970 && final <= new Date().getFullYear()) {
                    for (var year = initial; year <= final; year += 1) years.push(year);
                }
            }
            return years.filter(function (year, index) { return Number.isInteger(year) && years.indexOf(year) === index; })
                .sort(function (a, b) { return a - b; }).map(function (year, index) {
                    return { year: year, date: '00/00/' + year, index: index };
                });
        };
        scope.changeBdcView = function () {
            scope.bdc.comparison = null;
            scope.bdc.profileOverride = false;
            scope.maps = scope.buildBdcMaps();
        };
        scope.bdcViewed = function (reference) {
            if (!reference || !reference.selectionId) return;
            var existing = scope.bdc.references.find(function (item) { return item.year === reference.year && item.period === reference.period; });
            var profiles = existing && existing.selectionId === reference.selectionId ? existing.profilesViewed.slice() : [];
            if (reference.profile && profiles.indexOf(reference.profile) === -1) profiles.push(reference.profile);
            var value = Object.assign({}, reference, { profilesViewed: profiles });
            if (existing) scope.bdc.references[scope.bdc.references.indexOf(existing)] = value;
            else scope.bdc.references.push(value);
        };
        scope.openBdcComparison = function (selection, profile) {
            scope.bdc.comparison = selection;
            scope.bdc.comparisonProfile = profile || scope.bdc.profile;
        };
        return {
            reset: function (point) {
                scope.bdc.references = [];
                scope.bdc.comparison = null;
                scope.bdc.profileOverride = false;
                scope.bdc.view = supervision ? 'history' : 'current';
                scope.bdc.inspectors = point && Array.isArray(point.inspection) ? point.inspection.map(function (inspection, index) {
                    return Object.assign({}, inspection, { userName: inspection.userName || (point.userName || [])[index] || String(index + 1) });
                }) : [];
                var first = scope.bdc.inspectors.findIndex(function (inspection) { return inspection.bdcSelections && inspection.bdcSelections.length; });
                scope.bdc.inspectionIndex = Math.max(0, first);
            },
            configure: function (config) {
                scope.config.imagerySource = config.imagerySource || null;
                scope.config.bdcConfig = config.bdcConfig || null;
                if (Number.isInteger(config.initialYear)) scope.config.initialYear = config.initialYear;
                if (Number.isInteger(config.finalYear)) scope.config.finalYear = config.finalYear;
                scope.bdc.currentAvailable = config.imagerySource === 'bdc';
                scope.isBdc = scope.bdc.currentAvailable || (supervision && scope.bdc.inspectors.some(function (inspection) {
                    return inspection.bdcSelections && inspection.bdcSelections.length;
                }));
                scope.bdc.profile = config.bdcConfig && config.bdcConfig.defaultProfile;
                scope.bdc.profiles = config.bdcConfig && config.bdcConfig.profiles || [];
                if (supervision) {
                    scope.bdc.profiles = scope.bdc.profiles.slice();
                    scope.bdc.inspectors.forEach(function (inspection) {
                        (inspection.bdcSelections || []).forEach(function (reference) {
                            [reference.profile].concat(reference.profilesViewed || []).forEach(function (profile) {
                                if (profile && scope.bdc.profiles.indexOf(profile) === -1) scope.bdc.profiles.push(profile);
                            });
                        });
                    });
                }
            }
        };
    }

    return { observe: observe, tileUrl: tileUrl, bindGrid: bindGrid };
});
