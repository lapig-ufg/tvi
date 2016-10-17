'use strict';

Application.controller('TviController', function($rootScope, $scope, $location, $window, requester, util) {


	$scope.landuse = {"agricultura":"Agricultura", "silvicultura":"Silvicultura", "area_urbana":"Área urbana", "vegetacao_nativa":"Vegetação nativa", "mata_galeria":"Mata de galeria", "agua":"Água", "outros":"Outros", "pastagem":"Pastagem"};
	$scope.assurance = [25, 50, 75, 100]
	$scope.pointEnabled1 = true;
	$scope.pointEnabled2 = true;
	$scope.formData = {};
	var biome;
	var countyCode;



	requester._get('points/next-point', function(data) {
		$scope.data = data;		
		
		requester._get("spatial/query?region="+$scope.data.point.biome+"&regionType=biome&city="+$scope.data.point.countyCode+"&lang=pt-br", function(pastagem) {

			util._suport(pastagem, function(suportData){
				console.log(suportData);
				$scope.suportData = suportData;				
			});

		});
		
	});
	
	$scope.submitPoint = function() {		
		$scope.formData._id = $scope.data.point._id;
		$scope.formData.classe_uso = "";
		$scope.formData.ass = "";
		requester._post('points/next-point', { "point": $scope.formData } , function(data) {
			$scope.data = data;	
		});
	}

	$scope.getKml = function(){
		var lon = $scope.data.point.lon;
		var lat = $scope.data.point.lat;
		var county = $scope.data.point.county;
		$window.open("http://localhost:5000/service/kml?longitude="+lon+"&latitude="+lat+"&county="+county);	
	}


});