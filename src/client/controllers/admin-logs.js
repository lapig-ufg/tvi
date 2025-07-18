/**
 * Controller para gerenciamento de logs do sistema
 */
Application.controller('AdminLogsController', ['$scope', '$http', '$location', '$interval', '$timeout', '$window', 'NotificationDialog', '$uibModal',
    function($scope, $http, $location, $interval, $timeout, $window, NotificationDialog, $uibModal) {
        
        // Estado inicial
        $scope.logs = [];
        $scope.stats = {};
        $scope.loading = false;
        $scope.selectedPeriod = 7;
        $scope.pagination = null;
        $scope.availableModules = [];
        $scope.chartData = null;
        $scope.chartInstance = null;
        
        // Filtros
        $scope.filters = {
            level: '',
            module: '',
            search: '',
            page: 1,
            limit: 50
        };
        
        // Variáveis removidas após refatoração para uso do $uibModal
        
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
            if (!dailyData || dailyData.length === 0) return;
            
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
            $timeout(function() {
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
            // Buscar detalhes completos do log
            $http.get('/service/logs/' + log.logId)
                .success(function(response) {
                    if (response.success && response.log) {
                        // Abrir modal usando $uibModal
                        const modalInstance = $uibModal.open({
                            animation: true,
                            templateUrl: 'views/admin-logs-detail-modal.tpl.html',
                            controller: 'AdminLogsDetailModalController',
                            windowClass: 'log-details-modal',
                            size: 'lg',
                            resolve: {
                                logData: function() {
                                    return response.log;
                                }
                            }
                        });
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao carregar detalhes do log');
                });
        };
        
        // Remover método closeDetailsModal pois será tratado pelo modal controller
        
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
            const modalInstance = $uibModal.open({
                animation: true,
                templateUrl: 'views/admin-logs-cleanup-modal.tpl.html',
                controller: 'AdminLogsCleanupModalController',
                windowClass: 'cleanup-modal',
                size: 'md',
                resolve: {
                    parentScope: function() {
                        return $scope;
                    }
                }
            });
            
            modalInstance.result.then(function(result) {
                if (result && result.action === 'cleanup') {
                    $scope.performCleanup(result.cleanupDays, result.keepErrors);
                }
            });
        };
        
        // Remover método closeCleanupModal pois será tratado pelo modal controller
        
        /**
         * Executar limpeza
         */
        $scope.performCleanup = function(cleanupDays, keepErrors) {
            NotificationDialog.info('Limpando logs antigos...');
            
            const params = {
                daysToKeep: parseInt(cleanupDays),
                keepErrors: keepErrors
            };
            
            $http.delete('/service/logs/cleanup', { params: params })
                .success(function(response) {
                    if (response.success) {
                        NotificationDialog.success(
                            'Limpeza concluída',
                            response.deleted + ' logs foram removidos'
                        );
                        $scope.refreshLogs();
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao limpar logs');
                });
        };
        
        /**
         * Mostrar modal de configuração do job
         */
        $scope.showJobConfigModal = function() {
            // Carregar status do job primeiro
            $http.get('/service/logs/job-status')
                .success(function(response) {
                    if (response.success && response.jobStatus) {
                        const modalInstance = $uibModal.open({
                            animation: true,
                            templateUrl: 'views/admin-logs-job-config-modal.tpl.html',
                            controller: 'AdminLogsJobConfigModalController',
                            windowClass: 'job-config-modal',
                            size: 'lg',
                            resolve: {
                                jobStatusData: function() {
                                    return response.jobStatus;
                                },
                                parentScope: function() {
                                    return $scope;
                                }
                            }
                        });
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao carregar configuração do job');
                });
        };
        
        // Remover método closeJobConfigModal pois será tratado pelo modal controller
        
        // Remover método loadJobStatus pois será tratado pelo modal controller
        
        // Remover métodos saveJobConfig e triggerJob pois serão tratados pelo modal controller
        
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
Application.controller('AdminLogsCleanupModalController', ['$scope', '$uibModalInstance', 'parentScope',
    function($scope, $uibModalInstance, parentScope) {
        $scope.cleanupDays = 30;
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
Application.controller('AdminLogsJobConfigModalController', ['$scope', '$uibModalInstance', '$http', 'NotificationDialog', '$timeout', 'jobStatusData', 'parentScope',
    function($scope, $uibModalInstance, $http, NotificationDialog, $timeout, jobStatusData, parentScope) {
        $scope.jobStatus = jobStatusData;
        $scope.jobConfig = angular.copy(jobStatusData.configuration);
        $scope.jobConfig.isEnabled = jobStatusData.isEnabled;
        
        $scope.saveJobConfig = function() {
            $http.put('/service/logs/job-config', $scope.jobConfig)
                .success(function(response) {
                    if (response.success) {
                        NotificationDialog.success('Configuração salva com sucesso');
                        $uibModalInstance.close();
                        parentScope.refreshLogs();
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao salvar configuração');
                });
        };
        
        $scope.triggerJob = function() {
            NotificationDialog.info('Executando job de limpeza...');
            
            const params = {
                daysToKeep: $scope.jobConfig.daysToKeep,
                keepErrors: $scope.jobConfig.keepErrors,
                batchSize: $scope.jobConfig.batchSize,
                simulate: $scope.jobConfig.simulate
            };
            
            $http.post('/service/logs/trigger-job', params)
                .success(function(response) {
                    if (response.success) {
                        NotificationDialog.success('Job executado com sucesso');
                        // Recarregar status após alguns segundos
                        $timeout(function() {
                            // Recarregar job status
                            $http.get('/service/logs/job-status')
                                .success(function(response) {
                                    if (response.success && response.jobStatus) {
                                        $scope.jobStatus = response.jobStatus;
                                    }
                                });
                        }, 3000);
                    }
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao executar job');
                });
        };
        
        $scope.$dismiss = function() {
            $uibModalInstance.dismiss();
        };
    }
]);
