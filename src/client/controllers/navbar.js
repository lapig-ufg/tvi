'uses trict'

Application.controller('navController', function($rootScope, $scope, $location, $window, requester, util) {

	$rootScope.showNavInsp= false;
	$rootScope.showNavSuper= false;

	$scope.logoff = function() {
		requester._get('login/logoff', function(result) {
			$scope.data = undefined;
			$rootScope.user = undefined;
			$location.path('login');
		})
	}

	$scope.downloadCSV = function() {
		window.open('service/points/csv')
		window.close();
	};

	requester._get('login/user', function(result) {
		$rootScope.user = result;
	});
});
