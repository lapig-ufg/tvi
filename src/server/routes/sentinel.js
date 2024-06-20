module.exports = function (app) {

    const sentinel = app.controllers.sentinel;

    app.get('/service/sentinel/capabilities', sentinel.publicCapabilities);

}