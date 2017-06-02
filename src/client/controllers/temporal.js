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

<<<<<<< HEAD
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
=======
		$scope.markers = {
			"mainMarker": {
        lat: $scope.data.point.lat,
				lng: $scope.data.point.lon,
        focus: true,
        icon: {
        	iconUrl: 'assets/marker.png',
        	iconSize: [11, 11]
        }
			}
    };

    $scope.markers = [];
		$scope.maps = [];
		$scope.centers = [];

		index=0;
		for (var year=2000; year <= 2016; year++) {

			sattelite = 'L7';
			if(year > 2012) { 
				sattelite = 'L8'
			} else if(year > 2011) {
				sattelite = 'L7'
			} else if(year > 2003) {
				sattelite = 'L5'
			}

			marker = {};
			marker["first"] = {
	        lat: $scope.data.point.lat,
					lng: $scope.data.point.lon,
	        icon: {
	        	iconUrl: 'assets/marker.png',
	        	iconSize: [11, 11]
	        }
    	};

    	$scope.markers.push(angular.copy(marker));

			$scope.maps.push({
				tileLayer: '/map/'+sattelite+'_'+year+'_DRY/{z}/{x}/{y}',
        zoomControl: false,
        dragging: false,
        doubleClickZoom: false,
        center: {
        	lat: $scope.data.point.lat,
					lng: $scope.data.point.lon,
					zoom: 13
        },
        year: year
			});

			$scope.centers.push({
				lat: $scope.data.point.lat,
				lng: $scope.data.point.lon,
				zoom: 13
			});
		}
>>>>>>> 705e1acce2f846dc4bb19138959c32fcf4a3bf11

	});

});