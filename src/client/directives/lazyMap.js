'use strict';

/**
 * Diretiva para lazy loading de mapas com carregamento progressivo.
 *
 * Estratégia:
 * - IntersectionObserver detecta quando o container do mapa entra na viewport
 * - A ativação é delegada ao mapLoadingService que serializa a criação
 *   dos mapas Leaflet, respeitando um intervalo mínimo entre cada instância
 * - Não implementa preload em cascata — o IntersectionObserver com rootMargin
 *   já cumpre esse papel sem risco de efeito dominó
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

            var config = {
                rootMargin: '200px',
                threshold: 0.1
            };

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

            function handleIntersection(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting && !isLoaded) {
                        activate();
                    }
                });
            }

            function setupObserver() {
                if (typeof IntersectionObserver === 'undefined') {
                    // Fallback para browsers sem IntersectionObserver
                    $timeout(activate, 100);
                    return;
                }

                observer = new IntersectionObserver(handleIntersection, {
                    root: null,
                    rootMargin: config.rootMargin,
                    threshold: config.threshold
                });

                observer.observe(element[0]);
            }

            // Inicializar após DOM estar pronto
            $timeout(function() {
                setupObserver();

                // Fallback: verificar visibilidade direta após o DOM estabilizar
                $timeout(function() {
                    if (!isLoaded) {
                        var rect = element[0].getBoundingClientRect();
                        var viewHeight = $window.innerHeight;

                        if (rect.top < (viewHeight + 100) && rect.bottom > -100) {
                            activate();
                        }
                    }
                }, 300);
            }, 50);

            scope.$on('$destroy', function() {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            });

            // Listener para forçar carregamento (usado em troca de período)
            scope.$on('forceLoadMap', function(event, index) {
                if (parseInt(scope.mapIndex) === index && !isLoaded) {
                    activate();
                }
            });

            // Reset quando o controller regenera os mapas (novo ponto)
            scope.$on('resetLazyMaps', function() {
                isLoaded = false;

                // Reconectar o IntersectionObserver para este elemento
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                setupObserver();
            });
        }
    };
})

/**
 * Serviço centralizado de carregamento de mapas.
 *
 * Responsabilidades:
 * 1. **Fila serializada**: mapas são ativados um por vez com intervalo
 *    configurável (STAGGER_DELAY) entre cada ativação.
 * 2. **Backpressure**: após ativar um mapa, aguarda a confirmação
 *    (mapReady) antes de iniciar o próximo. Se a confirmação não
 *    chegar dentro do READY_TIMEOUT, avança para evitar deadlock.
 * 3. **Tracking de estado**: rastreia quais mapas estão carregando,
 *    carregados, ou pendentes na fila.
 * 4. **Cache de visibilidade**: preserva estado entre mudanças de período.
 */
.service('mapLoadingService', function($timeout) {
    var self = this;

    var loadedMaps = new Set();
    var loadingMaps = new Set();
    var callbacks = new Map();

    // Fila de carregamento serializado
    var queue = [];
    var processing = false;

    // Tempo mínimo entre ativações de mapas (ms)
    // Permite ao browser fazer layout/paint entre cada mapa
    var STAGGER_DELAY = 200;

    // Tempo máximo para aguardar o mapReady antes de avançar (ms)
    // Previne deadlock se um mapa falhar ao sinalizar ready
    var READY_TIMEOUT = 3000;

    var readyTimeoutHandle = null;
    var waitingForReady = false;

    // Cache de mapas visíveis para preservar entre mudanças de período
    var visibleMapsCache = [];
    var shouldRestoreFromCache = false;

    /**
     * Processa a fila de carregamento.
     * Ativa um mapa, depois aguarda backpressure (mapReady) ou timeout
     * antes de ativar o próximo.
     */
    function processQueue() {
        if (processing || queue.length === 0) return;
        processing = true;
        waitingForReady = false;

        var item = queue.shift();

        // Executar a ativação do mapa
        try {
            item.activate();
        } catch (e) {
            console.error('mapLoadingService: erro ao ativar mapa', item.index, e);
        }

        // Aguardar sinal de ready (mapReady) com timeout de segurança
        waitingForReady = true;

        readyTimeoutHandle = $timeout(function() {
            // Timeout: o mapa não sinalizou ready a tempo, avançar mesmo assim
            if (waitingForReady) {
                waitingForReady = false;
                processing = false;
                processQueue();
            }
        }, READY_TIMEOUT);
    }

    /**
     * Sinaliza que um mapa completou sua inicialização básica
     * (DOM criado, Leaflet instanciado, primeiro tile solicitado).
     * Chamado pelas diretivas de mapa após L.map() + addLayer().
     */
    self.mapReady = function(index) {
        if (!waitingForReady) return;
        waitingForReady = false;

        if (readyTimeoutHandle) {
            $timeout.cancel(readyTimeoutHandle);
            readyTimeoutHandle = null;
        }

        // Aguardar STAGGER_DELAY antes de ativar o próximo
        $timeout(function() {
            processing = false;
            processQueue();
        }, STAGGER_DELAY);
    };

    /**
     * Enfileira a ativação de um mapa. O callback será executado
     * quando chegar a vez deste mapa na fila.
     */
    self.enqueue = function(index, activateFn) {
        var alreadyQueued = queue.some(function(item) { return item.index === index; });
        if (alreadyQueued || loadedMaps.has(index) || loadingMaps.has(index)) {
            return;
        }

        queue.push({ index: index, activate: activateFn });
        processQueue();
    };

    self.isLoaded = function(index) {
        return loadedMaps.has(index);
    };

    self.isLoading = function(index) {
        return loadingMaps.has(index);
    };

    self.startLoading = function(index) {
        loadingMaps.add(index);
    };

    self.finishLoading = function(index) {
        loadingMaps.delete(index);
        loadedMaps.add(index);

        if (callbacks.has(index)) {
            callbacks.get(index).forEach(function(cb) { cb(); });
            callbacks.delete(index);
        }
    };

    self.onLoaded = function(index, callback) {
        if (self.isLoaded(index)) {
            callback();
        } else {
            if (!callbacks.has(index)) {
                callbacks.set(index, []);
            }
            callbacks.get(index).push(callback);
        }
    };

    self.saveVisibleMaps = function(visibleIndices) {
        visibleMapsCache = [].concat(visibleIndices);
        shouldRestoreFromCache = true;
    };

    self.shouldRestoreMap = function(index) {
        return shouldRestoreFromCache && visibleMapsCache.indexOf(index) !== -1;
    };

    self.getVisibleMapsFromCache = function() {
        return visibleMapsCache;
    };

    self.clearCache = function() {
        shouldRestoreFromCache = false;
        visibleMapsCache = [];
    };

    self.reset = function() {
        loadedMaps.clear();
        loadingMaps.clear();
        callbacks.clear();
        queue = [];
        processing = false;
        waitingForReady = false;
        if (readyTimeoutHandle) {
            $timeout.cancel(readyTimeoutHandle);
            readyTimeoutHandle = null;
        }
    };
});
