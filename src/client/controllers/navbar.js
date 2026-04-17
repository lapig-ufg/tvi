'use strict'

Application.controller('navController', function($rootScope, $scope, $location, $window, $http, $interval, $timeout, requester, util, i18nService, diagnosticCapture, NotificationDialog) {

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

	/**
	 * Abre a aba de tickets capturando diagnósticos da tela atual.
	 * Screenshot e logs de console são persistidos via localStorage
	 * para que a nova aba possa incluí-los no ticket.
	 */
	$scope.openTickets = function() {
		diagnosticCapture.prepareAndOpenTickets('#/tickets');
	};

	// TKT-000009 — progresso de meta semanal para inspetores.
	// Discreto (apenas exibe barra quando há meta configurada).
	$scope.weeklyProgress = null;
	var pollInterval = null;

	$scope.loadWeeklyProgress = function () {
		if (!$rootScope.user || $rootScope.user.type !== 'inspector') return;
		$http.get('/service/me/weekly-progress').then(function (resp) {
			var data = resp.data;
			// Oculta widget se meta não foi configurada (targetEffective=0).
			if (!data || !data.targetEffective) {
				$scope.weeklyProgress = null;
				return;
			}
			var previous = $scope.weeklyProgress;
			$scope.weeklyProgress = data;

			// Exibe toast apenas na transição false→true e apenas uma vez por semana.
			if (data.goalReached && data.weekStart) {
				var storageKey = 'weeklyGoalAchieved::' + data.campaign + '::' + data.weekStart;
				var alreadyShown = false;
				try { alreadyShown = $window.localStorage.getItem(storageKey) === '1'; } catch (_) { /* noop */ }
				var wasNotReached = !previous || !previous.goalReached;
				if (wasNotReached && !alreadyShown && NotificationDialog && NotificationDialog.success) {
					NotificationDialog.success('Você atingiu a meta!');
					try { $window.localStorage.setItem(storageKey, '1'); } catch (_) { /* noop */ }
				}
			}
		}, function () { /* ignora erro transitório */ });
	};

	$scope.$on('$destroy', function () {
		if (pollInterval) { $interval.cancel(pollInterval); pollInterval = null; }
	});

	requester._get('login/user', function(result) {
		$rootScope.user = result;
		if (result && result.type === 'inspector') {
			$timeout($scope.loadWeeklyProgress, 500);
			// Polling leve a cada 30s (a UI também chama em inspection-update via evento dedicado).
			pollInterval = $interval($scope.loadWeeklyProgress, 30000);
		}
	});
});
