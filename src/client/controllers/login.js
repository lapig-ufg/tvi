'use s trict';

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

	$scope.submit = function(name, campaign, senha){
		$scope.name = name;
		$scope.campaign = campaign;
		$scope.senha = senha;

		requester._post('login',{'name':$scope.name, 'campaign':$scope.campaign, 'senha': $scope.senha}, function(result) {
			
			$rootScope.user = result;
			
			if($rootScope.user.type == 'supervisor') {
				$location.path('tviSuper')
			}else if($rootScope.user.type == 'inspector') {
				$location.path('tvi');
			} else {
				$scope.showMsg = true;
			}				
		});
	}

});