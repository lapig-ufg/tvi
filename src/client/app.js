var Application = angular.module('application', ['ngRoute', 'ngMagnify']);

Application.config(function($routeProvider, $locationProvider) {

	$routeProvider
		.when('/temporal', {
			controller: 'temporalController',
			templateUrl: 'views/temporal.tpl.html',
			reloadOnSearch: false
		})
		.otherwise({
			redirectTo: '/login',
			controller: 'LoginController',
			templateUrl:'views/login.tpl.html'
		});

}).run(function($http) {
	
	var socket = io.connect('/');

	$http.defaults.headers.post['Content-Type'] = 'application/json';
	$http.defaults.headers.put['Content-Type'] = 'application/json';
	delete $http.defaults.headers.common['X-Requested-With'];

});