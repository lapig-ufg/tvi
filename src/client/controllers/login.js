'uses trict';

Application.controller('LoginController', function($rootScope, $scope, $location, $window, requester, util) {

	$scope.showMsg = false;
	$scope.showForm = true;

	$scope.submit = function(name, senha, campaign) {
		$scope.name = name;
		$scope.senha = senha;
		$scope.campaign = campaign;

		if($scope.name == undefined) {
			$scope.showMsg = true;
		} else {
			requester._post('login',{'name':$scope.name, 'senha':$scope.senha, 'campaign':$scope.campaign}, function(result) {

				$rootScope.user = result;

				if($rootScope.user.type == 'supervisor') {
					$location.path('supervisor')
				} else if($rootScope.user.type == 'inspector') {
					$location.path('temporal');
				} else {
					$scope.showMsg = true;
				}				
			});
		}
	}

});