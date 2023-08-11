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
		window.open('service/points/csv', '_blank')
	};

	$scope.downloadFinalReport = function() {
		if($rootScope.campaignFinished){
			window.open(`https://timeseries.lapig.iesa.ufg.br/api/analytics/tvi/${$rootScope.user.campaign._id}/csv?direct=true`, '_blank')
		} else {
			$window.alert(`A campanha não foi finalizada. Ainda há pontos para finalizarem as inspeções.`)
		}
	};

	requester._get('login/user', function(result) {
		$rootScope.user = result;
	});
});
