'use strict';

Application.controller('LoginController', function($rootScope, $scope, $location, $window, requester, util) {

	$scope.showMsg = false;
	$scope.showForm = false;

	requester._get('login/user', function(result) {
		if(result.name) {
			$location.path('tvi');
		} else {
			$scope.showForm = true;
		}
	});

	$scope.logoff = function(){
		console.log('angular')
		requester._get('login/logoff', function(result){

		})
	}

	$scope.submit = function(name, campaign){
		$scope.name = name;
		$scope.campaign = campaign;

		requester._post('login',{'name':$scope.name, 'campaign':$scope.campaign}, function(result) {
			
			if(result.login){
				$location.path('tvi');
			} else {
				$scope.showMsg = true;
			}

				
		});
	}

});