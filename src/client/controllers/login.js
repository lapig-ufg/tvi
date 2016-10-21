'use strict';

Application.controller('LoginController', function($rootScope, $scope, $location, $window, requester, util) {

	$scope.submit = function(name, campaign){
		$scope.name = name;
		$scope.campaign = campaign;

		requester._post('login', { "name": $scope.name, "campaign": $scope.campaign } , function(data) {
				
		});


	}

});