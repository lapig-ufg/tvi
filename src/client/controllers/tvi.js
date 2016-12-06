'use strict';

Application.controller('TviController', function($rootScope, $scope, $location, $window, requester, util, $interval, $timeout) {

	requester._get('login/user', function(result) {
		if(!result.name) {
			$location.path('login');
		} else {
			$scope.name = result.name;
			$scope.campaign = result.campaign;
			init();
		}
	});

	$scope.logoff = function(){
		requester._get('login/logoff', function(result){

		})
	}

	var requestSupportInfo = function() {
		if($scope.data.point) {
			var params = {
				region: $scope.data.point.biome,
				regionType:'biome',
				city:$scope.data.point.countyCode,
				lang:"pt-br"
			};

			requester._get("spatial/query", params, function(pastagem) {
				util._suport(pastagem, function(suportData){
					$scope.suportData = suportData;				
				});
			});		
		}
	}

	var init = function() {
		
		$scope.landuseValues = {
			"agricultura":"Agricultura", 
			"area_urbana":"Área urbana", 
			"agua":"Água", 
			"mata_galeria":"Mata de galeria", 
			"mosaico_ocupacao":"Mosaico de Ocupação", 
			"nao_observado": "Não observado",
			"pastagem":"Pastagem",
			"silvicultura":"Silvicultura", 
			"vegetacao_nativa":"Vegetação nativa"
		};
		$scope.certaintyIndexValues = [25, 50, 75, 100]
		$scope.pointEnabled1 = true;
		$scope.pointEnabled2 = true;
		$scope.formData = {};
		$scope.isDisabled = false;

		var biome;
		var countyCode;

		$scope.counter = 0;
    $interval(function () {
			$scope.counter = $scope.counter + 1;
    }, 1000);

		requester._get('points/next-point', function(data) {
			$scope.data = data;
			console.log(data);
			requestSupportInfo()
		});
	}	

	$scope.submitPoint = function() {

		$scope.isDisabled = true;
		$scope.formData._id = $scope.data.point._id;
		$scope.formData.counter = $scope.counter;

		requester._post('points/next-point', { "point": $scope.formData }, function(data) {
			console.log($scope.isDisabled)
			$scope.data = data;
			$scope.counter = 0;
			$scope.isDisabled = false;		
			$scope.suportData = null;
			$scope.formData.landUse = "";
			$scope.formData.certaintyIndex = "";
			console.log($scope.isDisabled)
			requestSupportInfo();
		});
	}

	$scope.getKml = function(){
		var lon = $scope.data.point.lon;
		var lat = $scope.data.point.lat;
		var county = $scope.data.point.county;
		var url = window.location.origin+window.location.pathname
		$window.open(url+"service/kml?longitude="+lon+"&latitude="+lat+"&county="+county);	
	}


});