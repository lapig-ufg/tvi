var Application = angular.module('application', ['ngRoute', 'ngMagnify']);

Application.config(function($routeProvider, $locationProvider) {

	$routeProvider
		.when('/example', {
			controller: 'ExampleController',
			templateUrl: 'views/example.tpl.html',
			reloadOnSearch: false
		})
		.when('/tvi', {
			controller: 'TviController',
			templateUrl: 'views/tvi.tpl.html',
			reloadOnSearch: false
		})
		.when('/login', {
			controller: 'LoginController',
			templateUrl: 'views/login.tpl.html',
			reloadOnSearch: false
		})
		.when('/tviSuper', {
			controller: 'tviSuper',
			templateUrl: 'views/tviSupervisor.tpl.html',
			reloadOnSearch: false
		})
		.when('/dashboard', {
			controller: 'dashboardController',
			templateUrl: 'views/dashboard.tpl.html',
			reloadOnSearch: false
		})
		.otherwise({
			redirectTo: '/login'
		});

}).run(function($http) {
	
	$http.defaults.headers.post['Content-Type'] = 'application/json';
	$http.defaults.headers.put['Content-Type'] = 'application/json';
	delete $http.defaults.headers.common['X-Requested-With'];

});