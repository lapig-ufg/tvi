'use strict'

Application.controller('navController', function($rootScope, $scope, $location, $window, requester, util, i18nService) {

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
			$window.alert(i18nService.translate('ALERTS.CAMPAIGN_NOT_FINISHED'))
		}
	};

	requester._get('login/user', function(result) {
		$rootScope.user = result;
	});
});
