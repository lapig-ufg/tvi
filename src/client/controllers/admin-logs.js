/**
 * Controller para gerenciamento de logs do sistema
 */
Application.controller('AdminLogsController', ['$scope', '$http', '$location', '$interval', '$timeout', 'NotificationDialog',
    function($scope, $http, $location, $interval, $timeout, NotificationDialog) {
        
        // Estado inicial
        $scope.logs = [];
        $scope.stats = {};
        $scope.loading = false;
        $scope.selectedPeriod = 7;
        $scope.pagination = null;
        $scope.availableModules = [];
        $scope.chartData = null;
        
        // Filtros
        $scope.filters = {
            level: '',
            module: '',
            search: '',
            page: 1,
            limit: 50
        };
        
        // Modal states
        $scope.showDetailsModal = false;
        $scope.showCleanupModalFlag = false;
        $scope.selectedLog = null;
        $scope.cleanupDays = 30;
        
        /**
         * Inicialização
         */
        $scope.init = function() {
            $scope.loadStats();
            $scope.loadLogs();
            $scope.loadAvailableModules();
            
            // Atualizar a cada 30 segundos
            const refreshInterval = $interval(function() {
                if (!$scope.showDetailsModal && !$scope.showCleanupModalFlag) {
                    $scope.refreshLogs();
                }
            }, 30000);
            
            // Limpar interval ao destruir
            $scope.$on('$destroy', function() {
                if (refreshInterval) {
                    $interval.cancel(refreshInterval);
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
            $http.get('/api/admin/logs/stats?days=' + $scope.selectedPeriod)
                .success(function(response) {
                    if (response.success && response.data) {
                        $scope.stats = response.data;
                        $scope.updateChart(response.data.dailyStats);
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
                page: $scope.filters.page,
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
            
            $http.get('/api/admin/logs', { params: params })
                .success(function(response) {
                    if (response.success && response.data) {
                        $scope.logs = response.data.logs;
                        $scope.pagination = response.data.pagination;
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao carregar logs', error);
                })
                .finally(function() {
                    $scope.loading = false;
                });
        };
        
        /**
         * Carregar módulos disponíveis
         */
        $scope.loadAvailableModules = function() {
            // Extrair módulos únicos dos stats
            $http.get('/api/admin/logs/stats?days=30')
                .success(function(response) {
                    if (response.success && response.data && response.data.moduleStats) {
                        $scope.availableModules = Object.keys(response.data.moduleStats).sort();
                    }
                });
        };
        
        /**
         * Atualizar gráfico
         */
        $scope.updateChart = function(dailyStats) {
            if (!dailyStats || Object.keys(dailyStats).length === 0) return;
            
            const labels = [];
            const errorData = [];
            const warnData = [];
            const infoData = [];
            
            // Ordenar por data
            const sortedDates = Object.keys(dailyStats).sort();
            
            sortedDates.forEach(date => {
                const stats = dailyStats[date];
                labels.push(new Date(date).toLocaleDateString('pt-BR', { 
                    day: '2-digit', 
                    month: '2-digit' 
                }));
                errorData.push(stats.error || 0);
                warnData.push(stats.warn || 0);
                infoData.push(stats.info || 0);
            });
            
            // Destruir gráfico anterior se existir
            if ($scope.chartInstance) {
                $scope.chartInstance.destroy();
            }
            
            // Criar novo gráfico
            $timeout(function() {
                const ctx = document.getElementById('logsChart');
                if (ctx) {
                    $scope.chartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'Erros',
                                    data: errorData,
                                    borderColor: '#e53e3e',
                                    backgroundColor: 'rgba(229, 62, 62, 0.1)',
                                    tension: 0.4
                                },
                                {
                                    label: 'Avisos',
                                    data: warnData,
                                    borderColor: '#dd6b20',
                                    backgroundColor: 'rgba(221, 107, 32, 0.1)',
                                    tension: 0.4
                                },
                                {
                                    label: 'Informações',
                                    data: infoData,
                                    borderColor: '#3182ce',
                                    backgroundColor: 'rgba(49, 130, 206, 0.1)',
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
            }, 100);
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
        $scope.viewLogDetails = function(log) {
            $scope.selectedLog = log;
            $scope.showDetailsModal = true;
        };
        
        /**
         * Fechar modal de detalhes
         */
        $scope.closeDetailsModal = function() {
            $scope.showDetailsModal = false;
            $scope.selectedLog = null;
        };
        
        /**
         * Verificar se tem metadados
         */
        $scope.hasMetadata = function(metadata) {
            return metadata && Object.keys(metadata).length > 0;
        };
        
        /**
         * Mostrar modal de limpeza
         */
        $scope.showCleanupModal = function() {
            $scope.showCleanupModalFlag = true;
        };
        
        /**
         * Fechar modal de limpeza
         */
        $scope.closeCleanupModal = function() {
            $scope.showCleanupModalFlag = false;
        };
        
        /**
         * Executar limpeza
         */
        $scope.performCleanup = function() {
            $scope.closeCleanupModal();
            
            NotificationDialog.info('Limpando logs antigos...');
            
            $http.post('/api/admin/logs/cleanup', { days: parseInt($scope.cleanupDays) })
                .success(function(response) {
                    if (response.success && response.data) {
                        NotificationDialog.success(
                            'Limpeza concluída',
                            response.data.removedCount + ' logs foram removidos'
                        );
                        $scope.refreshLogs();
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao limpar logs', error);
                });
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