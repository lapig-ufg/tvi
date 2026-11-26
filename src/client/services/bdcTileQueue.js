'use strict';

angular.module('application').factory('bdcTileQueue', function ($window) {
    var waiting = [], active = 0;

    function pump() {
        while (active < 2 && waiting.length) {
            var job = waiting.shift();
            if (!job.cancelled) run(job);
        }
    }

    function run(job) {
        if (!job.attempts) job.deadline = Date.now() + 120000;
        if (Date.now() >= job.deadline) {
            job.callback(new Error('BDC tile retry deadline exceeded'));
            return;
        }
        var xhr = new $window.XMLHttpRequest(), finished = false;
        active += 1;
        job.attempts += 1;
        job.xhr = xhr;
        function finish(error, blob) {
            if (finished) return;
            finished = true;
            active -= 1;
            job.xhr = null;
            if (!job.cancelled) {
                var retry = error && (error.status === 429 || error.status === 503) && job.attempts < 60;
                var header = xhr.getResponseHeader('Retry-After');
                var delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
                delay = Math.max(0, delay);
                // O proxy fornece Retry-After apenas quando a capacidade pode ser recuperada.
                if (retry && header && Number.isFinite(delay) && delay <= 120000 && Date.now() + delay < job.deadline) {
                    job.timer = $window.setTimeout(function () {
                        job.timer = null;
                        if (!job.cancelled) { waiting.push(job); pump(); }
                    }, delay);
                } else job.callback(error, blob);
            }
            // O descarte de uma camada cancela vários tiles no mesmo ciclo.
            if (job.cancelled) Promise.resolve().then(pump);
            else pump();
        }
        xhr.open('GET', job.url, true);
        xhr.responseType = 'blob';
        xhr.timeout = Math.max(1, Math.min(30000, job.deadline - Date.now()));
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) finish(null, xhr.response);
            else { var error = new Error('BDC tile HTTP ' + xhr.status); error.status = xhr.status; finish(error); }
        };
        xhr.onerror = xhr.ontimeout = function () { finish(new Error('BDC tile request failed')); };
        xhr.onabort = function () { finish(new Error('BDC tile request aborted')); };
        xhr.send();
    }

    return {
        request: function (url, callback) {
            var job = { url: url, callback: callback, attempts: 0, cancelled: false };
            waiting.push(job);
            pump();
            return function () {
                job.cancelled = true;
                waiting = waiting.filter(function (entry) { return entry !== job; });
                if (job.timer) $window.clearTimeout(job.timer);
                if (job.xhr) job.xhr.abort();
            };
        }
    };
});
