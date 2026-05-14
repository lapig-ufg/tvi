'use strict';

Application.controller('LoginController', function($rootScope, $scope, $location, $window, $http, $uibModal, requester, util, i18nService) {

	$scope.showMsg = false;
	$scope.showForm = true;

	function performLogin(name, senha, campaign) {
		requester._post('login', { 'name': name, 'senha': senha, 'campaign': campaign }, function(result) {

			$rootScope.user = result;

			if ($rootScope.user.type == 'supervisor') {
				$location.path('supervisor');
			} else if ($rootScope.user.type == 'inspector') {
				$location.path('temporal');
			} else {
				$scope.showMsg = true;
			}
		});
	}

	function openSimilarityDialog(typedName, suggestions) {
		return $uibModal.open({
			animation: true,
			backdrop: 'static',
			keyboard: true,
			size: 'md',
			templateUrl: 'views/username-similarity.tpl.html',
			controller: function($scope, $uibModalInstance) {
				$scope.typedName = typedName;
				$scope.suggestions = suggestions;

				$scope.useSuggestion = function(value) {
					$uibModalInstance.close({ action: 'correct', value: value });
				};

				$scope.continueAsIs = function() {
					$uibModalInstance.close({ action: 'continue' });
				};
			}
		}).result;
	}

	$scope.submit = function(name, senha, campaign) {
		$scope.name = name;
		$scope.senha = senha;
		$scope.campaign = campaign;

		if ($scope.name == undefined || $scope.campaign == undefined) {
			$scope.showMsg = true;
			return;
		}

		$http.post('service/login/check-username', {
			name: $scope.name,
			campaign: $scope.campaign
		}).then(function(httpResponse) {
			var checkResult = httpResponse && httpResponse.data;

			if (!checkResult || checkResult.status === 'exact' || checkResult.status === 'new') {
				performLogin($scope.name, $scope.senha, $scope.campaign);
				return;
			}

			if (checkResult.status === 'similar' && Array.isArray(checkResult.suggestions) && checkResult.suggestions.length > 0) {
				openSimilarityDialog($scope.name, checkResult.suggestions).then(function(decision) {
					if (decision && decision.action === 'correct' && decision.value) {
						$scope.name = decision.value;
						return;
					}
					performLogin($scope.name, $scope.senha, $scope.campaign);
				}, function() {
					performLogin($scope.name, $scope.senha, $scope.campaign);
				});
				return;
			}

			performLogin($scope.name, $scope.senha, $scope.campaign);
		}, function(errorResponse) {
			console.warn('[login] check-username falhou, prosseguindo com login direto', errorResponse && errorResponse.status);
			performLogin($scope.name, $scope.senha, $scope.campaign);
		});
	};

});
