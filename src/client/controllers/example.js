'use strict';

Application.controller('ExampleController', function($rootScope, $scope, $timeout, requester) {

	requester._get('example', function(exampleData) {
		$scope.data = exampleData;
	});

	$timeout(function(){
		$scope.data.title = 'Opa';
	},3000);

});