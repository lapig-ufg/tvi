module.exports = function (app) {
    const mapbiomas = app.controllers.mapbiomas;
    const origin = app.middleware.origin;
    app.get('/service/mapbiomas/capabilities', origin.checkOriginAndHost, mapbiomas.capabilities);
    app.get('/service/mapbiomas/wms', origin.checkOriginAndHost, mapbiomas.proxy);
}
