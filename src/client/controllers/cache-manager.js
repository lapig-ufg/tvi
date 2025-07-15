'use strict';

Application.controller('CacheManagerController', function ($scope, $interval, requester) {
    
    // Conectar socket para atualizações em tempo real com configuração otimizada
    var socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        transports: ['websocket', 'polling'] // Priorizar websocket
    });
    
    // Variáveis para acompanhar progresso em tempo real
    $scope.liveProgress = {
        isRunning: false,
        progress: 0,
        currentBatch: 0,
        totalBatches: 0,
        processedCount: 0,
        errorCount: 0,
        totalPoints: 0,
        simulate: false,
        recentLogs: [],
        startTime: null,
        elapsedTime: null,
        estimatedTime: null,
        pointsPerMinute: 0
    };
    
    $scope.cacheStatus = {
        totals: {},
        campaigns: []
    };
    
    $scope.uncachedPoints = {
        campaigns: [],
        totalUncachedPoints: 0
    };
    
    $scope.processing = {
        isProcessing: false,
        simulateMode: true,
        limitPoints: 10,
        campaignId: null,
        results: []
    };
    
    $scope.loading = {
        status: false,
        uncached: false,
        processing: false,
        job: false
    };
    
    $scope.jobStatus = {
        isConfigured: false,
        isEnabled: false,
        lastExecution: null,
        recentLogs: [],
        configuration: {}
    };
    
    $scope.jobConfig = {
        batchSize: 3,
        maxPointsPerRun: 15,
        simulate: true
    };

    // Variáveis para remoção de cache
    $scope.cacheRemoval = {
        type: 'campaign',
        campaignId: '',
        pointId: '',
        layer: '',
        year: null,
        x: null,
        y: null,
        z: null,
        isRemoving: false,
        lastResult: null
    };

    // Lista de pontos disponíveis para a campanha selecionada
    $scope.availablePoints = [];

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

    // Disponibilizar Math no escopo
    $scope.Math = Math;

    // === EVENTOS DE SOCKET PARA ATUALIZAÇÕES EM TEMPO REAL ===
    
    // Quando job de cache inicia
    socket.on('cache-job-started', function(data) {
        $scope.$apply(function() {
            $scope.liveProgress.isRunning = true;
            $scope.liveProgress.simulate = data.simulate;
            $scope.liveProgress.progress = 0;
            $scope.liveProgress.processedCount = 0;
            $scope.liveProgress.errorCount = 0;
            $scope.liveProgress.recentLogs = [];
            $scope.liveProgress.startTime = new Date();
            
            console.log('Job de cache iniciado:', data);
        });
    });
    
    // Quando pontos são encontrados para processamento
    socket.on('cache-points-found', function(data) {
        $scope.$apply(function() {
            $scope.liveProgress.totalPoints = data.totalPoints;
            $scope.liveProgress.totalBatches = data.totalBatches;
            
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: `Iniciando processamento de ${data.totalPoints} pontos em ${data.totalBatches} batches`
            });
            
            console.log('Pontos encontrados para cache:', data);
        });
    });
    
    // Progresso de cada batch
    socket.on('cache-batch-completed', function(data) {
        $scope.$apply(function() {
            $scope.liveProgress.currentBatch = data.batchNumber;
            $scope.liveProgress.totalBatches = data.totalBatches;
            $scope.liveProgress.processedCount = data.processedCount;
            $scope.liveProgress.errorCount = data.errorCount;
            $scope.liveProgress.progress = data.progress;
            
            // Calcular estimativas de tempo
            if ($scope.liveProgress.startTime && data.processedCount > 0) {
                var now = new Date();
                var elapsedMs = now - $scope.liveProgress.startTime;
                var elapsedMinutes = elapsedMs / 60000;
                
                $scope.liveProgress.elapsedTime = formatTime(elapsedMs);
                $scope.liveProgress.pointsPerMinute = Math.round(data.processedCount / elapsedMinutes);
                
                // Estimar tempo restante
                var remainingPoints = $scope.liveProgress.totalPoints - data.processedCount;
                if ($scope.liveProgress.pointsPerMinute > 0) {
                    var remainingMinutes = remainingPoints / $scope.liveProgress.pointsPerMinute;
                    $scope.liveProgress.estimatedTime = formatTime(remainingMinutes * 60000);
                }
            }
            
            var logMessage = `Batch ${data.batchNumber}/${data.totalBatches} concluído - ${data.processedCount} processados, ${data.errorCount} erros (${data.progress}%)`;
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: logMessage
            });
            
            // Manter apenas os últimos 10 logs
            if ($scope.liveProgress.recentLogs.length > 10) {
                $scope.liveProgress.recentLogs.shift();
            }
            
            console.log('Batch de cache concluído:', data);
        });
    });
    
    // Quando um ponto específico está sendo processado
    socket.on('cache-point-processing', function(data) {
        $scope.$apply(function() {
            var logMessage = `Processando ponto ${data.pointId} - ${data.campaign} (${data.period}/${data.year})`;
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: logMessage
            });
            
            // Manter apenas os últimos 10 logs
            if ($scope.liveProgress.recentLogs.length > 10) {
                $scope.liveProgress.recentLogs.shift();
            }
            
            console.log('Ponto sendo processado:', data);
        });
    });
    
    // Quando um ponto é concluído
    socket.on('cache-point-completed', function(data) {
        $scope.$apply(function() {
            var logMessage = `Ponto ${data.pointId} concluído - ${data.processedTiles}/${data.totalTiles} tiles processados`;
            if (data.errorTiles > 0) {
                logMessage += ` (${data.errorTiles} erros)`;
            }
            
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: logMessage
            });
            
            // Manter apenas os últimos 10 logs
            if ($scope.liveProgress.recentLogs.length > 10) {
                $scope.liveProgress.recentLogs.shift();
            }
            
            console.log('Ponto concluído:', data);
        });
    });
    
    // Quando há erro em um tile específico
    socket.on('cache-tile-error', function(data) {
        $scope.$apply(function() {
            $scope.liveProgress.errorCount++;
            
            var logMessage = `Erro no tile: ${data.url} - ${data.error}`;
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: logMessage
            });
            
            // Manter apenas os últimos 10 logs
            if ($scope.liveProgress.recentLogs.length > 10) {
                $scope.liveProgress.recentLogs.shift();
            }
            
            console.warn('Erro no tile:', data);
        });
    });
    
    // Quando um tile é processado com sucesso
    socket.on('cache-tile-success', function(data) {
        $scope.$apply(function() {
            // Apenas log em debug - não mostrar na UI para evitar spam
            console.log('Tile processado:', data.url, 'Status:', data.status);
        });
    });
    
    // Quando job é concluído
    socket.on('cache-job-completed', function(data) {
        $scope.$apply(function() {
            $scope.liveProgress.isRunning = false;
            $scope.liveProgress.progress = 100;
            
            var finalMessage = `Processamento concluído! ${data.totalProcessed} sucessos, ${data.totalErrors} erros`;
            $scope.liveProgress.recentLogs.push({
                timestamp: new Date(),
                message: finalMessage
            });
            
            // Atualizar dados após conclusão
            setTimeout(function() {
                $scope.loadCacheStatus();
                $scope.loadUncachedPoints();
                $scope.loadJobStatus();
            }, 1000);
            
            console.log('Job de cache concluído:', data);
        });
    });

    // Inicialização
    $scope.init = function() {
        $scope.loadCacheStatus();
        $scope.loadUncachedPoints();
        $scope.loadJobStatus();
        
        // Conectar à sala de atualizações de cache
        socket.emit('join', 'cache-updates');
    };

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
                alert('Erro ao carregar status do cache: ' + data.error);
            }
        });
    };

    // Carregar pontos não cacheados
    $scope.loadUncachedPoints = function() {
        $scope.loading.uncached = true;
        
        requester._get('cache/uncached-points', {}, function(data) {
            $scope.loading.uncached = false;
            
            if (data.success) {
                $scope.uncachedPoints = data;
            } else {
                console.error('Erro ao carregar pontos não cacheados:', data.error);
                alert('Erro ao carregar pontos não cacheados: ' + data.error);
            }
        });
    };

    // Iniciar simulação/processamento de cache
    $scope.startCacheProcess = function() {
        if ($scope.processing.isProcessing) {
            alert('Já existe um processamento em andamento');
            return;
        }

        var confirmMessage = $scope.processing.simulateMode 
            ? `Simular cache para ${$scope.processing.limitPoints} pontos?`
            : `ATENÇÃO: Fazer cache REAL para ${$scope.processing.limitPoints} pontos?\nIsto irá consumir recursos do servidor!`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        $scope.processing.isProcessing = true;
        $scope.processing.results = [];
        $scope.loading.processing = true;

        var requestData = {
            campaignId: $scope.processing.campaignId,
            limitPoints: $scope.processing.limitPoints,
            simulate: $scope.processing.simulateMode
        };

        requester._post('cache/simulate', requestData, function(data) {
            $scope.loading.processing = false;
            $scope.processing.isProcessing = false;
            
            if (data.success) {
                $scope.processing.results = data.points || [];
                alert(`Processamento concluído!\nPontos processados: ${data.processed}`);
                
                // Atualizar dados
                $scope.loadCacheStatus();
                $scope.loadUncachedPoints();
            } else {
                console.error('Erro no processamento:', data.error);
                alert('Erro no processamento: ' + data.error);
            }
        });
    };

    // Atualizar prioridade da campanha
    $scope.updateCampaignPriority = function(campaignId, priority) {
        var requestData = {
            campaignId: campaignId,
            priority: priority
        };

        requester._put('cache/campaign-priority', requestData, function(data) {
            if (data.success) {
                alert('Prioridade atualizada com sucesso!');
                $scope.loadUncachedPoints();
            } else {
                console.error('Erro ao atualizar prioridade:', data.error);
                alert('Erro ao atualizar prioridade: ' + data.error);
            }
        });
    };

    // Filtrar campanhas para seleção
    $scope.getCampaignsForSelection = function() {
        if (!$scope.uncachedPoints.campaigns) return [];
        
        return $scope.uncachedPoints.campaigns.map(function(campaign) {
            return {
                id: campaign._id,
                name: campaign._id,
                uncachedCount: campaign.uncachedCount
            };
        });
    };

    // Obter classe CSS para porcentagem de cache
    $scope.getCachePercentageClass = function(percentage) {
        if (percentage >= 90) return 'success';
        if (percentage >= 70) return 'warning';
        return 'danger';
    };

    // Obter classe CSS para prioridade
    $scope.getPriorityClass = function(priority) {
        switch(priority) {
            case 1: return 'danger';
            case 2: return 'warning';
            case 3: return 'info';
            default: return 'default';
        }
    };

    // Obter nome da prioridade
    $scope.getPriorityName = function(priority) {
        switch(priority) {
            case 1: return 'Alta';
            case 2: return 'Média';
            case 3: return 'Baixa';
            default: return 'Normal';
        }
    };

    // === FUNÇÕES DE GERENCIAMENTO DE JOBS ===

    // Carregar status do job
    $scope.loadJobStatus = function() {
        $scope.loading.job = true;
        
        requester._get('cache/job-status', {}, function(data) {
            $scope.loading.job = false;
            
            if (data.success) {
                $scope.jobStatus = data.jobStatus;
                
                // Sincronizar configuração local com a do servidor
                if ($scope.jobStatus.configuration) {
                    $scope.jobConfig = {
                        batchSize: $scope.jobStatus.configuration.batchSize || 3,
                        maxPointsPerRun: $scope.jobStatus.configuration.maxPointsPerRun || 15,
                        simulate: $scope.jobStatus.configuration.simulate !== false
                    };
                }
            } else {
                console.error('Erro ao carregar status do job:', data.error);
                alert('Erro ao carregar status do job: ' + data.error);
            }
        });
    };

    // Atualizar configuração do job
    $scope.updateJobConfig = function() {
        if (!$scope.jobConfig.batchSize || !$scope.jobConfig.maxPointsPerRun) {
            alert('Por favor, preencha todos os campos obrigatórios');
            return;
        }

        if ($scope.jobConfig.batchSize < 1 || $scope.jobConfig.batchSize > 10) {
            alert('Batch Size deve estar entre 1 e 10');
            return;
        }

        if ($scope.jobConfig.maxPointsPerRun < 5 || $scope.jobConfig.maxPointsPerRun > 100) {
            alert('Máximo de pontos deve estar entre 5 e 100');
            return;
        }

        var confirmMessage = $scope.jobConfig.simulate 
            ? 'Atualizar configuração do job para modo SIMULAÇÃO?'
            : 'ATENÇÃO: Atualizar configuração do job para modo REAL?\nIsto fará com que o job execute cache real automaticamente!';
        
        if (!confirm(confirmMessage)) {
            return;
        }

        requester._put('cache/job-config', $scope.jobConfig, function(data) {
            if (data.success) {
                alert('Configuração do job atualizada com sucesso!');
                $scope.loadJobStatus(); // Recarregar status
            } else {
                console.error('Erro ao atualizar configuração:', data.error);
                alert('Erro ao atualizar configuração: ' + data.error);
            }
        });
    };

    // Executar job manualmente
    $scope.triggerJobManually = function() {
        var confirmMessage = $scope.jobConfig.simulate 
            ? 'Executar job manualmente em modo SIMULAÇÃO?'
            : 'ATENÇÃO: Executar job manualmente em modo REAL?\nIsto irá consumir recursos do servidor!';
        
        if (!confirm(confirmMessage)) {
            return;
        }

        // Usar configuração atual para execução manual
        var manualParams = {
            batchSize: $scope.jobConfig.batchSize,
            maxPointsPerRun: $scope.jobConfig.maxPointsPerRun,
            simulate: $scope.jobConfig.simulate
        };

        requester._post('cache/trigger-job', manualParams, function(data) {
            if (data.success) {
                alert('Job executado manualmente com sucesso!\nVerifique os logs para acompanhar o progresso.');
                
                // Aguardar um pouco e recarregar status e logs
                setTimeout(function() {
                    $scope.loadJobStatus();
                    $scope.loadCacheStatus();
                    $scope.loadUncachedPoints();
                }, 2000);
            } else {
                console.error('Erro ao executar job:', data.error);
                alert('Erro ao executar job: ' + data.error);
            }
        });
    };

    // === FUNÇÕES DE REMOÇÃO DE CACHE ===

    // Verificar se pode remover cache
    $scope.canRemoveCache = function() {
        if ($scope.cacheRemoval.type === 'campaign' && !$scope.cacheRemoval.campaignId) {
            return false;
        }
        if ($scope.cacheRemoval.type === 'point' && (!$scope.cacheRemoval.campaignId || !$scope.cacheRemoval.pointId)) {
            return false;
        }
        if ($scope.cacheRemoval.type === 'layer' && !$scope.cacheRemoval.layer) {
            return false;
        }
        if ($scope.cacheRemoval.type === 'year' && !$scope.cacheRemoval.year) {
            return false;
        }
        if ($scope.cacheRemoval.type === 'tile') {
            if (!$scope.cacheRemoval.x || !$scope.cacheRemoval.y || !$scope.cacheRemoval.z) {
                return false;
            }
        }
        return true;
    };

    // Confirmar e remover cache
    $scope.removeCacheConfirm = function() {
        if (!$scope.canRemoveCache()) {
            alert('Por favor, preencha todos os campos obrigatórios');
            return;
        }

        var confirmMessage = 'ATENÇÃO: Esta operação irá remover permanentemente os tiles do cache!\n\n';
        
        switch($scope.cacheRemoval.type) {
            case 'campaign':
                confirmMessage += `Remover todos os tiles da campanha ${$scope.cacheRemoval.campaignId}`;
                if ($scope.cacheRemoval.year) {
                    confirmMessage += ` do ano ${$scope.cacheRemoval.year}`;
                }
                break;
            case 'point':
                confirmMessage += `Remover todos os tiles do ponto ${$scope.cacheRemoval.pointId} da campanha ${$scope.cacheRemoval.campaignId}`;
                if ($scope.cacheRemoval.year) {
                    confirmMessage += ` do ano ${$scope.cacheRemoval.year}`;
                }
                break;
            case 'layer':
                confirmMessage += `Remover todos os tiles da camada ${$scope.cacheRemoval.layer}`;
                if ($scope.cacheRemoval.year) {
                    confirmMessage += ` do ano ${$scope.cacheRemoval.year}`;
                }
                break;
            case 'year':
                confirmMessage += `Remover todos os tiles do ano ${$scope.cacheRemoval.year}`;
                break;
            case 'tile':
                confirmMessage += `Remover tile específico: x=${$scope.cacheRemoval.x}, y=${$scope.cacheRemoval.y}, z=${$scope.cacheRemoval.z}`;
                break;
            case 'all':
                confirmMessage += 'Remover TODO o cache (CUIDADO!)';
                break;
        }
        
        confirmMessage += '\n\nDeseja continuar?';
        
        if (!confirm(confirmMessage)) {
            return;
        }

        // Segunda confirmação para operações mais perigosas
        if ($scope.cacheRemoval.type === 'all') {
            if (!confirm('Esta é uma operação MUITO perigosa! Tem certeza absoluta que deseja remover TODO o cache?')) {
                return;
            }
        }

        $scope.removeCache();
    };

    // Executar remoção de cache
    $scope.removeCache = function() {
        $scope.cacheRemoval.isRemoving = true;
        $scope.cacheRemoval.lastResult = null;

        // Montar parâmetros baseado no tipo
        var params = {};
        
        switch($scope.cacheRemoval.type) {
            case 'campaign':
                params.pattern = `*/${$scope.cacheRemoval.campaignId}/*`;
                if ($scope.cacheRemoval.year) {
                    params.year = $scope.cacheRemoval.year;
                }
                break;
            case 'point':
                // Para remover cache de um ponto específico, precisamos calcular os tiles
                // Vamos passar o ponto e campanha para o servidor processar
                params.pattern = `*/${$scope.cacheRemoval.campaignId}/${$scope.cacheRemoval.pointId}/*`;
                if ($scope.cacheRemoval.year) {
                    params.year = $scope.cacheRemoval.year;
                }
                break;
            case 'layer':
                params.layer = $scope.cacheRemoval.layer;
                if ($scope.cacheRemoval.year) {
                    params.year = $scope.cacheRemoval.year;
                }
                break;
            case 'year':
                params.year = $scope.cacheRemoval.year;
                break;
            case 'tile':
                params.x = $scope.cacheRemoval.x;
                params.y = $scope.cacheRemoval.y;
                params.z = $scope.cacheRemoval.z;
                break;
            case 'all':
                // Sem parâmetros específicos - remove tudo
                break;
        }

        // Fazer chamada para API de remoção
        requester._delete('cache/clear', params, function(data) {
            $scope.cacheRemoval.isRemoving = false;
            
            if (data.success) {
                $scope.cacheRemoval.lastResult = {
                    success: true,
                    removed: data.removed || 0
                };
                
                alert(`Cache removido com sucesso!\n${data.removed || 0} itens removidos.`);
                
                // Atualizar status do cache
                $scope.loadCacheStatus();
                $scope.loadUncachedPoints();
            } else {
                $scope.cacheRemoval.lastResult = {
                    success: false,
                    error: data.error || 'Erro desconhecido'
                };
                
                console.error('Erro ao remover cache:', data.error);
                alert('Erro ao remover cache: ' + (data.error || 'Erro desconhecido'));
            }
        });
    };

    // Auto-refresh a cada 30 segundos se não estiver processando
    $scope.autoRefresh = $interval(function() {
        if (!$scope.processing.isProcessing) {
            $scope.loadCacheStatus();
            $scope.loadUncachedPoints();
        }
    }, 30000);

    // Cleanup ao sair da tela
    $scope.$on('$destroy', function() {
        if ($scope.autoRefresh) {
            $interval.cancel($scope.autoRefresh);
        }
        
        // Desconectar socket
        if (socket) {
            socket.disconnect();
        }
    });
    
    // Monitorar conexão do socket
    socket.on('connect', function() {
        console.log('Socket conectado');
        // Re-entrar na sala após reconexão
        socket.emit('join', 'cache-updates');
    });
    
    socket.on('disconnect', function() {
        console.log('Socket desconectado');
    });
    
    socket.on('reconnect', function(attemptNumber) {
        console.log('Socket reconectado após', attemptNumber, 'tentativas');
        // Re-entrar na sala após reconexão
        socket.emit('join', 'cache-updates');
    });
    
    socket.on('reconnect_error', function(error) {
        console.error('Erro ao reconectar socket:', error);
    });

    // === FUNÇÕES DE PAGINAÇÃO DE CAMPANHAS ===
    
    // Variáveis para armazenar valores computados
    $scope.filteredCampaigns = [];
    $scope.paginatedCampaigns = [];

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

    // Função auxiliar para formatar tempo
    function formatTime(milliseconds) {
        var seconds = Math.floor(milliseconds / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return hours + 'h ' + (minutes % 60) + 'min';
        } else if (minutes > 0) {
            return minutes + 'min ' + (seconds % 60) + 's';
        } else {
            return seconds + 's';
        }
    }

    // Carregar pontos de uma campanha
    $scope.loadCampaignPoints = function(campaignId) {
        if (!campaignId) {
            $scope.availablePoints = [];
            return;
        }
        
        // Buscar pontos da campanha no servidor
        requester._get('cache/campaign-points', { campaignId: campaignId }, function(data) {
            if (data.success) {
                $scope.availablePoints = data.points || [];
            } else {
                console.error('Erro ao carregar pontos da campanha:', data.error);
                $scope.availablePoints = [];
            }
        });
    };
    
    // Watch para carregar pontos quando mudar a campanha
    $scope.$watch('cacheRemoval.campaignId', function(newVal, oldVal) {
        if (newVal !== oldVal) {
            $scope.cacheRemoval.pointId = ''; // Limpar seleção de ponto
            if ($scope.cacheRemoval.type === 'point' || $scope.cacheRemoval.type === 'campaign') {
                $scope.loadCampaignPoints(newVal);
            }
        }
    });
    
    // Watch para mudar automaticamente para tipo 'point' quando selecionar campanha em modo 'point'
    $scope.$watch('cacheRemoval.type', function(newVal, oldVal) {
        if (newVal !== oldVal) {
            // Limpar seleções anteriores
            if (newVal !== 'campaign' && newVal !== 'point') {
                $scope.cacheRemoval.campaignId = '';
                $scope.cacheRemoval.pointId = '';
                $scope.availablePoints = [];
            }
            if (newVal !== 'layer') {
                $scope.cacheRemoval.layer = '';
            }
            if (newVal !== 'tile') {
                $scope.cacheRemoval.x = null;
                $scope.cacheRemoval.y = null;
                $scope.cacheRemoval.z = null;
            }
        }
    });

    // Inicializar
    $scope.init();
});