(function() {
  'use strict';

  /**
   * Configuração de ambiente para o TVI Frontend
   * 
   * Este arquivo centraliza todas as URLs e configurações específicas de ambiente.
   * Para trocar entre ambientes, modifique a variável 'environment' abaixo.
   */

  // Defina o ambiente atual: 'development', 'staging', 'production'
  var environment = 'production';

  // Configurações por ambiente
  var configs = {
    development: {
      // URL base para a API de tiles
      tilesApiBaseUrl: 'https://tm{s}.lapig.iesa.ufg.br/api/layers',
      
      // Subdomínios para distribuição de carga
      tilesSubdomains: ['1', '2', '3', '4', '5'],
      
      // URL base para APIs do backend local
      servicePrefix: 'service/',
      
      // URLs de CDN
      cdnUrls: {
        openLayers: 'https://cdn.jsdelivr.net/npm/ol@v8.2.0/',
        fontAwesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/',
        chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/'
      }
    },
    
    staging: {
      tilesApiBaseUrl: 'https://tm{s}.lapig.iesa.ufg.br/api/layers',
      tilesSubdomains: ['1', '2', '3', '4', '5'],
      servicePrefix: 'service/',
      cdnUrls: {
        openLayers: 'https://cdn.jsdelivr.net/npm/ol@v8.2.0/',
        fontAwesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/',
        chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/'
      }
    },
    
    production: {
      tilesApiBaseUrl: 'https://tm{s}.lapig.iesa.ufg.br/api/layers',
      tilesSubdomains: ['1', '2', '3', '4', '5'],
      servicePrefix: 'service/',
      cdnUrls: {
        openLayers: 'https://cdn.jsdelivr.net/npm/ol@v8.2.0/',
        fontAwesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/',
        chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/'
      }
    }
  };

  // Selecionar configuração baseada no ambiente
  var currentConfig = configs[environment] || configs.production;

  // Registrar configuração como constante Angular
  angular
    .module('application')
    .constant('AppConfig', {
      environment: environment,
      tilesApiBaseUrl: currentConfig.tilesApiBaseUrl,
      tilesSubdomains: currentConfig.tilesSubdomains,
      servicePrefix: currentConfig.servicePrefix,
      cdnUrls: currentConfig.cdnUrls,
      
      // Funções auxiliares para construir URLs
      buildTileUrl: function(layer, params) {
        var url = currentConfig.tilesApiBaseUrl + '/' + layer + '/{x}/{y}/{z}';
        if (params) {
          var queryString = Object.keys(params)
            .map(function(key) {
              return key + '=' + encodeURIComponent(params[key]);
            })
            .join('&');
          url += '?' + queryString;
        }
        return url;
      }
    });

})();