'use strict';

Application.controller('AdminLoginController', function ($scope, $http, $window, $location, NotificationDialog) {
    $scope.credentials = {
        username: '',
        password: ''
    };
    $scope.loading = false;
    $scope.error = '';

    // Verificar se já está autenticado
    $scope.checkAuth = function() {
        // Marcar que estamos no sistema admin
        $scope.$root.isAdminMode = true;
        
        $http.get('/api/admin/check').then(function(response) {
            if (response.data.authenticated) {
                $location.path('/admin/home');
            }
        }, function(error) {
            // Se erro na verificação, continuar na tela de login
            // User not authenticated or verification error
        });
    };

    $scope.login = function() {
        if (!$scope.credentials.username || !$scope.credentials.password) {
            $scope.error = 'Username e senha são obrigatórios';
            return;
        }

        $scope.loading = true;
        $scope.error = '';

        $http.post('/api/admin/login', $scope.credentials).then(function(response) {
            $scope.loading = false;
            if (response.data.success) {
                // Login successful, redirecting to admin/home
                // Usar timeout para garantir que o redirecionamento aconteça após o digest
                setTimeout(function() {
                    $scope.$apply(function() {
                        $location.path('/admin/home');
                    });
                }, 100);
            }
        }, function(error) {
            $scope.loading = false;
            $scope.error = error.data.error || 'Erro no login';
        });
    };

    // Verificar autenticação ao carregar
    $scope.checkAuth();
});

/**
 * Controller para redirecionar /admin para /admin/home ou /admin/login
 */
Application.controller('AdminRedirectController', function ($scope, $http, $location) {
    // Marcar que estamos no sistema admin
    $scope.$root.isAdminMode = true;
    
    // Verificar se já está autenticado
    $http.get('/api/admin/check').then(function(response) {
        if (response.data.authenticated) {
            // Se autenticado, redirecionar para /admin/home
            $location.path('/admin/home');
        } else {
            // Se não autenticado, redirecionar para /admin/login
            $location.path('/admin/login');
        }
    }, function(error) {
        // Em caso de erro, redirecionar para login
        $location.path('/admin/login');
    });
});