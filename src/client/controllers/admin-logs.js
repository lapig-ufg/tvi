/**
 * Controller para gerenciamento de logs do sistema
 */
Application.controller('AdminLogsController', ['$scope', '$http', '$location', '$interval', '$timeout', '$window', 'NotificationDialog', 'AdminPages',
    function($scope, $http, $location, $interval, $timeout, $window, NotificationDialog, AdminPages) {
        
        var destroyed = false;
        var chartTimer;
        var query = $location.search();

        // Estado inicial
        $scope.logs = [];
        $scope.stats = {};
        $scope.loading = false;
        $scope.selectedPeriod = [1, 7, 30, 90].indexOf(Number(query.period)) >= 0 ? Number(query.period) : 7;
        $scope.pagination = null;
        $scope.availableModules = [];
        $scope.chartData = null;
        $scope.chartInstance = null;
        
        // Filtros
        $scope.filters = {
            level: typeof query.level === 'string' ? query.level : '',
            module: typeof query.module === 'string' ? query.module : '',
            search: typeof query.search === 'string' ? query.search : '',
            page: Math.max(1, parseInt(query.page, 10) || 1),
            limit: [25, 50, 100, 200].indexOf(Number(query.limit)) >= 0 ? Number(query.limit) : 50
        };
        
        /**
         * Inicialização
         */
        $scope.init = function() {
            $scope.loadStats();
            $scope.loadLogs();
            
            // Atualizar a cada 30 segundos
            const refreshInterval = $interval(function() {
                $scope.refreshLogs();
            }, 30000);
            
            // Limpar interval ao destruir
            $scope.$on('$destroy', function() {
                destroyed = true;
                if (chartTimer) $timeout.cancel(chartTimer);
                if (refreshInterval) {
                    $interval.cancel(refreshInterval);
                }
                if ($scope.chartInstance) {
                    try {
                        $scope.chartInstance.destroy();
                        $scope.chartInstance = null;
                    } catch (e) {
                        console.warn('Erro ao destruir gráfico no destroy:', e);
                    }
                }
            });
        };
        
        /**
         * Voltar para home
         */
        $scope.goBack = function() {
            $location.path('/admin/home');
        };
        
        /**
         * Carregar estatísticas
         */
        $scope.loadStats = function() {
            $http.get('/service/logs/statistics')
                .success(function(response) {
                    if (destroyed) return;
                    if (response.success && response.statistics) {
                        const stats = response.statistics;
                        
                        // Processar estatísticas por nível
                        $scope.stats.levelStats = {};
                        stats.byLevel.forEach(function(item) {
                            $scope.stats.levelStats[item._id] = item.count;
                        });
                        
                        // Total de logs
                        $scope.stats.totalLogs = stats.totals.totalLogs;
                        
                        // Módulos disponíveis
                        $scope.availableModules = stats.byModule.map(function(item) {
                            return item._id;
                        }).filter(function(module) {
                            return module && module !== 'unknown';
                        });
                        
                        // Atualizar gráfico com dados por dia
                        $scope.updateChart(stats.byDay);
                    }
                })
                .error(function(error) {
                    console.error('Erro ao carregar estatísticas:', error);
                });
        };
        
        /**
         * Carregar logs
         */
        $scope.loadLogs = function() {
            $scope.loading = true;
            
            const params = {
                limit: $scope.filters.limit
            };
            
            // Aplicar filtros
            if ($scope.filters.level) params.level = $scope.filters.level;
            if ($scope.filters.module) params.module = $scope.filters.module;
            if ($scope.filters.search) params.search = $scope.filters.search;
            
            // Período
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - $scope.selectedPeriod);
            params.startDate = startDate.toISOString();
            
            $http.get('/service/logs/recent', { params: params })
                .success(function(response) {
                    if (destroyed) return;
                    if (response.success && response.logs) {
                        $scope.logs = response.logs;
                        
                        // Calcular paginação
                        const total = response.total || response.logs.length;
                        $scope.pagination = {
                            page: $scope.filters.page,
                            limit: $scope.filters.limit,
                            total: total,
                            pages: Math.ceil(total / $scope.filters.limit)
                        };
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao carregar logs');
                })
                .finally(function() {
                    $scope.loading = false;
                });
        };
        
        /**
         * Atualizar gráfico
         */
        $scope.updateChart = function(dailyData) {
            if (destroyed || !dailyData || dailyData.length === 0) return;
            
            const labels = [];
            const errorData = [];
            const totalData = [];
            
            // Processar dados
            dailyData.forEach(item => {
                const date = new Date(item._id);
                labels.push(date.toLocaleDateString('pt-BR', { 
                    day: '2-digit', 
                    month: '2-digit' 
                }));
                errorData.push(item.errors || 0);
                totalData.push(item.count || 0);
            });
            
            // Destruir gráfico anterior se existir
            if ($scope.chartInstance) {
                try {
                    $scope.chartInstance.destroy();
                    $scope.chartInstance = null;
                } catch (e) {
                    console.warn('Erro ao destruir gráfico:', e);
                }
            }
            
            // Criar novo gráfico
            if (chartTimer) $timeout.cancel(chartTimer);
            chartTimer = $timeout(function() {
                if (destroyed) return;
                const ctx = document.getElementById('logsChart');
                if (ctx && window.Chart) {
                    // Limpar qualquer instância existente no canvas
                    const existingChart = Chart.getChart(ctx);
                    if (existingChart) {
                        existingChart.destroy();
                    }
                    
                    $scope.chartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'Total de Logs',
                                    data: totalData,
                                    borderColor: '#3182ce',
                                    backgroundColor: 'rgba(49, 130, 206, 0.1)',
                                    tension: 0.4
                                },
                                {
                                    label: 'Erros',
                                    data: errorData,
                                    borderColor: '#e53e3e',
                                    backgroundColor: 'rgba(229, 62, 62, 0.1)',
                                    tension: 0.4
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom'
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true
                                }
                            }
                        }
                    });
                }
            });
        };
        
        /**
         * Atualizar logs
         */
        $scope.refreshLogs = function() {
            $scope.loadStats();
            $scope.loadLogs();
        };
        
        /**
         * Aplicar filtros
         */
        $scope.applyFilters = function() {
            $scope.filters.page = 1;
            $scope.loadLogs();
        };
        
        /**
         * Mudar período
         */
        $scope.changePeriod = function() {
            $scope.filters.page = 1;
            $scope.loadStats();
            $scope.loadLogs();
        };
        
        /**
         * Ir para página
         */
        $scope.goToPage = function(page) {
            if (page < 1 || page > $scope.pagination.pages) return;
            $scope.filters.page = page;
            $scope.loadLogs();
        };
        
        /**
         * Ver detalhes do log
         */
        function openPage(id, params) {
            $location.search({
                level: $scope.filters.level,
                module: $scope.filters.module,
                search: $scope.filters.search,
                page: $scope.filters.page,
                limit: $scope.filters.limit,
                period: $scope.selectedPeriod
            });
            AdminPages.go(id, params);
        }

        $scope.viewLogDetails = function(log) {
            openPage('log-details', { logId: log.logId });
        };

        /**
         * Verificar se tem metadados
         */
        $scope.hasMetadata = function(metadata) {
            return metadata && Object.keys(metadata).length > 0;
        };
        
        $scope.showCleanupModal = function() {
            openPage('logs-cleanup');
        };

        $scope.showJobConfigModal = function() {
            openPage('logs-job-config');
        };

        /**
         * Exportar logs
         */
        $scope.exportLogs = function() {
            const params = {
                limit: 1000,
                level: $scope.filters.level,
                startDate: new Date(Date.now() - $scope.selectedPeriod * 24 * 60 * 60 * 1000).toISOString()
            };
            
            // Construir query string
            const queryString = Object.keys(params)
                .filter(key => params[key])
                .map(key => key + '=' + encodeURIComponent(params[key]))
                .join('&');
            
            // Abrir em nova janela para download
            $window.open('/service/logs/export?' + queryString, '_blank');
        };
        
        /**
         * Formatar data
         */
        $scope.formatDate = function(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleString('pt-BR');
        };
        
        
        // Inicializar
        $scope.init();
    }
]);

/**
 * Controller para modal de detalhes do log
 */
Application.controller('AdminLogsDetailModalController', ['$scope', '$uibModalInstance', 'logData',
    function($scope, $uibModalInstance, logData) {
        $scope.selectedLog = logData;
        
        $scope.formatDate = function(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleString('pt-BR');
        };
        
        $scope.hasMetadata = function(metadata) {
            return metadata && Object.keys(metadata).length > 0;
        };
        
        $scope.$dismiss = function() {
            $uibModalInstance.dismiss();
        };
    }
]);

/**
 * Controller para modal de limpeza
 */
Application.controller('AdminLogsCleanupModalController', ['$scope', '$uibModalInstance',
    function($scope, $uibModalInstance) {
        $scope.cleanupDays = '30';
        $scope.keepErrors = true;
        
        $scope.performCleanup = function() {
            $uibModalInstance.close({
                action: 'cleanup',
                cleanupDays: $scope.cleanupDays,
                keepErrors: $scope.keepErrors
            });
        };
        
        $scope.$dismiss = function() {
            $uibModalInstance.dismiss();
        };
    }
]);

/**
 * Controller para modal de configuração do job
 */
Application.controller('AdminLogsJobConfigModalController', ['$scope', '$uibModalInstance', '$http', 'NotificationDialog', 'jobStatusData',
    function($scope, $uibModalInstance, $http, NotificationDialog, jobStatusData) {
        $scope.jobStatus = jobStatusData;
        $scope.jobConfig = angular.copy(jobStatusData.configuration);
        $scope.jobConfig.isEnabled = jobStatusData.isEnabled;
        $scope.triggering = false;

        $scope.saveJobConfig = function() {
            if ($scope.triggering) return;
            return $uibModalInstance.close(angular.copy($scope.jobConfig));
        };

        $scope.triggerJob = function() {
            if ($scope.triggering) return;
            $scope.triggering = true;
            const params = {
                daysToKeep: $scope.jobConfig.daysToKeep,
                keepErrors: $scope.jobConfig.keepErrors,
                batchSize: $scope.jobConfig.batchSize,
                simulate: $scope.jobConfig.simulate
            };
            return $http.post('/service/logs/trigger-job', params)
                .then(function(response) {
                    if (!response.data || !response.data.success) {
                        throw new Error((response.data && response.data.error) || 'Erro ao executar job');
                    }
                    NotificationDialog.success('Job executado com sucesso');
                    return $http.get('/service/logs/job-status').then(function(status) {
                        if (!status.data || !status.data.success || !status.data.jobStatus) {
                            throw new Error('Erro ao carregar o estado do job');
                        }
                        $scope.jobStatus = status.data.jobStatus;
                    });
                })
                .catch(function(error) {
                    NotificationDialog.error((error.data && error.data.error) || error.message || 'Erro ao executar job');
                })
                .finally(function() {
                    $scope.triggering = false;
                });
        };

        $scope.$dismiss = function() {
            $uibModalInstance.dismiss();
        };
    }
]);
