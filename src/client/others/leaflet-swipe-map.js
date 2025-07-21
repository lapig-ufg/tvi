'use strict';

Application.directive('leafletSwipeMap', function($timeout, $injector) {
    return {
        restrict: 'E',
        scope: {
            lon: '=',
            lat: '=',
            zoom: '=',
            leftLayer: '=',  // Configuração da camada esquerda
            rightLayer: '=', // Configuração da camada direita
            height: '@'
        },
        template: '<div class="leaflet-swipe-map" ng-style="{height: height || \'500px\'}"></div>',
        link: function(scope, element, attrs) {
            var map = null;
            var leftLayerObj = null;
            var rightLayerObj = null;
            var marker = null;
            var swipePosition = 0.5; // Posição inicial do swipe (50%)
            var swipeEl = null;
            var isDragging = false;
            
            // Controle de atualizações pendentes
            var updateQueue = {
                left: null,
                right: null
            };
            var isUpdating = {
                left: false,
                right: false
            };

            // Obter AppConfig se disponível
            var hasAppConfig = $injector.has('AppConfig');
            var AppConfig = hasAppConfig ? $injector.get('AppConfig') : null;

            function initMap() {
                // Criar o mapa
                var mapElement = element.find('.leaflet-swipe-map')[0];
                map = L.map(mapElement, {
                    center: [scope.lat, scope.lon],
                    zoom: scope.zoom,
                    minZoom: scope.zoom,
                    maxZoom: scope.zoom + 6,
                    // Desabilitar a camada base padrão
                    layers: [],
                    // Desabilitar apenas movimentação do mapa, mantendo zoom
                    dragging: false,
                    keyboard: false
                });


                // Adicionar marcador central
                marker = L.marker([scope.lat, scope.lon], {
                    icon: L.icon({
                        iconUrl: 'assets/marker2.png',
                        iconSize: [42, 42]
                    }),
                    zIndexOffset: 1000
                }).addTo(map);

                // Adicionar controle de escala
                L.control.scale({ metric: true, imperial: false }).addTo(map);

                // Criar as camadas esquerda e direita
                updateLayers();

                // Adicionar o controle de swipe (removido - será criado em updateLayers)
            }

            function buildTileUrl(layerConfig) {
                if (!layerConfig) return null;

                var baseUrl = layerConfig.baseUrl || 'https://tm{s}.lapig.iesa.ufg.br/api/layers/';
                var url = baseUrl + layerConfig.collection + '/{x}/{y}/{z}';
                var params = [];
                
                if (layerConfig.period) params.push('period=' + layerConfig.period);
                if (layerConfig.year) params.push('year=' + layerConfig.year);
                if (layerConfig.visparam) params.push('visparam=' + layerConfig.visparam);
                if (layerConfig.month) params.push('month=' + layerConfig.month);
                
                if (params.length > 0) {
                    url += '?' + params.join('&');
                }
                
                return url;
            }

            // Função global para garantir ordem correta das camadas
            function ensureLayerOrder() {
                if (leftLayerObj && rightLayerObj) {
                    // Garantir que a camada esquerda está por baixo
                    leftLayerObj.bringToBack();
                    // Garantir que a camada direita está por cima
                    rightLayerObj.bringToFront();
                    
                    // Re-aplicar o clipping na camada direita
                    if (rightLayerObj.getContainer()) {
                        var rect = map.getContainer().getBoundingClientRect();
                        var clipValue = swipePosition * rect.width;
                        rightLayerObj.getContainer().style.clip = 'rect(0, ' + rect.width + 'px, ' + rect.height + 'px, ' + clipValue + 'px)';
                    }
                }
            }

            function createTileLayer(layerConfig, isRightLayer) {
                if (!layerConfig) return null;

                var tileUrl = buildTileUrl(layerConfig);
                if (!tileUrl) return null;

                var options = {
                    subdomains: layerConfig.subdomains || ['1', '2', '3', '4', '5'],
                    attribution: layerConfig.attribution || '',
                    maxZoom: 18,
                    minZoom: 0,
                    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                    opacity: 0 // Iniciar com opacidade 0 para fade in
                };

                // Temporariamente desabilitado para debug
                // if (layerConfig.bounds) {
                //     options.bounds = L.latLngBounds(
                //         [layerConfig.bounds[0][1], layerConfig.bounds[0][0]],
                //         [layerConfig.bounds[1][1], layerConfig.bounds[1][0]]
                //     );
                // }

                var layer = L.tileLayer(tileUrl, options);
                
                // Adicionar fade in quando a camada for adicionada ao mapa
                layer.on('add', function() {
                    var container = layer.getContainer();
                    if (container) {
                        container.style.transition = 'opacity 0.5s ease-in-out';
                        $timeout(function() {
                            layer.setOpacity(1);
                        }, 50);
                    }
                });

                return layer;
            }

            function updateLayers(updateOnlyRight) {
                // Cancelar atualizações pendentes
                if (!updateOnlyRight && updateQueue.left) {
                    $timeout.cancel(updateQueue.left);
                    updateQueue.left = null;
                }
                if (updateQueue.right) {
                    $timeout.cancel(updateQueue.right);
                    updateQueue.right = null;
                }
                
                // Se já está atualizando, aguardar
                if ((!updateOnlyRight && isUpdating.left) || isUpdating.right) {
                    // Agendar nova atualização após a atual terminar
                    $timeout(function() {
                        updateLayers(updateOnlyRight);
                    }, 100);
                    return;
                }
                
                // Função para fazer fade out e remover camada
                function fadeOutAndRemove(layer, callback) {
                    if (layer && layer.getContainer()) {
                        var container = layer.getContainer();
                        container.style.transition = 'opacity 0.3s ease-out';
                        layer.setOpacity(0);
                        $timeout(function() {
                            if (map.hasLayer(layer)) {
                                map.removeLayer(layer);
                            }
                            if (callback) callback();
                        }, 300);
                    } else if (callback) {
                        callback();
                    }
                }
                
                
                // Se estamos atualizando apenas a direita, não mexer na esquerda
                if (updateOnlyRight) {
                    isUpdating.right = true;
                    
                    // Verificar se a camada esquerda existe, se não, criá-la
                    if (!leftLayerObj && scope.leftLayer) {
                        leftLayerObj = createTileLayer(scope.leftLayer, false);
                        if (leftLayerObj) {
                            leftLayerObj.addTo(map);
                        }
                    }
                    
                    // Apenas atualizar a camada direita
                    if (rightLayerObj) {
                        fadeOutAndRemove(rightLayerObj, function() {
                            rightLayerObj = null;
                            createRightLayer();
                        });
                    } else {
                        createRightLayer();
                    }
                    
                    function createRightLayer() {
                        if (scope.rightLayer) {
                            rightLayerObj = createTileLayer(scope.rightLayer, true);
                            if (rightLayerObj) {
                                rightLayerObj.addTo(map);
                                
                                // Garantir ordem correta das camadas após adicionar
                                $timeout(function() {
                                    ensureLayerOrder();
                                    isUpdating.right = false;
                                }, 50);
                            } else {
                                isUpdating.right = false;
                            }
                        } else {
                            isUpdating.right = false;
                        }
                    }
                    
                    // Garantir que o swipe control existe se ambas as camadas existem
                    if (leftLayerObj && rightLayerObj && !swipeEl) {
                        $timeout(function() {
                            createSwipeControl();
                        }, 100);
                    }
                    
                    return;
                }
                
                // Fazer fade out das camadas antigas
                isUpdating.left = true;
                isUpdating.right = true;
                
                var leftRemoved = false;
                var rightRemoved = false;
                
                fadeOutAndRemove(leftLayerObj, function() {
                    leftLayerObj = null;
                    leftRemoved = true;
                    if (rightRemoved) addNewLayers();
                });
                
                fadeOutAndRemove(rightLayerObj, function() {
                    rightLayerObj = null;
                    rightRemoved = true;
                    if (leftRemoved) addNewLayers();
                });
                
                // Se não há camadas para remover, adicionar as novas imediatamente
                if (!leftLayerObj && !rightLayerObj) {
                    addNewLayers();
                }
                
                // Remover controle de swipe se existir (apenas se não for updateOnlyRight)
                if (!updateOnlyRight && swipeEl) {
                    swipeEl.style.opacity = '0';
                    swipeEl.style.transition = 'opacity 0.3s ease-out';
                    $timeout(function() {
                        if (swipeEl) {
                            swipeEl.remove();
                            swipeEl = null;
                        }
                    }, 300);
                }
                
                function addNewLayers() {
                    // Criar novas camadas
                    if (scope.leftLayer) {
                        leftLayerObj = createTileLayer(scope.leftLayer, false);
                        if (leftLayerObj) {
                            leftLayerObj.addTo(map);
                        }
                    }

                    if (scope.rightLayer) {
                        rightLayerObj = createTileLayer(scope.rightLayer, true);
                        if (rightLayerObj) {
                            rightLayerObj.addTo(map);
                        }
                    }

                    // Garantir ordem correta e aplicar clip inicial se ambas as camadas existirem
                    if (leftLayerObj && rightLayerObj) {
                        $timeout(function() {
                            ensureLayerOrder();
                            createSwipeControl();
                            isUpdating.left = false;
                            isUpdating.right = false;
                        }, 100);
                    } else {
                        isUpdating.left = false;
                        isUpdating.right = false;
                    }

                    // Garantir que o marcador esteja sempre no topo
                    if (marker) {
                        marker.setZIndexOffset(1000);
                    }
                    
                    // Forçar o mapa a atualizar e carregar os tiles
                    $timeout(function() {
                        map.invalidateSize();
                        // Forçar redraw
                        if (map) {
                            var center = map.getCenter();
                            map.setView(center, map.getZoom(), { reset: true });
                        }
                    }, 200);
                }
            }

            function createSwipeControl() {
                if (!leftLayerObj || !rightLayerObj) return;
                
                // Salvar posição atual antes de remover
                var previousPosition = swipePosition;
                
                // Remover controle existente se houver
                if (swipeEl) {
                    swipeEl.remove();
                    swipeEl = null;
                }
                
                // Restaurar posição anterior
                swipePosition = previousPosition;

                var mapContainer = map.getContainer();
                var mapRect = mapContainer.getBoundingClientRect();

                // Criar elemento do swipe com área de clique maior
                swipeEl = document.createElement('div');
                swipeEl.className = 'leaflet-swipe-divider';
                swipeEl.style.cssText = `
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 20px;
                    margin-left: -10px;
                    cursor: ew-resize;
                    z-index: 2000;
                    opacity: 0;
                    transition: opacity 0.5s ease-in;
                `;
                
                // Linha visual do swipe
                var swipeLine = document.createElement('div');
                swipeLine.style.cssText = `
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: 50%;
                    width: 3px;
                    margin-left: -1.5px;
                    background-color: #fff;
                    box-shadow: 0 0 10px rgba(0,0,0,0.3);
                    pointer-events: none;
                `;
                swipeEl.appendChild(swipeLine);

                // Criar handle do swipe
                var handle = document.createElement('div');
                handle.style.cssText = `
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 40px;
                    height: 40px;
                    background-color: #fff;
                    border-radius: 50%;
                    box-shadow: 0 0 10px rgba(0,0,0,0.3);
                    cursor: ew-resize;
                    transition: box-shadow 0.3s ease;
                `;

                // Adicionar ícone de setas
                var icon = document.createElement('div');
                icon.innerHTML = '<i class="fa fa-arrows-h"></i>';
                icon.style.cssText = `
                    text-align: center;
                    line-height: 40px;
                    font-size: 16px;
                    color: #333;
                    user-select: none;
                `;
                handle.appendChild(icon);
                swipeEl.appendChild(handle);

                mapContainer.appendChild(swipeEl);

                // Função para atualizar a posição do swipe
                function updateSwipe(x) {
                    if (!swipeEl) return;
                    
                    var rect = mapContainer.getBoundingClientRect();
                    var relativeX = x - rect.left;
                    swipePosition = Math.max(0, Math.min(1, relativeX / rect.width));
                    
                    swipeEl.style.left = (swipePosition * 100) + '%';
                    
                    // Garantir ordem das camadas antes de aplicar clipping
                    ensureLayerOrder();
                }

                // Eventos de mouse
                function onMouseDown(e) {
                    isDragging = true;
                    
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                    
                    e.preventDefault();
                    e.stopPropagation();
                }

                function onMouseMove(e) {
                    if (isDragging) {
                        updateSwipe(e.clientX);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }

                function onMouseUp(e) {
                    isDragging = false;
                    
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    e.preventDefault();
                    e.stopPropagation();
                }

                // Eventos de toque
                function onTouchStart(e) {
                    isDragging = true;
                    
                    document.addEventListener('touchmove', onTouchMove, { passive: false });
                    document.addEventListener('touchend', onTouchEnd);
                    
                    e.preventDefault();
                    e.stopPropagation();
                }

                function onTouchMove(e) {
                    if (isDragging && e.touches.length > 0) {
                        updateSwipe(e.touches[0].clientX);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }

                function onTouchEnd(e) {
                    isDragging = false;
                    
                    document.removeEventListener('touchmove', onTouchMove);
                    document.removeEventListener('touchend', onTouchEnd);
                    
                    e.preventDefault();
                    e.stopPropagation();
                }

                // Efeitos de hover suaves
                swipeEl.addEventListener('mouseenter', function() {
                    handle.style.boxShadow = '0 0 15px rgba(33, 150, 243, 0.4)';
                });
                
                swipeEl.addEventListener('mouseleave', function() {
                    if (!isDragging) {
                        handle.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
                    }
                });

                // Adicionar eventos
                swipeEl.addEventListener('mousedown', onMouseDown);
                swipeEl.addEventListener('touchstart', onTouchStart);

                // Atualizar o swipe quando o mapa for redimensionado
                map.on('resize', function() {
                    if (!swipeEl) return;
                    var rect = mapContainer.getBoundingClientRect();
                    updateSwipe(rect.left + swipePosition * rect.width);
                });

                // Usar posição salva ou posição inicial
                updateSwipe(mapRect.left + mapRect.width * swipePosition);
                
                // Fazer fade in do controle
                $timeout(function() {
                    if (swipeEl) {
                        swipeEl.style.opacity = '1';
                    }
                }, 100);
            }

            // Inicializar o mapa após o elemento estar pronto
            $timeout(function() {
                initMap();
            }, 100);

            // Observar mudanças nas camadas
            scope.$watch('leftLayer', function(newVal, oldVal) {
                if (newVal !== oldVal && map) {
                    updateLayers();
                }
            }, true);

            scope.$watch('rightLayer', function(newVal, oldVal) {
                if (newVal !== oldVal && map) {
                    // Sempre atualizar apenas a camada direita quando ela mudar
                    // A camada esquerda (Landsat) deve permanecer fixa
                    updateLayers(true);
                }
            }, true);

            // Observar mudanças no centro do mapa
            scope.$watch('[lat, lon]', function(newVal, oldVal) {
                if (map && newVal[0] && newVal[1]) {
                    map.setView([newVal[0], newVal[1]], scope.zoom);
                    if (marker) {
                        marker.setLatLng([newVal[0], newVal[1]]);
                    }
                }
            }, true);

            // Cleanup
            scope.$on('$destroy', function() {
                if (swipeEl) {
                    swipeEl.remove();
                }
                if (map) {
                    map.remove();
                }
            });
        }
    };
});