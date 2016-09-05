var Application = angular.module('application', ['ngRoute']);

Application.config(function($routeProvider, $locationProvider) {

	$routeProvider
		.when('/example', {
			controller: 'ExampleController',
			templateUrl: 'views/example.tpl.html',
			reloadOnSearch: false
		})
		.otherwise({
			redirectTo: '/example'
		});

}).run(function($http) {
	
	$http.defaults.headers.post['Content-Type'] = 'application/json';
	$http.defaults.headers.put['Content-Type'] = 'application/json';
	delete $http.defaults.headers.common['X-Requested-With'];

});