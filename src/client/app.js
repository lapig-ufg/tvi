var Application = angular.module('application', ['ngRoute', 'ngMagnify', 'ui.bootstrap']);

Application.config(function($routeProvider, $locationProvider, $httpProvider) {
    // Configure $http to send cookies with all requests
    $httpProvider.defaults.withCredentials = true;

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
		.when('/admin/campaigns/manage/:id', {
			controller: 'CampaignManagementController',
			templateUrl: 'views/campaign-management.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/cache-tiles', {
			controller: 'CacheManagerTilesController',
			templateUrl: 'views/cache-manager-tiles.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/home', {
			controller: 'AdminHomeController',
			templateUrl: 'views/admin-home.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/logs', {
			controller: 'AdminLogsController',
			templateUrl: 'views/admin-logs.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/temporal', {
			controller: 'adminTemporalController',
			templateUrl: 'views/admin-temporal.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin/visualization-params', {
			controller: 'AdminVisParamsController',
			templateUrl: 'views/admin-vis-params.tpl.html',
			reloadOnSearch: false
		})
		.when('/admin', {
			controller: 'AdminRedirectController',
			template: '<div>Redirecionando...</div>'
		})
		.when('/login', {
			controller: 'LoginController',
			templateUrl: 'views/login.tpl.html',
			reloadOnSearch: false
		})
		.when('/i18n-test', {
			templateUrl: 'views/i18n-test.html',
			reloadOnSearch: false
		})
		.otherwise({
			redirectTo: function() {
				// Otherwise route triggered
				// Se estamos em rota admin, não redirecionar
				if (location.hash && location.hash.indexOf('#/admin') === 0) {
					// Admin route detected in otherwise, staying put
					return location.hash.substring(1); // Remove # from hash
				}
				return '/login';
			}
		});

}).config(function($httpProvider) {
	// Adicionar loading interceptor
	$httpProvider.interceptors.push('loadingInterceptor');
	
	// Configurar interceptor HTTP
	$httpProvider.interceptors.push(function($location, $rootScope) {
		return {
			'response': function(response) {
				// HTTP Response logged
				return response;
			},
			'responseError': function(rejection) {
				console.error('HTTP Error:', {
					url: rejection.config.url,
					status: rejection.status,
					currentPath: $location.path(),
					isAdminMode: $rootScope.isAdminMode
				});
				return Promise.reject(rejection);
			}
		};
	});
}).run(function($http, $location, $rootScope, requester, i18nService) {
	// Ensure i18n translations are loaded
	// [app] Ensuring i18n translations are loaded
	i18nService.ensureLoaded().then(function() {
		// [app] i18n translations loaded successfully
	}).catch(function(error) {
		console.error('[app] Failed to load i18n translations:', error);
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
		
		// Route change intercepted
		
		// Completamente ignorar qualquer coisa relacionada a admin
		if (isAdminRoute(currentPath) || isAdminRoute(nextPath) || $rootScope.isAdminMode) {
			// Admin route detected, ignoring interceptor
			return;
		}
		
		// Só verificar login para rotas específicas do sistema principal
		var mainSystemRoutes = ['/temporal', '/supervisor', '/dashboard'];
		var isMainSystemRoute = nextPath && mainSystemRoutes.includes(nextPath);
		
		// Main system route check
		
		if (isMainSystemRoute) {
			// Checking login for main system route
			requester._get('login/user', function(result) {
				if(!result) {
					// No user found, redirecting to /login
					$location.path('/login');
				} else {
					$rootScope.user = result;

					// Só redirecionar se estiver tentando acessar a rota raiz
					if(nextPath === '/' || nextPath === '/login') {
						if(result.type == 'supervisor'){
							$location.path('/supervisor');
						}
						else if(result.type == 'inspector') {
							$location.path('/temporal');
						}
					}
					// Se já está tentando acessar uma rota específica válida, permitir
				}
			});
		}
	});

	// Verificação inicial - apenas para rotas específicas do sistema principal
	var currentPath = $location.path();
	var mainSystemRoutes = ['/temporal', '/supervisor', '/dashboard', '/login', '/'];
	
	// Initial route check
	
	if (!isAdminRoute(currentPath) && (mainSystemRoutes.includes(currentPath) || currentPath === '')) {
		// Running initial login check for main system
		requester._get('login/user', function(result) {
			if(!result) {
				// Initial check: No user found, redirecting to /login
				$location.path('/login');
			} else {
				$rootScope.user = result;

				// Only redirect if current path is root or empty
				if(currentPath === '/' || currentPath === '') {
					if(result.type == 'supervisor'){
						$location.path('/supervisor');
					}
					else if(result.type == 'inspector') {
						$location.path('/temporal');
					}
				}
			}
		});
	}
});
