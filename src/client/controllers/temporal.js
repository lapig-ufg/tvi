'uses trict';

Application.controller('temporalController', function($rootScope, $scope, $location, $window, requester, fakeRequester, util) {

	//requester._get('points/next-point', function(data) {
	$scope.size = 3;
	$scope.indexImg = 0;
	$scope.pointEnabled = true;
	var count = 0;
	$scope.answers = [];
	
	var landUse = ["Agricultura", "Área urbana", "Água", "Mata de galeria", "Mosaico de ocupação", "Não observado", "Pastagem", "Silvicultura", "Vegetação nativa"];

	$scope.formPlus = function(years, landUse){
		$scope.answers.push(
			{
				initialYear: $scope.answers[count].finalYear,
				finalYear: years[15],
				firstLandUse: landUse[1]
			}		
		)

		count++;
	}

	$scope.formSubtraction = function(){
		if($scope.answers.length > 1){
			$scope.answers.splice(-1,1);
			count--;
		}
	}

	fakeRequester.nextPoints(function(data) {
		var years = [];
		for(var i = 0; i  < data.point.img.length; i++){
			var year = new Date(data.point.img[i].image[0].date);	
			years.push(year.getFullYear());
		}
		$scope.landUse = landUse;
		$scope.years = years;
		$scope.data = data;
		$scope.answers.push(
			{
				initialYear: years[0],
				finalYear: years[15],
				firstLandUse: landUse[1]
			}		
		)

		requester._get('spatial/query2',{"longitude":data.point.lon,"latitude": data.point.lat}, function(data) {
	
			var date = [];
			var ndvi = []
			for(var i = 0; i < data.values.length; i++){
				date.push(data.values[i][0]);
				ndvi.push(data.values[i][1])
			}
			
			MODIS = document.getElementById('modis');

			Plotly.plot( MODIS, [{
			    x: date,
			    y: ndvi }], { 
			    margin: { t: 0 } }, {displayModeBar: false} );

		});

	});

});