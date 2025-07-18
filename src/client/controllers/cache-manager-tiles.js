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
    
    // Estatísticas da API de Tiles
    $scope.tilesStats = {
        redis: {
            hits: 0,
            misses: 0,
            size: 0,
            memory: 0
        },
        storage: {
            tiles: 0,
            size: 0,
            campaigns: []
        },
        performance: {
            avgResponseTime: 0,
            requestsPerMinute: 0,
            errorRate: 0
        }
    };
    
    // Lista de tarefas ativas
    $scope.activeTasks = [];
    
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
        heatmap: null
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
        $scope.setupSocketListeners();
        
        // Atualizar estatísticas a cada 30 segundos
        $scope.statsInterval = $interval(function() {
            if (!$scope.loading.stats) {
                $scope.loadStats();
                $scope.loadCacheStatus();
            }
        }, 30000);
    };
    
    // Configurar listeners do Socket.IO
    $scope.setupSocketListeners = function() {
        socket.on('connect', function() {
            console.log('Connected to cache updates');
            socket.emit('join', 'cache-updates');
        });
        
        socket.on('cache-stats-update', function(data) {
            $scope.$apply(function() {
                $scope.tilesStats = data;
            });
        });
        
        socket.on('task-created', function(task) {
            $scope.$apply(function() {
                $scope.activeTasks.unshift(task);
                NotificationDialog.show({
                    title: 'Nova Tarefa Criada',
                    message: `Tarefa ${task.id} iniciada: ${task.type}`,
                    type: 'info'
                });
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
                }
            });
        });
        
        socket.on('task-completed', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.status = 'completed';
                    task.completedAt = new Date();
                    NotificationDialog.show({
                        title: 'Tarefa Concluída',
                        message: `Tarefa ${data.taskId} concluída com sucesso`,
                        type: 'success'
                    });
                }
            });
        });
        
        socket.on('task-failed', function(data) {
            $scope.$apply(function() {
                var task = $scope.activeTasks.find(t => t.id === data.taskId);
                if (task) {
                    task.status = 'failed';
                    task.error = data.error;
                    NotificationDialog.show({
                        title: 'Erro na Tarefa',
                        message: `Tarefa ${data.taskId} falhou: ${data.error}`,
                        type: 'error'
                    });
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
                NotificationDialog.show({
                    title: 'Erro',
                    message: 'Erro ao carregar estatísticas',
                    type: 'error'
                });
            }
        });
    };
    
    // Calcular estatísticas derivadas
    $scope.calculateDerivedStats = function() {
        if ($scope.tilesStats.redis) {
            var total = $scope.tilesStats.redis.hits + $scope.tilesStats.redis.misses;
            $scope.tilesStats.redis.hitRate = total > 0 ? 
                (($scope.tilesStats.redis.hits / total) * 100).toFixed(2) : 0;
        }
    };
    
    // Carregar capabilities
    $scope.loadCapabilities = function() {
        $scope.loading.capabilities = true;
        
        var loaded = 0;
        var checkLoaded = function() {
            loaded++;
            if (loaded === 2) {
                $scope.loading.capabilities = false;
            }
        };
        
        requester._get('admin/landsat/capabilities', function(response) {
            if (response) {
                $scope.capabilities.landsat = response || [];
            }
            checkLoaded();
        });
        
        requester._get('admin/sentinel/capabilities', function(response) {
            if (response) {
                $scope.capabilities.sentinel = response || [];
            }
            checkLoaded();
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
                NotificationDialog.show({
                    title: 'Warmup Iniciado',
                    message: `Tarefa de warmup criada: ${response.data.task_id}`,
                    type: 'success'
                });
                $scope.loadActiveTasks();
            } else {
                NotificationDialog.show({
                    title: 'Erro',
                    message: 'Erro ao iniciar warmup: ' + (response?.details || 'Erro desconhecido'),
                    type: 'error'
                });
            }
        });
    };
    
    // Validar configuração de warmup
    $scope.validateWarmupConfig = function() {
        var config = $scope.warmupConfig;
        
        if (!config.bounds.minLat || !config.bounds.maxLat || 
            !config.bounds.minLon || !config.bounds.maxLon) {
            NotificationDialog.show({
                title: 'Erro de Validação',
                message: 'Por favor, defina os limites geográficos',
                type: 'warning'
            });
            return false;
        }
        
        if (config.zoomLevels.min > config.zoomLevels.max) {
            NotificationDialog.show({
                title: 'Erro de Validação',
                message: 'Zoom mínimo não pode ser maior que zoom máximo',
                type: 'warning'
            });
            return false;
        }
        
        if (config.years.start > config.years.end) {
            NotificationDialog.show({
                title: 'Erro de Validação',
                message: 'Ano inicial não pode ser maior que ano final',
                type: 'warning'
            });
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
                NotificationDialog.show({
                    title: 'Tarefa Cancelada',
                    message: 'Tarefa cancelada com sucesso',
                    type: 'success'
                });
                $scope.loadActiveTasks();
            } else {
                NotificationDialog.show({
                    title: 'Erro',
                    message: 'Erro ao cancelar tarefa',
                    type: 'error'
                });
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
                $scope.cacheAnalysis.recommendations = response.recommendations;
            } else {
                console.error('Error getting recommendations:', response);
            }
        });
    };
    
    // Limpar cache
    $scope.clearCache = function() {
        if (!$scope.clearConfig.confirm) {
            NotificationDialog.show({
                title: 'Confirmação Necessária',
                message: 'Por favor, marque a caixa de confirmação',
                type: 'warning'
            });
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
                NotificationDialog.show({
                    title: 'Cache Limpo',
                    message: `${response.data.removed} itens removidos`,
                    type: 'success'
                });
                $scope.loadStats();
                $scope.clearConfig.confirm = false;
            } else {
                NotificationDialog.show({
                    title: 'Erro',
                    message: 'Erro ao limpar cache: ' + (response?.details || 'Erro desconhecido'),
                    type: 'error'
                });
            }
        });
    };
    
    // Gerar heatmap de uso
    $scope.generateHeatmap = function(data) {
        // Implementar visualização de heatmap usando D3.js ou similar
        console.log('Heatmap data:', data);
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
    
    // Trocar aba
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        
        // Carregar dados específicos da aba
        switch (tab) {
            case 'monitoring':
                $scope.loadActiveTasks();
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

    // === FUNÇÕES DE PAGINAÇÃO DE CAMPANHAS ===
    
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

    // Voltar para admin
    $scope.goBack = function() {
        $location.path('/admin/home');
    };
    
    // Cleanup ao sair
    $scope.$on('$destroy', function() {
        if ($scope.statsInterval) {
            $interval.cancel($scope.statsInterval);
        }
        socket.disconnect();
    });
    
    // Inicializar
    $scope.init();
});