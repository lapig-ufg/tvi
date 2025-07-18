const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../config/swagger');

module.exports = function(app) {
  const swaggerMiddleware = {};

  swaggerMiddleware.setup = function() {
    // Swagger UI options
    const options = {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'TVI API Documentation'
    };

    // Serve Swagger UI at /api-docs
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, options));

    // Serve raw OpenAPI spec
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    console.log('Swagger documentation available at /api-docs');
  };

  return swaggerMiddleware;
};