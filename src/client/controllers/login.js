'use strict';

Application.controller('LoginController', function($rootScope, $scope, $location, $window, requester, util) {

	$scope.showMsg = false;
	$scope.showForm = false;

	requester._get('login/user', function(result) {

		if(result.name && result.senha){
			$location.path('tviSuper');
		}
		else if(result.name) {
			$location.path('tvi');
		} else {
			$scope.showForm = true;
		}
	});

	$scope.logoff = function(){
		requester._get('login/logoff', function(result){

		})
	}

	$scope.submit = function(name, campaign, senha){
		$scope.name = name;
		$scope.campaign = campaign;
		$scope.senha = senha;
		/*

		$scope.name = "admin";
		$scope.campaign = "campanha_2000";
		$scope.senha = "lapigSergio";
		*/


		requester._post('login',{'name':$scope.name, 'campaign':$scope.campaign, 'senha': $scope.senha}, function(result) {
			
			if(result.type == 'supervisor'){
				
				$location.path('pontos')
			}else if(result.login){
				$location.path('tvi');
			} else {
				$scope.showMsg = true;
			}

				
		});
	}

});