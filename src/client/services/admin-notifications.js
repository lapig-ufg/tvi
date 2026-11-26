'use strict';

Application.factory('AdminNotifications', function($q, $rootScope) {
    var sequence = 0;
    var service = { items: [] };
    service.answer = function(item, accepted) {
        var index = service.items.indexOf(item);
        if (index < 0) return;
        service.items.splice(index, 1);
        item.resolve(item.kind === 'prompt' ? (accepted ? item.value : null) : Boolean(accepted));
    };
    service.show = function(kind, message, title, options) {
        var deferred = $q.defer();
        options = options || {};
        var item = { id: ++sequence, kind: kind, message: message, title: title,
            type: options.type || 'info', value: options.value || '', errorCode: options.errorCode,
            resolve: deferred.resolve };
        service.items.push(item);
        return { result: deferred.promise,
            close: function() { service.answer(item, false); },
            dismiss: function() { service.answer(item, false); },
            update: function(value) { item.message = value; } };
    };
    $rootScope.$on('$routeChangeStart', function() {
        service.items.slice().forEach(function(item) {
            if (item.kind === 'confirm' || item.kind === 'prompt' || item.kind === 'progress') service.answer(item, false);
        });
    });
    return service;
});
