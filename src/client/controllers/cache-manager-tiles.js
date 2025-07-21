'use strict';

Application.controller('CacheManagerTilesController', function ($scope, $interval, $timeout, requester, NotificationDialog, $location) {
    
    // Configuração do Socket.IO para atualizações em tempo real
    var socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        transports: ['websocket', 'polling']
    });
    
    // Estados da aplicação
    $scope.activeTab = 'overview'; // overview, monitoring, management, analysis
    
    // Estados de carregamento
    $scope.loading = {
        stats: false,
        tasks: false,
        capabilities: false,
        recommendations: false
    };
    
    // Estatísticas da API de Tiles - novo modelo
    $scope.tilesStats = {
        summary: {
            total_tiles_cached: 0,
            s3_objects: 0,
            s3_storage_gb: 0,
            local_cache_size: 0,
            active_tasks: 0,
            cache_layers: [],
            status: 'unknown',
            last_updated: null
        },
        redis: {
            status: 'unknown',
            total_keys: 0,
            connected_clients: 0,
            used_memory_human: '0B',
            estimated_metadata_mb: 0,
            ttl_policies: {}
        },
        s3: {
            status: 'unknown',
            endpoint: '',
            bucket: '',
            total_objects: 0,
            storage: {
                bytes: 0,
                mb: 0,
                gb: 0
            },
            average_tile_size_kb: 0,
            error: null
        },
        local_cache: {
            current_size: 0,
            max_size: 0,
            usage_percent: 0,
            hot_tiles: [],
            cache_policy: '',
            ttl_hours: 0
        },
        performance: {
            cache_hit_estimation: {},
            avg_response_time_ms: {},
            throughput: {}
        },
        system: {
            celery: {
                active_tasks: 0,
                scheduled_tasks: 0,
                reserved_tasks: 0,
                workers: []
            },
            cache_efficiency: {},
            monitoring: {}
        }
    };
    
    // Lista de tarefas ativas
    $scope.activeTasks = [];
    
    // Gerenciamento de tasks
    $scope.tasksManagement = {
        list: [],
        workers: [],
        registeredTasks: [],
        queueInfo: {},
        selectedQueue: 'celery',
        selectedState: null,
        loading: {
            list: false,
            workers: false,
            registered: false,
            queue: false,
            purge: false
        }
    };
    
    // Capabilities dos satélites
    $scope.capabilities = {
        landsat: [],
        sentinel: []
    };
    
    // Configuração de cache warmup
    $scope.warmupConfig = {
        layer: 'landsat',
        bounds: {
            minLat: null,
            maxLat: null,
            minLon: null,
            maxLon: null
        },
        zoomLevels: {
            min: 10,
            max: 13
        },
        years: {
            start: 2020,
            end: 2023
        },
        priority: 'normal'
    };
    
    // Análise de padrões de cache
    $scope.cacheAnalysis = {
        patterns: [],
        recommendations: [],
        heatmap: null,
        stats: {
            totalPoints: 0,
            cachedPoints: 0,
            cachePercentage: '0'
        }
    };

    // Variáveis para campanhas (vindas do sistema antigo)
    $scope.cacheStatus = {
        campaigns: [],
        totals: {}
    };

    // Variáveis para paginação de campanhas
    $scope.campaignsPagination = {
        currentPage: 1,
        itemsPerPage: 25,
        totalPages: 1
    };

    // Variável para busca por ID
    $scope.campaignSearch = {
        searchId: ''
    };

    // Variáveis para armazenar valores computados
    $scope.filteredCampaigns = [];
    $scope.paginatedCampaigns = [];

    // Disponibilizar Math no escopo
    $scope.Math = Math;
    
    // Configuração de limpeza de cache
    $scope.clearConfig = {
        type: 'selective', // selective, campaign, layer, all
        layer: null,
        campaign: null,
        year: null,
        pointIds: [],
        confirm: false
    };
    
    // Inicialização
    $scope.init = function() {
        $scope.loadStats();
        $scope.loadCapabilities();
        $scope.loadCacheStatus();
        $scope.loadActiveTasks(); // Load initial active tasks
        $scope.setupSocketListeners();
        
        // Atualizar estatísticas a cada 30 segundos
        $scope.statsInterval = $interval(function() {
            if (!$scope.loading.stats) {
                $scope.loadStats();
                $scope.loadCacheStatus();
            }
        }, 30000);
        
        // Atualizar tarefas ativas a cada 5 segundos
        $scope.tasksInterval = $interval(function() {
            if (!$scope.loading.tasks && $scope.activeTab === 'monitoring') {
                $scope.loadActiveTasks();
            }
        }, 5000);
    };
    
    // Configurar listeners do Socket.IO
    $scope.setupSocketListeners = function() {
        socket.on('connect', function() {
            console.log('Connected to cache updates');
            socket.emit('join', 'cache-updates');
        });
        
        socket.on('disconnect', function() {
            console.log('Disconnected from cache updates');
        });
        
        // Cache statistics update
        socket.on('cache-stats-update', function(data) {
            $scope.$apply(function() {
                $scope.tilesStats = data;
            });
        });
        
        // Point cache events
        socket.on('point-cache-started', function(data) {
            $scope.$apply(function() {
                var task = {
                    id: data.taskId,
                    type: 'point_cache',
                    pointId: data.pointId,
                    status: 'processing',
                    startedAt: data.timestamp,
                    progress: 0
                };
                $scope.activeTasks.unshift(task);
                console.log('Point cache started:', data);
            });
        });
        
        socket.on('cache-point-processing', function(data) {
            $scope.$apply(function() {
                console.log('Processing point:', data.pointId, 'Period:', data.period, 'Year:', data.year);
            });
        });
        
        socket.on('cache-point-completed', function(data) {
            $scope.$apply(function() {
                console.log('Point completed:', data.pointId, 'Tiles:', data.processedTiles);
                // Update any related task
                var task = $scope.activeTasks.find(t => t.pointId === data.pointId);
                if (task) {
                    task.progress = 100;
                    task.status = 'completed';
                }
            });
        });
        
        // Campaign cache events
        socket.on('campaign-cache-started', function(data) {
            $scope.$apply(function() {
                var task = {
                    id: data.taskId,
                    type: 'campaign_cache',
                    campaignId: data.campaignId,
                    batchSize: data.batchSize,
                    useGrid: data.useGrid,
                    priorityRecentYears: data.priorityRecentYears,
                    status: 'processing',
                    startedAt: data.timestamp,
                    progress: 0
                };
                $scope.activeTasks.unshift(task);
                console.log('Campaign cache started:', data);
            });
        });
        
        // Task events
        socket.on('task-cancelled', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.status = 'cancelled';
                    task.cancelledAt = data.timestamp;
                }
                console.log('Task cancelled:', data.taskId);
            });
        });
        
        // Cache clear events
        socket.on('cache-cleared', function(data) {
            $scope.$apply(function() {
                console.log('Cache cleared:', data);
                // Refresh stats after cache clear
                $scope.loadStats();
            });
        });
        
        socket.on('cache-point-cleared', function(data) {
            $scope.$apply(function() {
                console.log('Point cache cleared:', data.pointId);
                if (data.mongoUpdated) {
                    NotificationDialog.info(`Cache do ponto ${data.pointId} foi limpo`, 'Cache Limpo');
                }
            });
        });
        
        socket.on('cache-campaign-cleared', function(data) {
            $scope.$apply(function() {
                console.log('Campaign cache cleared:', data.campaignId, 'Points:', data.pointsCleared);
                if (data.pointsCleared > 0) {
                    NotificationDialog.info(`${data.pointsCleared} pontos da campanha ${data.campaignId} foram limpos`, 'Cache Limpo');
                }
            });
        });
        
        // Tile processing events
        socket.on('cache-tile-success', function(data) {
            $scope.$apply(function() {
                // Update progress for the related task
                var task = $scope.activeTasks.find(t => t.pointId === data.pointId);
                if (task && task.tiles) {
                    task.tiles.processed = (task.tiles.processed || 0) + 1;
                    task.progress = Math.round((task.tiles.processed / task.tiles.total) * 100);
                }
            });
        });
        
        socket.on('cache-tile-error', function(data) {
            $scope.$apply(function() {
                console.error('Tile error:', data);
                var task = $scope.activeTasks.find(t => t.pointId === data.pointId);
                if (task) {
                    task.errors = (task.errors || 0) + 1;
                }
            });
        });
        
        // Generic task events (backwards compatibility)
        socket.on('task-created', function(task) {
            $scope.$apply(function() {
                $scope.activeTasks.unshift(task);
                NotificationDialog.info(`Tarefa ${task.id} iniciada: ${task.type}`, 'Nova Tarefa Criada');
            });
        });
        
        socket.on('task-progress', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.progress = data.progress;
                    task.processed = data.processed;
                    task.total = data.total;
                    task.status = data.status;
                    task.updatedAt = new Date();
                }
            });
        });
        
        socket.on('task-completed', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.status = 'completed';
                    task.completedAt = new Date();
                    NotificationDialog.success(`Tarefa ${data.taskId} concluída com sucesso`, 'Tarefa Concluída');
                }
            });
        });
        
        socket.on('task-failed', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.status = 'failed';
                    task.error = data.error;
                    task.failedAt = new Date();
                    NotificationDialog.error(`Tarefa ${data.taskId} falhou: ${data.error}`, 'Erro na Tarefa');
                }
            });
        });
    };
    
    // Carregar estatísticas da API
    $scope.loadStats = function() {
        $scope.loading.stats = true;
        
        requester._get('../api/cache/stats', function(response) {
            $scope.loading.stats = false;
            if (response && response.success) {
                $scope.tilesStats = response.data;
                $scope.calculateDerivedStats();
            } else {
                console.error('Error loading stats:', response);
                NotificationDialog.error('Erro ao carregar estatísticas', 'Erro');
            }
        });
    };
    
    // Calcular estatísticas derivadas
    $scope.calculateDerivedStats = function() {
        if ($scope.tilesStats.redis && $scope.tilesStats.redis.total_keys) {
            // Adicionar informações calculadas
            $scope.tilesStats.derived = {
                redis_cache_percentage: $scope.tilesStats.redis.total_keys > 0 ? 
                    (($scope.tilesStats.redis.total_keys / $scope.tilesStats.summary.total_tiles_cached) * 100).toFixed(2) : 0,
                s3_utilization_percentage: $scope.tilesStats.s3.storage.gb > 0 ? 
                    (($scope.tilesStats.s3.storage.gb / 100) * 100).toFixed(2) : 0, // Assume 100GB max
                system_health_score: $scope.calculateHealthScore()
            };
        }
    };

    // Calcular score de saúde do sistema
    $scope.calculateHealthScore = function() {
        var score = 100;
        
        // Reduzir score baseado no status dos componentes
        if ($scope.tilesStats.redis.status !== 'connected') score -= 30;
        if ($scope.tilesStats.s3.status !== 'connected') score -= 30;
        if ($scope.tilesStats.summary.status !== 'healthy') score -= 20;
        if ($scope.tilesStats.system.monitoring.alerts && $scope.tilesStats.system.monitoring.alerts.length > 0) {
            score -= $scope.tilesStats.system.monitoring.alerts.length * 5;
        }
        
        return Math.max(0, score);
    };
    
    // Carregar capabilities
    $scope.loadCapabilities = function() {
        $scope.loading.capabilities = true;
        
        
        // Carregar capabilities unificado
        requester._get('admin/capabilities', function(response) {
            if (response && Array.isArray(response)) {
                // Separar Landsat e Sentinel dos capabilities unificados
                $scope.capabilities.landsat = response.filter(c => c.satellite === 'landsat');
                $scope.capabilities.sentinel = response.filter(c => c.satellite === 'sentinel');
            } else {
                $scope.capabilities.landsat = [];
                $scope.capabilities.sentinel = [];
            }
            $scope.loading.capabilities = false;
        });
    };
    
    // Iniciar cache warmup
    $scope.startWarmup = function() {
        if (!$scope.validateWarmupConfig()) {
            return;
        }
        
        var data = {
            layer: $scope.warmupConfig.layer,
            bounds: $scope.warmupConfig.bounds,
            zoom_range: [$scope.warmupConfig.zoomLevels.min, $scope.warmupConfig.zoomLevels.max],
            years: [$scope.warmupConfig.years.start, $scope.warmupConfig.years.end],
            priority: $scope.warmupConfig.priority
        };
        
        requester._post('../api/cache/warmup', data, function(response) {
            if (response && response.success) {
                NotificationDialog.success(`Tarefa de warmup criada: ${response.data.task_id}`, 'Warmup Iniciado');
                $scope.loadActiveTasks();
            } else {
                NotificationDialog.error('Erro ao iniciar warmup: ' + (response?.details || 'Erro desconhecido'), 'Erro');
            }
        });
    };
    
    // Validar configuração de warmup
    $scope.validateWarmupConfig = function() {
        var config = $scope.warmupConfig;
        
        if (!config.bounds.minLat || !config.bounds.maxLat || 
            !config.bounds.minLon || !config.bounds.maxLon) {
            NotificationDialog.warning('Por favor, defina os limites geográficos', 'Erro de Validação');
            return false;
        }
        
        if (config.zoomLevels.min > config.zoomLevels.max) {
            NotificationDialog.warning('Zoom mínimo não pode ser maior que zoom máximo', 'Erro de Validação');
            return false;
        }
        
        if (config.years.start > config.years.end) {
            NotificationDialog.warning('Ano inicial não pode ser maior que ano final', 'Erro de Validação');
            return false;
        }
        
        return true;
    };
    
    // Carregar tarefas ativas
    $scope.loadActiveTasks = function() {
        $scope.loading.tasks = true;
        
        requester._get('../api/cache/tasks/active', function(response) {
            $scope.loading.tasks = false;
            if (response && response.success) {
                $scope.activeTasks = response.data;
            } else {
                console.error('Error loading active tasks:', response);
            }
        });
    };
    
    // Obter status de uma tarefa específica
    $scope.getTaskStatus = function(taskId) {
        requester._get('../api/cache/tasks/' + taskId, function(response) {
            if (response && response.success) {
                var task = $scope.activeTasks.find(t => t.id === taskId);
                if (task) {
                    Object.assign(task, response.data);
                }
            } else {
                console.error('Error getting task status:', response);
            }
        });
    };
    
    // Cancelar tarefa
    $scope.cancelTask = function(taskId) {
        if (!confirm('Tem certeza que deseja cancelar esta tarefa?')) {
            return;
        }
        
        requester._delete('../api/cache/tasks/' + taskId, function(response) {
            if (response && response.success) {
                NotificationDialog.success('Tarefa cancelada com sucesso', 'Tarefa Cancelada');
                $scope.loadActiveTasks();
            } else {
                NotificationDialog.error('Erro ao cancelar tarefa', 'Erro');
            }
        });
    };
    
    // Analisar padrões de cache
    $scope.analyzeCachePatterns = function(days) {
        $scope.loading.recommendations = true;
        
        requester._post('../api/cache/analyze-patterns', { days: days || 7 }, function(response) {
            $scope.loading.recommendations = false;
            if (response && response.success) {
                $scope.cacheAnalysis.patterns = response.data.patterns;
                $scope.cacheAnalysis.heatmap = response.data.heatmap;
                $scope.cacheAnalysis.temporal_distribution = response.data.temporal_distribution;
                $scope.cacheAnalysis.geographic_distribution = response.data.geographic_distribution;
                
                // Gerar visualizações
                $scope.generateTemporalChart();
                $scope.generateGeographicMap();
                $scope.generateHeatmap(response.data.heatmap);
            } else {
                console.error('Error analyzing patterns:', response);
            }
        });
    };
    
    // Obter recomendações de cache
    $scope.getCacheRecommendations = function() {
        $scope.loading.recommendations = true;
        
        requester._get('../api/cache/recommendations', function(response) {
            $scope.loading.recommendations = false;
            if (response && response.success) {
                $scope.cacheAnalysis.recommendations = response.recommendations || [];
                $scope.cacheAnalysis.stats = response.stats || {
                    totalPoints: 0,
                    cachedPoints: 0,
                    cachePercentage: '0'
                };
                
                // Process recommendations to add display properties
                $scope.cacheAnalysis.recommendations.forEach(function(rec) {
                    // Map type to title and icon
                    switch(rec.type) {
                        case 'zoom_optimization':
                            rec.title = 'Otimização de Níveis de Zoom';
                            rec.icon = 'fa-search-plus';
                            break;
                        case 'geographic_optimization':
                            rec.title = 'Otimização Geográfica';
                            rec.icon = 'fa-map-marked-alt';
                            break;
                        case 'temporal_optimization':
                            rec.title = 'Otimização Temporal';
                            rec.icon = 'fa-clock';
                            break;
                        default:
                            rec.title = 'Recomendação';
                            rec.icon = 'fa-lightbulb';
                    }
                });
            } else {
                console.error('Error getting recommendations:', response);
                $scope.cacheAnalysis.recommendations = [];
                $scope.cacheAnalysis.stats = {
                    totalPoints: 0,
                    cachedPoints: 0,
                    cachePercentage: '0'
                };
            }
        });
    };
    
    // Limpar cache
    $scope.clearCache = function() {
        if (!$scope.clearConfig.confirm) {
            NotificationDialog.warning('Por favor, marque a caixa de confirmação', 'Confirmação Necessária');
            return;
        }
        
        var params = {};
        
        switch ($scope.clearConfig.type) {
            case 'layer':
                params.layer = $scope.clearConfig.layer;
                break;
            case 'campaign':
                params.campaign = $scope.clearConfig.campaign;
                break;
            case 'selective':
                params.layer = $scope.clearConfig.layer;
                params.year = $scope.clearConfig.year;
                break;
        }
        
        requester._delete('../api/cache/clear', params, function(response) {
            if (response && response.success) {
                NotificationDialog.success(`${response.data.removed} itens removidos`, 'Cache Limpo');
                $scope.loadStats();
                $scope.clearConfig.confirm = false;
            } else {
                NotificationDialog.error('Erro ao limpar cache: ' + (response?.details || 'Erro desconhecido'), 'Erro');
            }
        });
    };
    
    // Gerar gráfico temporal
    $scope.generateTemporalChart = function() {
        if (!$scope.cacheAnalysis.patterns || $scope.cacheAnalysis.patterns.length === 0) {
            return;
        }
        
        $timeout(function() {
            var ctx = document.getElementById('temporal-chart');
            if (!ctx) return;
            
            // Processar dados temporais dos padrões
            var temporalData = {};
            $scope.cacheAnalysis.patterns.forEach(function(pattern) {
                var hour = pattern._id.hour;
                var date = pattern._id.date;
                var key = hour + ':00';
                
                if (!temporalData[key]) {
                    temporalData[key] = 0;
                }
                temporalData[key] += pattern.count;
            });
            
            var labels = Object.keys(temporalData).sort();
            var data = labels.map(function(label) {
                return temporalData[label];
            });
            
            if ($scope.temporalChart) {
                $scope.temporalChart.destroy();
            }
            
            $scope.temporalChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Acessos por Hora',
                        data: data,
                        borderColor: '#4CAF50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Padrão Temporal de Acessos'
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Número de Acessos'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Hora do Dia'
                            }
                        }
                    }
                }
            });
        }, 100);
    };
    
    // Gerar gráfico geográfico (distribuição por campanha)
    // Gerar mapa Leaflet interativo
    $scope.generateGeographicMap = function() {
        if (!$scope.cacheAnalysis.patterns || $scope.cacheAnalysis.patterns.length === 0) {
            return;
        }
        
        $timeout(function() {
            var mapContainer = document.getElementById('geographic-map');
            if (!mapContainer) return;
            
            // Destruir mapa anterior se existir
            if ($scope.geographicMap) {
                $scope.geographicMap.remove();
            }
            
            // Inicializar mapa Leaflet
            $scope.geographicMap = L.map('geographic-map', {
                center: [-15.0, -50.0], // Centro do Brasil
                zoom: 4,
                zoomControl: true
            });
            
            // Adicionar camada base
            L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                attribution: '© Google Maps',
                maxZoom: 18
            }).addTo($scope.geographicMap);
            
            // Processar dados para pontos do mapa
            var pointsData = [];
            var campaignColors = {
                'default': '#FF6384'
            };
            var colorIndex = 0;
            var colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
            
            $scope.cacheAnalysis.patterns.forEach(function(pattern) {
                if (pattern.points && pattern.points.length > 0) {
                    var campaign = pattern._id.campaign;
                    
                    // Atribuir cor à campanha se não tiver
                    if (!campaignColors[campaign]) {
                        campaignColors[campaign] = colors[colorIndex % colors.length];
                        colorIndex++;
                    }
                    
                    pattern.points.forEach(function(point) {
                        pointsData.push({
                            lat: point.lat,
                            lon: point.lon,
                            campaign: campaign,
                            count: pattern.count,
                            date: pattern._id.date,
                            hour: pattern._id.hour,
                            color: campaignColors[campaign]
                        });
                    });
                }
            });
            
            // Criar clusters para os pontos
            var markers = L.markerClusterGroup({
                chunkedLoading: true,
                maxClusterRadius: 50
            });
            
            // Adicionar marcadores ao cluster
            pointsData.forEach(function(point) {
                var marker = L.circleMarker([point.lat, point.lon], {
                    radius: Math.max(5, Math.min(15, point.count / 5)),
                    fillColor: point.color,
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.7
                });
                
                // Popup com informações
                marker.bindPopup(
                    '<div class="map-popup">' +
                    '<h4>Ponto de Uso</h4>' +
                    '<p><strong>Campanha:</strong> ' + point.campaign + '</p>' +
                    '<p><strong>Data:</strong> ' + point.date + '</p>' +
                    '<p><strong>Hora:</strong> ' + point.hour + 'h</p>' +
                    '<p><strong>Acessos:</strong> ' + point.count + '</p>' +
                    '<p><strong>Coordenadas:</strong> ' + point.lat.toFixed(4) + ', ' + point.lon.toFixed(4) + '</p>' +
                    '</div>'
                );
                
                markers.addLayer(marker);
            });
            
            $scope.geographicMap.addLayer(markers);
            
            // Ajustar visualização para mostrar todos os pontos
            if (pointsData.length > 0) {
                var group = new L.featureGroup(markers.getLayers());
                $scope.geographicMap.fitBounds(group.getBounds().pad(0.1));
            }
            
            // Adicionar legenda das campanhas
            $scope.createMapLegend(campaignColors);
            
            // Adicionar camada de heatmap se dados disponíveis
            if ($scope.cacheAnalysis.heatmap && $scope.cacheAnalysis.heatmap.length > 0) {
                $scope.addHeatmapLayer($scope.cacheAnalysis.heatmap);
            } else {
                // Criar heatmap dos dados de patterns como fallback
                var heatmapData = [];
                pointsData.forEach(function(point) {
                    heatmapData.push([point.lat, point.lon, Math.min(point.count / 5, 1)]);
                });
                $scope.addSimpleHeatmapLayer(heatmapData);
            }
            
            // Adicionar controles de camadas
            $scope.addLayerControls();
            
        }, 100);
    };
    
    // Criar legenda do mapa
    $scope.createMapLegend = function(campaignColors) {
        if ($scope.mapLegend) {
            $scope.geographicMap.removeControl($scope.mapLegend);
        }
        
        $scope.mapLegend = L.control({position: 'bottomright'});
        
        $scope.mapLegend.onAdd = function(map) {
            var div = L.DomUtil.create('div', 'map-legend');
            div.innerHTML = '<h4>Campanhas</h4>';
            
            Object.keys(campaignColors).forEach(function(campaign) {
                if (campaign !== 'default') {
                    div.innerHTML += 
                        '<div class="legend-item">' +
                        '<span class="legend-color" style="background-color:' + campaignColors[campaign] + '"></span>' +
                        '<span class="legend-label">' + campaign + '</span>' +
                        '</div>';
                }
            });
            
            return div;
        };
        
        $scope.mapLegend.addTo($scope.geographicMap);
    };

    // Adicionar camada de heatmap usando dados da API
    $scope.addHeatmapLayer = function(heatmapData) {
        if (!heatmapData || heatmapData.length === 0 || !$scope.geographicMap) {
            return;
        }

        // Criar círculos coloridos para representar a intensidade
        var heatmapLayer = L.layerGroup();
        var maxIntensity = Math.max.apply(Math, heatmapData.map(function(point) {
            return point.intensity;
        }));

        heatmapData.forEach(function(point) {
            var normalizedIntensity = point.intensity / maxIntensity;
            var radius = Math.max(5, normalizedIntensity * 50);
            var opacity = Math.max(0.3, normalizedIntensity);
            
            // Gradiente de cor baseado na intensidade (azul -> amarelo -> vermelho)
            var color = $scope.getHeatmapColor(normalizedIntensity);

            var circle = L.circle([point.lat, point.lon], {
                radius: radius * 1000, // Convertendo para metros
                fillColor: color,
                color: color,
                weight: 1,
                opacity: opacity,
                fillOpacity: opacity * 0.6
            });

            circle.bindPopup(
                '<div class="heatmap-popup">' +
                '<h4>Área de Intensidade</h4>' +
                '<p><strong>Intensidade:</strong> ' + point.intensity + '</p>' +
                '<p><strong>Coordenadas:</strong> ' + point.lat.toFixed(4) + ', ' + point.lon.toFixed(4) + '</p>' +
                '</div>'
            );

            heatmapLayer.addLayer(circle);
        });

        // Armazenar referência da camada
        $scope.heatmapLayer = heatmapLayer;
        $scope.geographicMap.addLayer(heatmapLayer);
    };

    // Adicionar camada de heatmap simples usando dados dos patterns
    $scope.addSimpleHeatmapLayer = function(heatmapData) {
        if (!heatmapData || heatmapData.length === 0 || !$scope.geographicMap) {
            return;
        }

        var heatmapLayer = L.layerGroup();
        
        heatmapData.forEach(function(point) {
            var lat = point[0];
            var lon = point[1];
            var intensity = point[2];
            
            var radius = Math.max(3, intensity * 30);
            var opacity = Math.max(0.2, intensity);
            var color = $scope.getHeatmapColor(intensity);

            var circle = L.circle([lat, lon], {
                radius: radius * 1000,
                fillColor: color,
                color: color,
                weight: 1,
                opacity: opacity,
                fillOpacity: opacity * 0.5
            });

            circle.bindPopup(
                '<div class="heatmap-popup">' +
                '<h4>Ponto de Calor</h4>' +
                '<p><strong>Intensidade:</strong> ' + (intensity * 100).toFixed(1) + '%</p>' +
                '<p><strong>Coordenadas:</strong> ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '</p>' +
                '</div>'
            );

            heatmapLayer.addLayer(circle);
        });

        $scope.heatmapLayer = heatmapLayer;
        $scope.geographicMap.addLayer(heatmapLayer);
    };

    // Obter cor baseada na intensidade do heatmap
    $scope.getHeatmapColor = function(intensity) {
        // Gradiente de azul (baixa) para vermelho (alta) passando por amarelo
        if (intensity < 0.33) {
            // Azul para Amarelo
            var ratio = intensity / 0.33;
            var r = Math.round(ratio * 255);
            var g = Math.round(ratio * 255);
            var b = Math.round(255 - (ratio * 255));
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        } else if (intensity < 0.66) {
            // Amarelo para Laranja
            var ratio = (intensity - 0.33) / 0.33;
            var r = 255;
            var g = Math.round(255 - (ratio * 100));
            var b = 0;
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        } else {
            // Laranja para Vermelho
            var ratio = (intensity - 0.66) / 0.34;
            var r = 255;
            var g = Math.round(155 - (ratio * 155));
            var b = 0;
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
    };

    // Adicionar controles de camadas para alternar entre marcadores e heatmap
    $scope.addLayerControls = function() {
        if (!$scope.geographicMap) return;

        var overlayMaps = {};
        
        if ($scope.heatmapLayer) {
            overlayMaps["Mapa de Calor"] = $scope.heatmapLayer;
        }

        // Adicionar controle de camadas somente se houver camadas para controlar
        if (Object.keys(overlayMaps).length > 0) {
            var layerControl = L.control.layers(null, overlayMaps, {
                position: 'topright',
                collapsed: false
            });
            layerControl.addTo($scope.geographicMap);
        }
    };

    // Métodos auxiliares para cálculos no template
    $scope.getTotalPatternAccesses = function() {
        if (!$scope.cacheAnalysis.patterns || $scope.cacheAnalysis.patterns.length === 0) {
            return 0;
        }
        var total = 0;
        for (var i = 0; i < $scope.cacheAnalysis.patterns.length; i++) {
            total += $scope.cacheAnalysis.patterns[i].count || 0;
        }
        return total;
    };

    $scope.getTotalUniquePoints = function() {
        if (!$scope.cacheAnalysis.patterns || $scope.cacheAnalysis.patterns.length === 0) {
            return 0;
        }
        var total = 0;
        for (var i = 0; i < $scope.cacheAnalysis.patterns.length; i++) {
            var pattern = $scope.cacheAnalysis.patterns[i];
            if (pattern.points && pattern.points.length) {
                total += pattern.points.length;
            }
        }
        return total;
    };

    $scope.getActiveCampaignsCount = function() {
        if (!$scope.cacheAnalysis.patterns || $scope.cacheAnalysis.patterns.length === 0) {
            return 0;
        }
        var campaigns = {};
        for (var i = 0; i < $scope.cacheAnalysis.patterns.length; i++) {
            var campaign = $scope.cacheAnalysis.patterns[i]._id.campaign;
            if (campaign) {
                campaigns[campaign] = true;
            }
        }
        return Object.keys(campaigns).length;
    };

    // Função mantida para compatibilidade (agora obsoleta - use generateGeographicMap)
    $scope.generateGeographicChart = function() {
        // Esta função foi substituída por generateGeographicMap()
        console.log('generateGeographicChart is deprecated, use generateGeographicMap instead');
    };
    
    // Gerar heatmap de uso
    $scope.generateHeatmap = function(data) {
        if (!data || data.length === 0) {
            return;
        }
        
        $timeout(function() {
            var container = document.getElementById('cache-heatmap');
            if (!container) return;
            
            // Limpar container anterior
            container.innerHTML = '';
            
            // Criar mapa simples com coordenadas
            var mapHtml = '<div class="heatmap-simple">';
            mapHtml += '<h4>Áreas Mais Acessadas</h4>';
            mapHtml += '<div class="heatmap-grid">';
            
            data.forEach(function(point, index) {
                var intensity = point.intensity || 1;
                var opacity = Math.min(intensity / 20, 1); // Normalizar intensidade
                
                mapHtml += '<div class="heatmap-point" style="opacity: ' + opacity + '">';
                mapHtml += '<span class="coordinates">Lat: ' + point.lat.toFixed(2) + ', Lon: ' + point.lon.toFixed(2) + '</span>';
                mapHtml += '<span class="intensity">Intensidade: ' + intensity + '</span>';
                mapHtml += '</div>';
            });
            
            mapHtml += '</div></div>';
            container.innerHTML = mapHtml;
        }, 100);
    };
    
    // Formatar bytes
    $scope.formatBytes = function(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };
    
    // Formatar tempo decorrido
    $scope.formatElapsedTime = function(startTime) {
        if (!startTime) return '-';
        
        var elapsed = Date.now() - new Date(startTime).getTime();
        var seconds = Math.floor(elapsed / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return hours + 'h ' + (minutes % 60) + 'm';
        } else if (minutes > 0) {
            return minutes + 'm ' + (seconds % 60) + 's';
        } else {
            return seconds + 's';
        }
    };
    
    // Obter cor do progresso
    $scope.getProgressColor = function(progress) {
        if (progress < 30) return 'danger';
        if (progress < 70) return 'warning';
        return 'success';
    };
    
    // Obter ícone do status
    $scope.getStatusIcon = function(status) {
        switch (status) {
            case 'pending': return 'fa-clock';
            case 'processing': return 'fa-spinner fa-spin';
            case 'completed': return 'fa-check-circle';
            case 'failed': return 'fa-times-circle';
            case 'cancelled': return 'fa-ban';
            default: return 'fa-question-circle';
        }
    };
    
    // Obter cor do status
    $scope.getStatusColor = function(status) {
        switch (status) {
            case 'pending': return 'info';
            case 'processing': return 'primary';
            case 'completed': return 'success';
            case 'failed': return 'danger';
            case 'cancelled': return 'warning';
            default: return 'secondary';
        }
    };
    
    // === NOVOS MÉTODOS DE GERENCIAMENTO DE TASKS ===
    
    // Carregar lista completa de tasks
    $scope.loadTasksList = function() {
        $scope.tasksManagement.loading.list = true;
        
        requester._get('../api/tasks/list', function(response) {
            $scope.tasksManagement.loading.list = false;
            if (response && response.success) {
                var data = response.data;
                
                // Process active tasks with better structure
                $scope.activeTasks = (data.active || []).map(function(task) {
                    return {
                        id: task.task_id,
                        type: task.name ? task.name.split('.').pop() : 'Unknown',
                        status: task.state ? task.state.toLowerCase() : 'active',
                        createdAt: task.date_done || new Date(),
                        worker: task.worker,
                        args: task.args,
                        config: {
                            point_id: task.args && task.args[0] ? task.args[0] : null,
                            layer: task.name && task.name.includes('cache_point') ? 'cache_point' : 'cache'
                        }
                    };
                });
                
                $scope.tasksManagement.scheduled = data.scheduled || [];
                $scope.tasksManagement.reserved = data.reserved || [];
                $scope.tasksManagement.stats = data.stats || {};
            } else {
                console.error('Error loading tasks list:', response);
                NotificationDialog.error('Erro ao carregar lista de tasks', 'Erro');
            }
        });
    };
    
    // Carregar estatísticas dos workers
    $scope.loadWorkersStats = function() {
        $scope.tasksManagement.loading.workers = true;
        
        requester._get('../api/tasks/workers', function(response) {
            $scope.tasksManagement.loading.workers = false;
            if (response && response.success && response.data) {
                var workersData = response.data.workers || {};
                
                // Convert workers object to array for easier iteration
                $scope.tasksManagement.workers = Object.keys(workersData).map(function(workerName) {
                    var worker = workersData[workerName];
                    return {
                        hostname: workerName,
                        status: worker.active_tasks > 0 ? 'active' : 'idle',
                        active_tasks: worker.active_tasks || 0,
                        processed: worker.stats && worker.stats.total ? 
                            Object.values(worker.stats.total).reduce(function(sum, val) { return sum + val; }, 0) : 0,
                        pool: worker.pool || {},
                        last_heartbeat: new Date() // Since API doesn't provide this
                    };
                });
                
                // Update general stats
                if (response.data.total_workers) {
                    $scope.tasksManagement.stats.workers_count = response.data.total_workers;
                }
            } else {
                console.error('Error loading workers stats:', response);
                NotificationDialog.error('Erro ao carregar estatísticas dos workers', 'Erro');
            }
        });
    };
    
    // Carregar tasks registradas
    $scope.loadRegisteredTasks = function() {
        $scope.tasksManagement.loading.registered = true;
        
        requester._get('../api/tasks/registered', function(response) {
            $scope.tasksManagement.loading.registered = false;
            if (response && response.success && response.data) {
                // A API retorna um array de strings com os nomes das tarefas
                // Vamos transformar em objetos com estrutura esperada pelo template
                if (Array.isArray(response.data)) {
                    $scope.tasksManagement.registeredTasks = response.data.map(function(taskName) {
                        // Extrair informações do nome da tarefa
                        var parts = taskName.split('.');
                        var category = parts.length > 1 ? parts[parts.length - 2] : 'general';
                        var name = parts[parts.length - 1];
                        
                        return {
                            name: taskName,
                            displayName: name,
                            category: category,
                            type: taskName.includes('cache') ? 'cache' : 'regular',
                            rate_limit: null,
                            time_limit: null,
                            max_retries: 3,
                            status: 'registered'
                        };
                    });
                } else {
                    // Se não for array, usar como está
                    $scope.tasksManagement.registeredTasks = response.data;
                }
            } else {
                console.error('Error loading registered tasks:', response);
                NotificationDialog.error('Erro ao carregar tasks registradas', 'Erro');
            }
        });
    };
    
    // Carregar informações das filas
    $scope.loadQueueInfo = function() {
        $scope.tasksManagement.loading.queue = true;
        
        requester._get('../api/tasks/queue-length', function(response) {
            $scope.tasksManagement.loading.queue = false;
            if (response && response.success) {
                $scope.tasksManagement.queueInfo = response.data;
            } else {
                console.error('Error loading queue info:', response);
                NotificationDialog.error('Erro ao carregar informações das filas', 'Erro');
            }
        });
    };
    
    // Limpar tasks da fila
    $scope.purgeTasks = function() {
        var confirmMsg = 'Tem certeza que deseja limpar as tasks';
        if ($scope.tasksManagement.selectedQueue) {
            confirmMsg += ' da fila ' + $scope.tasksManagement.selectedQueue;
        }
        if ($scope.tasksManagement.selectedState) {
            confirmMsg += ' com estado ' + $scope.tasksManagement.selectedState;
        }
        confirmMsg += '? Esta ação não pode ser desfeita!';
        
        if (!confirm(confirmMsg)) {
            return;
        }
        
        $scope.tasksManagement.loading.purge = true;
        
        var params = '?';
        if ($scope.tasksManagement.selectedQueue) {
            params += 'queue_name=' + $scope.tasksManagement.selectedQueue + '&';
        }
        if ($scope.tasksManagement.selectedState) {
            params += 'state=' + $scope.tasksManagement.selectedState;
        }
        
        requester._post('../api/tasks/purge' + params, {}, function(response) {
            $scope.tasksManagement.loading.purge = false;
            if (response && response.success) {
                NotificationDialog.success('Tasks removidas com sucesso', 'Limpeza Concluída');
                $scope.loadTasksList();
                $scope.loadQueueInfo();
            } else {
                NotificationDialog.error('Erro ao limpar tasks: ' + (response?.details || 'Erro desconhecido'), 'Erro');
            }
        });
    };
    
    // Obter status detalhado de uma task por ID
    $scope.getTaskStatusById = function(taskId) {
        requester._get('../api/tasks/status/' + taskId, function(response) {
            if (response && response.success) {
                // Mostrar modal ou atualizar UI com detalhes
                $scope.showTaskDetails(response.data);
            } else {
                NotificationDialog.error('Erro ao obter status da task', 'Erro');
            }
        });
    };
    
    // Mostrar detalhes da task em modal
    $scope.showTaskDetails = function(taskData) {
        // TODO: Implementar modal de detalhes
        console.log('Task details:', taskData);
        NotificationDialog.info('Task ID: ' + taskData.id + '\nStatus: ' + taskData.status, 'Detalhes da Task');
    };
    
    // Atualizar loadActiveTasks para usar o novo método
    $scope.loadActiveTasks = function() {
        $scope.loadTasksList();
    };
    
    // Trocar aba
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        
        // Carregar dados específicos da aba
        switch (tab) {
            case 'monitoring':
                $scope.loadTasksList();
                $scope.loadWorkersStats();
                $scope.loadQueueInfo();
                $scope.loadRegisteredTasks();
                break;
            case 'analysis':
                $scope.analyzeCachePatterns(7);
                $scope.getCacheRecommendations();
                break;
        }
    };
    
    // === FUNÇÕES PARA GERENCIAR CAMPANHAS (do sistema antigo) ===
    
    // Carregar status geral do cache
    $scope.loadCacheStatus = function() {
        $scope.loading.status = true;
        
        requester._get('cache/status', {}, function(data) {
            $scope.loading.status = false;
            
            if (data.success) {
                $scope.cacheStatus = data;
                $scope.updateCampaignsTotalPages();
            } else {
                console.error('Erro ao carregar status do cache:', data.error);
            }
        });
    };

    // Obter classe CSS para porcentagem de cache
    $scope.getCachePercentageClass = function(percentage) {
        if (percentage >= 90) return 'success';
        if (percentage >= 70) return 'warning';
        return 'danger';
    };

    // Atualizar paginação quando mudar itens por página
    $scope.updateCampaignsPagination = function() {
        $scope.campaignsPagination.currentPage = 1;
        $scope.updateCampaignsTotalPages();
    };

    // Atualizar total de páginas
    $scope.updateCampaignsTotalPages = function() {
        $scope.updateFilteredCampaigns();
        
        if ($scope.filteredCampaigns.length > 0) {
            $scope.campaignsPagination.totalPages = Math.ceil($scope.filteredCampaigns.length / $scope.campaignsPagination.itemsPerPage);
        } else {
            $scope.campaignsPagination.totalPages = 1;
        }
        
        $scope.updatePaginatedCampaigns();
    };

    // Atualizar campanhas filtradas
    $scope.updateFilteredCampaigns = function() {
        if (!$scope.cacheStatus.campaigns || $scope.cacheStatus.campaigns.length === 0) {
            $scope.filteredCampaigns = [];
            return;
        }

        var campaigns = $scope.cacheStatus.campaigns;
        
        // Aplicar filtro de busca por ID se houver
        if ($scope.campaignSearch.searchId && $scope.campaignSearch.searchId.length > 0) {
            var searchTerm = $scope.campaignSearch.searchId.toLowerCase();
            campaigns = campaigns.filter(function(campaign) {
                return campaign._id.toLowerCase().indexOf(searchTerm) !== -1;
            });
        }
        
        $scope.filteredCampaigns = campaigns;
    };

    // Atualizar campanhas paginadas
    $scope.updatePaginatedCampaigns = function() {
        if ($scope.filteredCampaigns.length === 0) {
            $scope.paginatedCampaigns = [];
            return;
        }

        var start = ($scope.campaignsPagination.currentPage - 1) * $scope.campaignsPagination.itemsPerPage;
        var end = start + parseInt($scope.campaignsPagination.itemsPerPage);
        
        $scope.paginatedCampaigns = $scope.filteredCampaigns.slice(start, end);
    };
    
    // Funções mantidas para compatibilidade mas que retornam valores armazenados
    $scope.getFilteredCampaigns = function() {
        return $scope.filteredCampaigns;
    };

    $scope.getCampaignsPaginated = function() {
        return $scope.paginatedCampaigns;
    };

    // Mudar página
    $scope.changeCampaignsPage = function(page) {
        if (page < 1 || page > $scope.campaignsPagination.totalPages) {
            return;
        }
        $scope.campaignsPagination.currentPage = page;
        $scope.updatePaginatedCampaigns();
    };

    // Obter range de páginas para mostrar na paginação
    $scope.getCampaignsPaginationRange = function() {
        var pages = [];
        var totalPages = $scope.campaignsPagination.totalPages;
        var currentPage = $scope.campaignsPagination.currentPage;
        var maxPagesToShow = 5;

        if (totalPages <= maxPagesToShow) {
            // Mostrar todas as páginas
            for (var i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            // Mostrar página atual e algumas ao redor
            var startPage = Math.max(1, currentPage - 2);
            var endPage = Math.min(totalPages, currentPage + 2);

            // Ajustar se estiver no início ou fim
            if (currentPage <= 3) {
                endPage = maxPagesToShow;
            } else if (currentPage >= totalPages - 2) {
                startPage = totalPages - maxPagesToShow + 1;
            }

            for (var i = startPage; i <= endPage; i++) {
                pages.push(i);
            }
        }

        return pages;
    };

    // Função para resetar busca
    $scope.clearCampaignSearch = function() {
        $scope.campaignSearch.searchId = '';
        $scope.campaignsPagination.currentPage = 1;
        $scope.updateCampaignsTotalPages();
    };

    // Watch para atualizar paginação quando busca mudar
    $scope.$watch('campaignSearch.searchId', function(newVal, oldVal) {
        if (newVal !== oldVal) {
            $scope.campaignsPagination.currentPage = 1;
            $scope.updateCampaignsTotalPages();
        }
    });

    // Watch para atualizar paginação quando campanhas mudarem
    $scope.$watch('cacheStatus.campaigns.length', function(newVal, oldVal) {
        if (newVal !== oldVal) {
            $scope.updateCampaignsTotalPages();
        }
    });

    // Point/Campaign cache configuration
    $scope.cacheManagement = {
        type: 'point', // 'point' or 'campaign'
        pointId: '',
        selectedCampaign: '',
        campaignSearch: '', // Para filtrar campanhas no select
        status: null,
        activeTasks: [],
        loading: {
            start: false,
            status: false,
            clear: false
        }
    };
    
    // Start point cache
    $scope.startPointCache = function() {
        if (!$scope.cacheManagement.pointId) {
            NotificationDialog.warning('Por favor, insira o ID do ponto', 'Erro');
            return;
        }
        
        $scope.cacheManagement.loading.start = true;
        
        // Use point_id (underscore) to match API expectation
        requester._post('../api/cache/point/start', {
            point_id: $scope.cacheManagement.pointId
        }, function(response) {
            $scope.cacheManagement.loading.start = false;
            
            if (response && response.success) {
                NotificationDialog.success(`Cache do ponto ${$scope.cacheManagement.pointId} iniciado com sucesso`, 'Cache Iniciado');
                // Automatically check status
                $scope.getPointCacheStatus();
            } else {
                NotificationDialog.error(response?.error || 'Erro ao iniciar cache do ponto', 'Erro');
            }
        });
    };
    
    // Get point cache status
    $scope.getPointCacheStatus = function() {
        if (!$scope.cacheManagement.pointId) {
            NotificationDialog.warning('Por favor, insira o ID do ponto', 'Erro');
            return;
        }
        
        $scope.cacheManagement.loading.status = true;
        
        requester._get('../api/cache/point/' + $scope.cacheManagement.pointId + '/status', function(response) {
            $scope.cacheManagement.loading.status = false;
            
            if (response && response.success) {
                $scope.cacheManagement.status = response.data;
            } else {
                NotificationDialog.error(response?.error || 'Erro ao verificar status do cache', 'Erro');
            }
        });
    };
    
    // Clear point cache
    $scope.clearPointCache = function() {
        if (!$scope.cacheManagement.pointId) {
            NotificationDialog.warning('Por favor, insira o ID do ponto', 'Erro');
            return;
        }
        
        if (!confirm(`Tem certeza que deseja limpar o cache do ponto ${$scope.cacheManagement.pointId}?`)) {
            return;
        }
        
        $scope.cacheManagement.loading.clear = true;
        
        requester._delete('../api/cache/point/' + $scope.cacheManagement.pointId, function(response) {
            $scope.cacheManagement.loading.clear = false;
            
            if (response && response.success) {
                NotificationDialog.success(`Cache do ponto ${$scope.cacheManagement.pointId} limpo com sucesso`, 'Cache Limpo');
                $scope.cacheManagement.status = null;
                $scope.loadStats(); // Refresh stats
            } else {
                NotificationDialog.error(response?.error || 'Erro ao limpar cache do ponto', 'Erro');
            }
        });
    };
    
    // Start campaign cache
    $scope.startCampaignCache = function() {
        if (!$scope.cacheManagement.selectedCampaign) {
            NotificationDialog.warning('Por favor, selecione uma campanha', 'Erro');
            return;
        }
        
        $scope.cacheManagement.loading.start = true;
        
        // Use campaign_id (underscore) to match API expectation
        // Include all new parameters
        var params = { 
            campaign_id: $scope.cacheManagement.selectedCampaign
        };
        
        // Add batch_size if configured
        if ($scope.cacheManagement.batchSize && $scope.cacheManagement.batchSize > 0) {
            params.batch_size = parseInt($scope.cacheManagement.batchSize);
        }
        
        // Add use_grid parameter (boolean)
        params.use_grid = !!$scope.cacheManagement.useGrid;
        
        // Add priority_recent_years parameter (boolean)
        params.priority_recent_years = !!$scope.cacheManagement.priorityRecentYears;
        
        requester._post('../api/cache/campaign/start', params, function(response) {
            $scope.cacheManagement.loading.start = false;
            
            if (response && response.success) {
                NotificationDialog.success(`Cache da campanha ${$scope.cacheManagement.selectedCampaign} iniciado com sucesso`, 'Cache Iniciado');
                // Add task to active tasks
                if (response.data && response.data.task_id) {
                    $scope.cacheManagement.activeTasks.push({
                        id: response.data.task_id,
                        campaign: $scope.cacheManagement.selectedCampaign,
                        status: 'processing',
                        createdAt: new Date()
                    });
                }
                // Automatically check status
                $scope.getCampaignCacheStatus();
            } else {
                NotificationDialog.error(response?.error || 'Erro ao iniciar cache da campanha', 'Erro');
            }
        });
    };
    
    // Get campaign cache status
    $scope.getCampaignCacheStatus = function() {
        if (!$scope.cacheManagement.selectedCampaign) {
            NotificationDialog.warning('Por favor, selecione uma campanha', 'Erro');
            return;
        }
        
        $scope.cacheManagement.loading.status = true;
        
        requester._get('../api/cache/campaign/' + $scope.cacheManagement.selectedCampaign + '/status', function(response) {
            $scope.cacheManagement.loading.status = false;
            
            if (response && response.success) {
                $scope.cacheManagement.status = response.data;
                
                // Update active tasks if status contains task info
                if (response.data.active_tasks) {
                    $scope.cacheManagement.activeTasks = response.data.active_tasks;
                }
            } else {
                NotificationDialog.error(response?.error || 'Erro ao verificar status do cache', 'Erro');
            }
        });
    };
    
    // Clear campaign cache
    $scope.clearCampaignCache = function() {
        if (!$scope.cacheManagement.selectedCampaign) {
            NotificationDialog.warning('Por favor, selecione uma campanha', 'Erro');
            return;
        }
        
        if (!confirm(`Tem certeza que deseja limpar o cache da campanha ${$scope.cacheManagement.selectedCampaign}?`)) {
            return;
        }
        
        $scope.cacheManagement.loading.clear = true;
        
        requester._delete('../api/cache/campaign/' + $scope.cacheManagement.selectedCampaign, function(response) {
            $scope.cacheManagement.loading.clear = false;
            
            if (response && response.success) {
                NotificationDialog.success(`Cache da campanha ${$scope.cacheManagement.selectedCampaign} limpo com sucesso`, 'Cache Limpo');
                $scope.cacheManagement.status = null;
                $scope.cacheManagement.activeTasks = [];
                $scope.loadStats(); // Refresh stats
                $scope.loadCacheStatus(); // Refresh campaign list
            } else {
                NotificationDialog.error(response?.error || 'Erro ao limpar cache da campanha', 'Erro');
            }
        });
    };
    
    // Cancel specific task
    $scope.cancelCacheTask = function(taskId) {
        if (!confirm('Tem certeza que deseja cancelar esta tarefa?')) {
            return;
        }
        
        requester._delete('../api/cache/tasks/' + taskId, function(response) {
            if (response && response.success) {
                NotificationDialog.success('Tarefa cancelada com sucesso', 'Tarefa Cancelada');
                
                // Remove from active tasks
                $scope.cacheManagement.activeTasks = $scope.cacheManagement.activeTasks.filter(function(task) {
                    return task.id !== taskId;
                });
                
                // Refresh status
                if ($scope.cacheManagement.type === 'campaign') {
                    $scope.getCampaignCacheStatus();
                }
            } else {
                NotificationDialog.error(response?.error || 'Erro ao cancelar tarefa', 'Erro');
            }
        });
    };
    
    // Filter campaigns for select dropdown
    $scope.getFilteredCampaignsForSelect = function() {
        if (!$scope.cacheStatus.campaigns || $scope.cacheStatus.campaigns.length === 0) {
            return [];
        }
        
        // If no search term, return all campaigns
        if (!$scope.cacheManagement.campaignSearch || $scope.cacheManagement.campaignSearch.trim() === '') {
            return $scope.cacheStatus.campaigns;
        }
        
        // Filter campaigns by search term (case insensitive)
        var searchTerm = $scope.cacheManagement.campaignSearch.toLowerCase();
        return $scope.cacheStatus.campaigns.filter(function(campaign) {
            return campaign._id.toLowerCase().indexOf(searchTerm) !== -1;
        });
    };
    
    // Reset cache management form
    $scope.resetCacheManagement = function() {
        $scope.cacheManagement.status = null;
        $scope.cacheManagement.activeTasks = [];
        $scope.cacheManagement.pointId = '';
        $scope.cacheManagement.selectedCampaign = '';
    };
    
    // Watch for type change
    $scope.$watch('cacheManagement.type', function(newVal, oldVal) {
        if (newVal !== oldVal) {
            $scope.resetCacheManagement();
        }
    });
    
    // Voltar para admin
    $scope.goBack = function() {
        $location.path('/admin/home');
    };
    
    // Cleanup ao sair
    $scope.$on('$destroy', function() {
        if ($scope.statsInterval) {
            $interval.cancel($scope.statsInterval);
        }
        if ($scope.tasksInterval) {
            $interval.cancel($scope.tasksInterval);
        }
        socket.disconnect();
    });
    
    // Inicializar
    $scope.init();
});
