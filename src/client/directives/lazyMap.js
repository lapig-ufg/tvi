'use strict';

/**
 * Diretiva para lazy loading de mapas.
 *
 * Estratégia simples:
 * - IntersectionObserver detecta quando o container do mapa entra na viewport
 * - Dispara onVisible() que marca o mapa como visível no controller
 * - Sem fila, sem delays, sem backpressure — o browser gerencia naturalmente
 */
angular.module('application')
.directive('lazyMap', function($timeout, $window) {
    return {
        restrict: 'A',
        scope: {
            mapIndex: '@',
            totalMaps: '@',
            onVisible: '&'
        },
        link: function(scope, element, attrs) {
            var observer;
            var isLoaded = false;

            function activate() {
                if (isLoaded) return;
                isLoaded = true;

                scope.$evalAsync(function() {
                    scope.onVisible();
                });

                if (observer) {
                    observer.unobserve(element[0]);
                }
            }

            function setupObserver() {
                if (typeof IntersectionObserver === 'undefined') {
                    activate();
                    return;
                }

                observer = new IntersectionObserver(function(entries) {
                    entries.forEach(function(entry) {
                        if (entry.isIntersecting && !isLoaded) {
                            activate();
                        }
                    });
                }, {
                    root: null,
                    rootMargin: '200px',
                    threshold: 0.1
                });

                observer.observe(element[0]);
            }

            setupObserver();

            scope.$on('$destroy', function() {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            });

            // Reset quando o controller regenera os mapas (novo ponto / troca de período)
            scope.$on('resetLazyMaps', function() {
                isLoaded = false;

                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                setupObserver();
            });
        }
    };
});
