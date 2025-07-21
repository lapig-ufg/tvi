module.exports = function(app) {
    const controller = app.controllers.visParams;
    const auth = app.middleware.auth.cacheApiAuth.requireCacheApiAuth;

    // Basic CRUD operations
    app.get('/api/vis-params', auth, controller.list);
    app.post('/api/vis-params', auth, controller.create);
    app.get('/api/vis-params/:name', auth, controller.get);
    app.put('/api/vis-params/:name', auth, controller.update);
    app.delete('/api/vis-params/:name', auth, controller.delete);

    // Additional operations
    app.patch('/api/vis-params/:name/toggle', auth, controller.toggle);
    app.post('/api/vis-params/test', auth, controller.test);
    app.post('/api/vis-params/clone/:name', auth, controller.clone);

    // Import/Export
    app.get('/api/vis-params/export/all', auth, controller.export);
    app.post('/api/vis-params/import', auth, controller.import);

    // Collection management
    app.get('/api/vis-params/landsat-collections', auth, controller.getLandsatCollections);
    app.put('/api/vis-params/landsat-collections', auth, controller.updateLandsatCollections);
    app.get('/api/vis-params/sentinel-collections', auth, controller.getSentinelCollections);
    app.put('/api/vis-params/sentinel-collections', auth, controller.updateSentinelCollections);
    app.post('/api/vis-params/sentinel-collections/initialize', auth, controller.initializeSentinelCollections);
    app.get('/api/vis-params/sentinel-collections/bands/:collection_name', auth, controller.getSentinelBands);
};