'use strict';

Application.controller('TviController', function($rootScope, $scope, requester) {

	requester._get('points/next-point', function(data) {
		$scope.data = data;
	});
	
	$scope.nextPoint = function() {
		requester._post('points/next-point', function(data) {
			$scope.data = data;	
		});
	}

});