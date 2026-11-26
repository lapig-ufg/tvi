Application.run(function(AdminPages, $http) {
    function parent(params) {
        const returnTo = params && params.returnTo;
        return typeof returnTo === 'string' && /^\/admin\/visualization-params(?:\?|$)/.test(returnTo) ?
            returnTo : '/admin/visualization-params';
    }

    function get(url) {
        return $http.get(url).then(function(response) {
            return response.data && response.data.data !== undefined ? response.data.data : response.data;
        });
    }

    function identifier(params, key) {
        if (!params || typeof params[key] !== 'string' || !params[key].trim()) {
            throw new Error('Identificador obrigatório para abrir a página.');
        }
        return encodeURIComponent(params[key]);
    }

    function loadParam(params) {
        return get('../api/vis-params/' + identifier(params, 'name')).then(function(param) {
            return { param: param, categories: ['landsat', 'sentinel2'] };
        });
    }

    function paramEditState(scope) {
        return { param: scope.param, configType: scope.configType, valueMode: scope.valueMode, unifiedValues: scope.unifiedValues };
    }

    function saving(scope) {
        return scope.loading === true;
    }

    AdminPages.register('vis-param-create', {
        editState: paramEditState,
        pending: saving,
        editable: true,
        title: 'Novo parâmetro de visualização',
        templateUrl: 'views/admin-vis-param-modal-v2.tpl.html',
        controller: 'AdminVisParamModalV2Controller',
        parent: parent,
        load: function() { return { param: null, categories: ['landsat', 'sentinel2'] }; }
    });

    AdminPages.register('vis-param-edit', {
        editState: paramEditState,
        pending: saving,
        editable: true,
        title: 'Editar parâmetro de visualização',
        templateUrl: 'views/admin-vis-param-modal-v2.tpl.html',
        controller: 'AdminVisParamModalV2Controller',
        parent: parent,
        load: loadParam
    });

    AdminPages.register('vis-param-details', {
        title: 'Detalhes do parâmetro de visualização',
        templateUrl: 'views/admin-vis-param-details-modal.tpl.html',
        controller: 'AdminVisParamDetailsController',
        parent: parent,
        load: loadParam
    });

    AdminPages.register('vis-param-clone', {
        editState: function(scope) { return scope.newName; },
        editable: true,
        title: 'Clonar parâmetro de visualização',
        templateUrl: 'views/admin-vis-param-clone-modal.tpl.html',
        controller: 'AdminVisParamCloneController',
        parent: parent,
        load: function(params) {
            return loadParam(params).then(function(locals) { return { originalParam: locals.param }; });
        },
        save: function(newName, locals) {
            return $http.post('../api/vis-params/clone/' + encodeURIComponent(locals.originalParam.name) + '?new_name=' + encodeURIComponent(newName), {});
        }
    });

    AdminPages.register('vis-param-test', {
        title: 'Testar parâmetro de visualização',
        templateUrl: 'views/admin-vis-param-test-modal.tpl.html',
        controller: 'AdminVisParamTestController',
        parent: parent,
        load: loadParam
    });

    AdminPages.register('vis-param-import', {
        editState: function(scope) { return { content: scope.importData.content, overwrite: scope.importData.overwrite }; },
        pending: saving,
        editable: true,
        title: 'Importar parâmetros de visualização',
        templateUrl: 'views/admin-vis-param-import-modal.tpl.html',
        controller: 'AdminVisParamImportController',
        parent: parent,
        load: function() { return {}; }
    });

    AdminPages.register('landsat-collections', {
        editState: function(scope) { return scope.collections; },
        pending: saving,
        editable: true,
        title: 'Editar coleções Landsat',
        templateUrl: 'views/admin-landsat-collections-modal.tpl.html',
        controller: 'AdminLandsatCollectionsController',
        parent: parent,
        load: function() {
            return get('../api/vis-params/landsat-collections').then(function(collections) { return { collections: Array.isArray(collections) ? collections : collections.mappings }; });
        }
    });

    AdminPages.register('sentinel-collections', {
        editState: function(scope) { return scope.data; },
        pending: saving,
        editable: true,
        title: 'Editar coleções Sentinel',
        templateUrl: 'views/admin-sentinel-collections-modal.tpl.html',
        controller: 'AdminSentinelCollectionsController',
        parent: parent,
        load: function() {
            return get('../api/vis-params/sentinel-collections').then(function(collections) { return { collections: collections }; });
        }
    });

    AdminPages.register('collection-bands', {
        title: 'Bandas da coleção',
        templateUrl: 'views/admin-collection-bands-modal.tpl.html',
        controller: 'AdminCollectionBandsController',
        parent: parent,
        load: function(params) {
            identifier(params, 'collectionName');
            return get('../api/vis-params/sentinel-collections').then(function(config) {
                const collection = (config.collections || []).find(function(item) { return item.name === params.collectionName; });
                if (!collection) throw new Error('Coleção não encontrada.');
                return { collectionName: params.collectionName, bands: collection.bands || {} };
            });
        }
    });
});
