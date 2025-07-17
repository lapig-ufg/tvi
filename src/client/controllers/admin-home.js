/**
 * Controller para a tela inicial do admin
 */
Application.controller('AdminHomeController', ['$scope', '$http', '$location', '$interval', 'NotificationDialog',
    function($scope, $http, $location, $interval, NotificationDialog) {
        
        // Verificar autenticação
        $scope.adminUser = {};
        
        // Estatísticas dos módulos
        $scope.stats = {
            campaigns: { total: 0, active: 0 },
            cache: { size: '0 GB', items: 0 },
            logs: { errors: 0, today: 0 },
            users: 0,
            points: 0,
            inspections: 0
        };
        
        // Status do sistema
        $scope.systemHealth = {
            status: 'Operacional'
        };
        
        /**
         * Inicialização
         */
        $scope.init = function() {
            $scope.checkAuthentication();
            $scope.loadStatistics();
            
            // Atualizar estatísticas a cada 30 segundos
            const refreshInterval = $interval(function() {
                $scope.loadStatistics();
            }, 30000);
            
            // Limpar interval ao destruir o controller
            $scope.$on('$destroy', function() {
                if (refreshInterval) {
                    $interval.cancel(refreshInterval);
                }
            });
        };
        
        /**
         * Verificar se o usuário está autenticado
         */
        $scope.checkAuthentication = function() {
            $http.get('/api/admin/check')
                .success(function(response) {
                    if (response.authenticated && response.user) {
                        $scope.adminUser = response.user;
                    } else {
                        $location.path('/admin/login');
                    }
                })
                .error(function() {
                    $location.path('/admin/login');
                });
        };
        
        /**
         * Carregar estatísticas do sistema
         */
        $scope.loadStatistics = function() {
            // Estatísticas de campanhas
            $http.get('/api/admin/campaigns/stats')
                .success(function(response) {
                    if (response.success && response.data) {
                        $scope.stats.campaigns = response.data;
                    }
                })
                .error(function(error) {
                    console.error('Erro ao carregar estatísticas de campanhas:', error);
                });
            
            // Estatísticas de cache
            $http.get('/api/admin/cache/stats')
                .success(function(response) {
                    if (response.success && response.data) {
                        $scope.stats.cache = response.data;
                    }
                })
                .error(function(error) {
                    console.error('Erro ao carregar estatísticas de cache:', error);
                });
            
            // Estatísticas de logs
            $http.get('/api/admin/logs/stats?days=1')
                .success(function(response) {
                    if (response.success && response.data) {
                        // Contar erros do dia
                        const today = new Date().toISOString().split('T')[0];
                        const todayStats = response.data.dailyStats[today];
                        
                        $scope.stats.logs.errors = todayStats ? todayStats.error : 0;
                        $scope.stats.logs.today = todayStats ? todayStats.total : 0;
                    }
                })
                .error(function(error) {
                    console.error('Erro ao carregar estatísticas de logs:', error);
                });
            
            // Estatísticas gerais
            $http.get('/api/admin/dashboard/stats')
                .success(function(response) {
                    if (response.success && response.data) {
                        if (response.data.users) {
                            $scope.stats.users = response.data.users.total || 0;
                        }
                        if (response.data.points) {
                            $scope.stats.points = response.data.points.total || 0;
                        }
                        $scope.stats.inspections = response.data.campaigns ? response.data.campaigns.totalInspections || 0 : 0;
                    }
                })
                .error(function(error) {
                    console.error('Erro ao carregar estatísticas gerais:', error);
                });
            
            // Status do sistema
            $scope.checkSystemHealth();
        };
        
        /**
         * Verificar saúde do sistema
         */
        $scope.checkSystemHealth = function() {
            $http.get('/api/health')
                .success(function(response) {
                    $scope.systemHealth.status = 'Operacional';
                })
                .error(function() {
                    $scope.systemHealth.status = 'Com Problemas';
                });
        };
        
        /**
         * Navegar para um módulo
         */
        $scope.navigateTo = function(path) {
            $location.path(path);
        };
        
        /**
         * Fazer logout
         */
        $scope.logout = function() {
            $http.post('/api/admin/logout')
                .success(function() {
                    $location.path('/admin/login');
                })
                .error(function(error) {
                    NotificationDialog.error('Erro ao fazer logout', error);
                });
        };
        
        // Inicializar ao carregar
        $scope.init();
    }
]);