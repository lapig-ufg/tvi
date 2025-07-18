const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TVI API Documentation',
      version: '1.0.0',
      description: 'API documentation for Temporal Vegetation Inspector (TVI) system',
      contact: {
        name: 'LAPIG Team',
        url: 'https://lapig.iesa.ufg.br'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://tvi.lapig.iesa.ufg.br',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'Session-based authentication'
        },
        adminAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'admin.sid',
          description: 'Admin session authentication'
        },
        cacheApiAuth: {
          type: 'http',
          scheme: 'basic',
          description: 'Basic authentication for cache API endpoints'
        }
      }
    },
    tags: [
      {
        name: 'Points',
        description: 'Endpoints for managing inspection points'
      },
      {
        name: 'Campaigns',
        description: 'Endpoints for managing campaigns'
      },
      {
        name: 'Timeseries',
        description: 'Endpoints for retrieving timeseries data'
      },
      {
        name: 'Cache',
        description: 'Endpoints for cache management'
      },
      {
        name: 'Admin',
        description: 'Administrative endpoints'
      },
      {
        name: 'Dashboard',
        description: 'Dashboard and statistics endpoints'
      },
      {
        name: 'Logs',
        description: 'Log management endpoints'
      },
      {
        name: 'Authentication',
        description: 'Login and authentication endpoints'
      },
      {
        name: 'Supervisor',
        description: 'Supervisor-only endpoints'
      },
      {
        name: 'Admin Dashboard',
        description: 'Admin dashboard statistics'
      },
      {
        name: 'Admin Temporal',
        description: 'Admin temporal data access'
      },
      {
        name: 'Campaign Admin Auth',
        description: 'Campaign admin authentication'
      },
      {
        name: 'Campaign Management',
        description: 'Campaign CRUD operations'
      },
      {
        name: 'Campaign Points',
        description: 'Campaign points management'
      },
      {
        name: 'Logs Management',
        description: 'System logs management'
      },
      {
        name: 'Logs Service',
        description: 'Log service operations'
      },
      {
        name: 'System',
        description: 'System health and status'
      },
      {
        name: 'Images',
        description: 'Image access and processing'
      },
      {
        name: 'Export',
        description: 'Data export endpoints'
      },
      {
        name: 'MapBiomas',
        description: 'MapBiomas integration'
      },
      {
        name: 'Planet',
        description: 'Planet satellite imagery'
      },
      {
        name: 'Sentinel',
        description: 'Sentinel satellite data'
      },
      {
        name: 'Spatial Data',
        description: 'Spatial data queries'
      },
      {
        name: 'Time Series',
        description: 'Time series data endpoints'
      },
      {
        name: 'Timeseries API',
        description: 'Time series API endpoints'
      }
    ]
  },
  apis: [
    path.join(__dirname, '../routes/*.js'),
    path.join(__dirname, '../controllers/*.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
