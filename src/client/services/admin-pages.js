'use strict';

Application.factory('AdminPages', function($q, $http, $location) {
    var definitions = Object.create(null);

    function internalReturn(value, fallback) {
        return typeof value === 'string' && value.length <= 4000 &&
            /^\/admin\/[A-Za-z0-9]/.test(value) && !/[\\\r\n]/.test(value) ? value : fallback;
    }

    return {
        register: function(id, definition) {
            if (!/^[a-z][a-z0-9-]*$/.test(id) || definitions[id]) throw new Error('Página administrativa inválida ou duplicada');
            definitions[id] = definition;
        },
        go: function(id, params, returnTo) {
            if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Página administrativa inválida');
            var query = {};
            Object.keys(params || {}).forEach(function(key) {
                var value = params[key];
                if (/password|token|secret|credential/i.test(key) ||
                    !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 1000) {
                    throw new Error('Parâmetro de navegação inválido');
                }
                query[key] = value;
            });
            query.returnTo = internalReturn(returnTo || $location.url(), '/admin/home');
            $location.path('/admin/page/' + id).search(query);
        },
        load: function(params) {
            var definition = definitions[params.pageId];
            var page = { params: angular.copy(params), parent: '/admin/home', returnTo: '/admin/home' };
            if (!definition) return $q.when(Object.assign(page, { error: 'Página administrativa não encontrada.' }));
            page.title = definition.title;
            page.parent = internalReturn(typeof definition.parent === 'function' ? definition.parent(params) : definition.parent, '/admin/home');
            page.returnTo = internalReturn(params.returnTo, page.parent);
            return $http.get('/api/admin/check').then(function(response) {
                if (!response.data.authenticated) {
                    $location.path('/admin/login').search({});
                    throw new Error('A sessão administrativa expirou. Entre novamente.');
                }
                return definition.load ? definition.load(page.params) : {};
            }).then(function(locals) {
                page.locals = locals || {};
                page.definition = definition;
                return page;
            }).catch(function(error) {
                page.error = error.status === 404 ? 'O registro solicitado não foi encontrado.' :
                    (error.data && (error.data.error || error.data.message)) || error.message || 'Não foi possível carregar esta página.';
                return page;
            });
        }
    };
});
