'use strict';

Application.controller('ExampleController', function($rootScope, $scope, requester) {

	requester._get('example', function(exampleData) {
		$scope.data = exampleData;
	});

});