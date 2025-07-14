var Application = angular.module('application', ['ngRoute', 'ngMagnify', 'ui.bootstrap']);

Application.config(function($routeProvider, $locationProvider) {

	$routeProvider
		.when('/temporal', {
			controller: 'temporalController',
			templateUrl: 'views/temporal.tpl.html',
			reloadOnSearch: false
		})
		.when('/supervisor', {
			controller: 'supervisorController',
			templateUrl: 'views/supervisor.tpl.html',
			reloadOnSearch: false
		})
		.when('/dashboard', {
			controller: 'dashboardController',
			templateUrl: 'views/dashboard.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/login', {
			controller: 'AdminLoginController',
			templateUrl: 'views/admin-login.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/campaigns', {
			controller: 'AdminCampaignController',
			templateUrl: 'views/admin-campaigns.tpl.html',
			reloadOnSearch: false
		})
		.when('/login', {
			controller: 'LoginController',
			templateUrl: 'views/login.tpl.html',
			reloadOnSearch: false
		})
		.otherwise({
			redirectTo: '/login'
		});

}).run(function($http, $location, $rootScope, requester) {

	var socket = io.connect('/', {
		transports: [ 'websocket' ]
	});

	$http.defaults.headers.post['Content-Type'] = 'application/json';
	$http.defaults.headers.put['Content-Type'] = 'application/json';
	delete $http.defaults.headers.common['X-Requested-With'];

	// Função para verificar se é rota admin
	var isAdminRoute = function(path) {
		return path && path.startsWith('/admin');
	};

	// Interceptar mudanças de rota
	$rootScope.$on('$routeChangeStart', function(event, next, current) {
		var currentPath = $location.path();
		var nextPath = next && next.$$route && next.$$route.originalPath;
		
		// Completamente ignorar qualquer coisa relacionada a admin
		if (isAdminRoute(currentPath) || isAdminRoute(nextPath) || $rootScope.isAdminMode) {
			return;
		}
		
		// Só verificar login para rotas específicas do sistema principal
		var mainSystemRoutes = ['/temporal', '/supervisor', '/dashboard'];
		var isMainSystemRoute = nextPath && mainSystemRoutes.includes(nextPath);
		
		if (isMainSystemRoute) {
			requester._get('login/user', function(result) {
				if(!result) {
					$location.path('login');
				} else {
					$rootScope.user = result;

					if(result.type == 'supervisor'){
						$location.path('supervisor');
					}
					else if(result.type == 'inspector') {
						$location.path('temporal');
					}
				}
			});
		}
	});

	// Verificação inicial - apenas para rotas específicas do sistema principal
	var currentPath = $location.path();
	var mainSystemRoutes = ['/temporal', '/supervisor', '/dashboard', '/login', '/'];
	
	if (!isAdminRoute(currentPath) && (mainSystemRoutes.includes(currentPath) || currentPath === '')) {
		requester._get('login/user', function(result) {
			if(!result) {
				$location.path('login');
			} else {
				$rootScope.user = result;

				if(result.type == 'supervisor'){
					$location.path('supervisor');
				}
				else if(result.type == 'inspector') {
					$location.path('temporal');
				}
			}
		});
	}
});
