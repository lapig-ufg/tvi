'use strict';

/**
 * Diretiva para lazy loading inteligente de mapas
 * Pré-carrega mapas próximos para melhor experiência
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
            let observer;
            let isLoaded = false;
            let preloadTriggered = false;
            
            // Configurações de carregamento
            const config = {
                rootMargin: '400px', // Começar a carregar 400px antes para melhor experiência
                threshold: 0.1, // Aumentar threshold para melhor detecção
                preloadCount: 3 // Aumentar pré-carregamento
            };
            
            // Função para pré-carregar mapas próximos
            function preloadNearbyMaps() {
                if (preloadTriggered) return;
                preloadTriggered = true;
                
                const currentIndex = parseInt(scope.mapIndex);
                const total = parseInt(scope.totalMaps);
                
                // Calcular índices para pré-carregamento
                const indicesToPreload = [];
                
                // Pré-carregar os próximos N mapas
                for (let i = 1; i <= config.preloadCount; i++) {
                    const nextIndex = currentIndex + i;
                    if (nextIndex < total) {
                        indicesToPreload.push(nextIndex);
                    }
                }
                
                // Pré-carregar o anterior também (caso o usuário role para cima)
                const prevIndex = currentIndex - 1;
                if (prevIndex >= 0) {
                    indicesToPreload.push(prevIndex);
                }
                
                // Emitir evento para pré-carregar
                scope.$emit('preloadMaps', indicesToPreload);
            }
            
            // Callback do Intersection Observer
            function handleIntersection(entries) {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !isLoaded) {
                        isLoaded = true;
                        
                        // Aplicar mudança no Angular
                        scope.$apply(function() {
                            scope.onVisible();
                            
                            // Agendar pré-carregamento após o mapa atual carregar
                            $timeout(function() {
                                preloadNearbyMaps();
                            }, 100);
                        });
                        
                        // Desconectar observer após carregar
                        if (observer) {
                            observer.unobserve(element[0]);
                        }
                    }
                });
            }
            
            // Criar e configurar o observer
            function setupObserver() {
                // Usar sempre a viewport como root para garantir que funcione com scroll da página
                // Isso é mais confiável que tentar detectar containers de scroll
                observer = new IntersectionObserver(handleIntersection, {
                    root: null, // null = viewport da janela
                    rootMargin: config.rootMargin,
                    threshold: config.threshold
                });
                
                observer.observe(element[0]);
            }
            
            // Inicializar após um pequeno delay para garantir que o DOM esteja pronto
            $timeout(function() {
                setupObserver();
                
                // Verificar imediatamente se o mapa já está visível
                $timeout(function() {
                    if (!isLoaded) {
                        const rect = element[0].getBoundingClientRect();
                        const viewHeight = $window.innerHeight;
                        
                        // Se o elemento está visível na viewport inicial, carregar imediatamente
                        // Usar margem maior para detectar melhor
                        if (rect.top < (viewHeight + 100) && rect.bottom > -100) {
                            isLoaded = true;
                            scope.$apply(function() {
                                scope.onVisible();
                            });
                            
                            // Agendar pré-carregamento
                            $timeout(function() {
                                preloadNearbyMaps();
                            }, 200);
                        }
                    }
                }, 500);
            }, 100);
            
            // Cleanup ao destruir
            scope.$on('$destroy', function() {
                if (observer) {
                    observer.disconnect();
                }
            });
            
            // Listener para forçar carregamento se necessário
            scope.$on('forceLoadMap', function(event, index) {
                if (parseInt(scope.mapIndex) === index && !isLoaded) {
                    isLoaded = true;
                    scope.$apply(function() {
                        scope.onVisible();
                    });
                }
            });
        }
    };
})

/**
 * Serviço para gerenciar o estado de carregamento dos mapas
 */
.service('mapLoadingService', function() {
    const loadedMaps = new Set();
    const loadingMaps = new Set();
    const callbacks = new Map();
    
    this.isLoaded = function(index) {
        return loadedMaps.has(index);
    };
    
    this.isLoading = function(index) {
        return loadingMaps.has(index);
    };
    
    this.startLoading = function(index) {
        loadingMaps.add(index);
    };
    
    this.finishLoading = function(index) {
        loadingMaps.delete(index);
        loadedMaps.add(index);
        
        // Executar callbacks
        if (callbacks.has(index)) {
            callbacks.get(index).forEach(cb => cb());
            callbacks.delete(index);
        }
    };
    
    this.onLoaded = function(index, callback) {
        if (this.isLoaded(index)) {
            callback();
        } else {
            if (!callbacks.has(index)) {
                callbacks.set(index, []);
            }
            callbacks.get(index).push(callback);
        }
    };
    
    this.reset = function() {
        loadedMaps.clear();
        loadingMaps.clear();
        callbacks.clear();
    };
});