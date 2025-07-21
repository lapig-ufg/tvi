'use strict';

/**
 * Loading Interceptor Service
 * Intercepta todas as requisições HTTP e mostra/esconde um loading global
 */
angular.module('application').factory('loadingInterceptor', function($q, $rootScope, $timeout) {
    var activeRequests = 0;
    var loadingTimer;
    
    var service = {
        request: function(config) {
            // Ignorar requisições que não devem mostrar loading
            if (config.hideLoading) {
                return config;
            }
            
            activeRequests++;
            
            // Cancelar timer de hide se existir
            if (loadingTimer) {
                $timeout.cancel(loadingTimer);
                loadingTimer = null;
            }
            
            // Emitir evento para mostrar loading
            $rootScope.$broadcast('loading:show');
            
            return config;
        },
        
        response: function(response) {
            activeRequests--;
            
            if (activeRequests === 0) {
                // Adicionar pequeno delay para evitar flicker em requisições rápidas
                loadingTimer = $timeout(function() {
                    $rootScope.$broadcast('loading:hide');
                }, 300);
            }
            
            return response;
        },
        
        responseError: function(rejection) {
            activeRequests--;
            
            if (activeRequests === 0) {
                loadingTimer = $timeout(function() {
                    $rootScope.$broadcast('loading:hide');
                }, 300);
            }
            
            return $q.reject(rejection);
        }
    };
    
    return service;
});

/**
 * Loading Service
 * Serviço para controlar o loading manualmente quando necessário
 */
angular.module('application').factory('LoadingService', function($rootScope) {
    var service = {
        show: function(message) {
            $rootScope.$broadcast('loading:show', message);
        },
        
        hide: function() {
            $rootScope.$broadcast('loading:hide');
        },
        
        showWithPromise: function(promise, message) {
            service.show(message);
            return promise.finally(function() {
                service.hide();
            });
        }
    };
    
    return service;
});

/**
 * Loading Directive
 * Diretiva que cria o componente visual de loading
 */
angular.module('application').directive('globalLoading', function() {
    return {
        restrict: 'E',
        replace: true,
        template: `
            <div class="global-loading-overlay" ng-show="isLoading">
                <div class="global-loading-container">
                    <div class="global-loading-spinner">
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                    </div>
                    <div class="global-loading-message" ng-if="loadingMessage">
                        {{loadingMessage}}
                    </div>
                </div>
            </div>
        `,
        controller: function($scope, $timeout) {
            $scope.isLoading = false;
            $scope.loadingMessage = '';
            var hideTimer;
            
            $scope.$on('loading:show', function(event, message) {
                if (hideTimer) {
                    $timeout.cancel(hideTimer);
                    hideTimer = null;
                }
                
                $scope.isLoading = true;
                $scope.loadingMessage = message || '';
                
                // Forçar digest cycle se necessário
                if (!$scope.$$phase) {
                    $scope.$apply();
                }
            });
            
            $scope.$on('loading:hide', function() {
                // Pequeno delay para evitar flicker
                hideTimer = $timeout(function() {
                    $scope.isLoading = false;
                    $scope.loadingMessage = '';
                }, 100);
            });
            
            // Limpar timer ao destruir
            $scope.$on('$destroy', function() {
                if (hideTimer) {
                    $timeout.cancel(hideTimer);
                }
            });
        }
    };
});