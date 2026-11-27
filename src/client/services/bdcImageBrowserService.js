'use strict';

angular.module('application').factory('bdcImageBrowserService', function ($http, $q, $timeout) {
    function create(options, changed) {
        var state = { period: 'YEAR', start: new Date(options.year, 0, 1), end: new Date(options.year, 11, 31), page: 1, items: [], nextPage: null, selectedId: null,
            profiles: [], profile: null, loading: false, error: null };
        var version = 0, request, deadline, detail, disposed = false;
        var base = '/service/points/' + encodeURIComponent(options.pointId) + '/bdc-images';
        function cancel() {
            version += 1;
            if (request) request.resolve();
            if (deadline) $timeout.cancel(deadline);
            request = deadline = null;
        }
        function clearLayer() {
            state.tileLoading = false;
            detail = null;
            state.profiles = [];
            state.profile = null;
            changed(null);
        }
        function parameters() {
            var params = { year: options.year, period: state.period };
            function dateValue(value) {
                if (value && typeof value.getFullYear === 'function') {
                    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
                }
                return value;
            }
            if (state.period === 'CUSTOM') { params.start = dateValue(state.start); params.end = dateValue(state.end); }
            return params;
        }
        function get(url, params, success) {
            cancel();
            var token = version;
            request = $q.defer();
            deadline = $timeout(function () { if (request) request.resolve(); }, 30000);
            state.loading = true;
            state.error = null;
            $http.get(url, { params: params, timeout: request.promise, hideLoading: true }).then(function (response) {
                if (!disposed && version === token) success(response.data);
            }, function () {
                if (!disposed && version === token) { state.error = 'BDC.ERROR'; clearLayer(); }
            }).finally(function () {
                if (version === token) {
                    if (deadline) $timeout.cancel(deadline);
                    request = deadline = null;
                    state.loading = false;
                }
            });
        }
        function applyProfile() {
            changed(null);
            var url = detail && detail.tiles && detail.tiles[state.profile];
            if (typeof url !== 'string' || !/^\/service\/[^\\\s]*$/.test(url) || url.indexOf('//') === 0) {
                state.error = 'BDC.PROFILE_UNAVAILABLE';
                return;
            }
            state.error = null;
            changed({ source: 'bdc', tileUrl: url, attribution: 'Brazil Data Cube / INPE', itemId: detail.id,
                datetime: detail.datetime, profile: state.profile });
        }
        return {
            state: state,
            search: function (page) {
                if (disposed) return;
                clearLayer();
                state.items = [];
                state.selectedId = null;
                state.nextPage = null;
                state.page = page || 1;
                var params = parameters();
                params.page = state.page;
                params.limit = 12;
                get(base, params, function (data) {
                    state.items = data && Array.isArray(data.items) ? data.items : [];
                    state.nextPage = data && Number.isInteger(data.nextPage) && data.nextPage > state.page ? data.nextPage : null;
                });
            },
            select: function () {
                if (disposed) return;
                clearLayer();
                var id = state.selectedId;
                if (!id || !state.items.some(function (item) { return item.id === id; })) { cancel(); state.loading = false; return; }
                get(base + '/' + encodeURIComponent(id), parameters(), function (data) {
                    if (!data || data.id !== id || !Array.isArray(data.profiles)) { state.error = 'BDC.ERROR'; return; }
                    detail = data;
                    state.profiles = data.profiles;
                    state.profile = state.profiles.length ? state.profiles[0].id : null;
                    applyProfile();
                });
            },
            applyProfile: applyProfile,
            failTile: function () { clearLayer(); state.error = 'BDC.IMAGE_ERROR'; },
            suspend: function () { cancel(); clearLayer(); state.loading = false; },
            dispose: function () { disposed = true; cancel(); clearLayer(); state.loading = false; }
        };
    }
    return { create: create };
});
