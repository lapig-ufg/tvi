module.exports = function (app) {

    const kml = app.controllers.planet;

    app.get('/service/planet/mosaics', kml.publicMosaicPlanet);

}