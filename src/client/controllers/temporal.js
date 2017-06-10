'uses trict';

Application.controller('temporalController', function($rootScope, $scope, $location, $window, requester, fakeRequester, util) {

	$scope.size = 3;
	$scope.period = 'DRY';
	$scope.periodo = 'SECO';
	$scope.pointEnabled = true;

	$scope.config = {
		initialYear: 2000,
		finalYear: 2016,
		zoomLevel: 13,
		landUse: ["Agricultura", "Área urbana", "Água", "Mata de galeria", "Mosaico de ocupação", "Não observado", "Pastagem", "Silvicultura", "Vegetação nativa"]
	}

	$scope.optionYears = [];

	$scope.answers = [
		{
			initialYear: $scope.config.initialYear,
			finalYear: $scope.config.finalYear,
			landUse: $scope.config.landUse[1]
		}
	];

	$scope.formPlus = function(){
		var prevIndex = $scope.answers.length - 1;
		var initialYear = $scope.answers[prevIndex].finalYear + 1
		var finalYear = $scope.config.finalYear;

		generateOptionYears(initialYear,finalYear);

		$scope.answers.push(
			{
				initialYear: initialYear,
				finalYear: finalYear,
				landUse: $scope.config.landUse[1]
			}		
		)
	}

	$scope.formSubtraction = function(){
		if($scope.answers.length > 1){
			$scope.answers.splice(-1,1);
			$scope.optionYears.splice(-1,1);
		}
	}

	$scope.changePeriod = function() {
		$scope.period = ($scope.period == 'DRY') ? 'WET' : 'DRY';
		$scope.periodo = ($scope.periodo == 'SECO') ? 'CHUVOSO' : 'SECO';
		generateMaps();
	}

	var generateOptionYears = function(initialYear, finalYear) {
		var options = [];
		for (var year = initialYear; year <= finalYear; year++) {
			options.push(year);
		}

		$scope.optionYears.push(options);
	}

	var getDateImages = function(){
		date = []
		for(var i = 0; i < $scope.maps.length; i++){
			date.push(new Date($scope.maps[i].date));
		}
		return date;
	}

	var trace2NDVI = function(values, date){
		ndvi = []
		for(var i=0; i < date.length;i++){
			for(var j = 0; j < values.length; j = j +2){
				var dateFromValues = new Date(values[j][0]);
				var dateFromDate = new Date(date[i]);				
				if(((dateFromDate.getUTCMonth() +1) == (dateFromValues.getUTCMonth()+1)) && (dateFromDate.getUTCFullYear() == dateFromValues.getUTCFullYear())){
					ndvi.push(values[j][1]);
				} 
				
			}
		}

		return ndvi;

	}

	var createPrecipitationChart = function(){
		requester._get('spatial/precipitation',{"longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {
			console.log(data.values);
		})		
	}

	var createModisChart = function() {
		requester._get('spatial/query2',{"longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {
	
			var ndvi = [];
			var date = [];
			var ndviAndDate = {}
			
			for(var i = 0; i < data.values.length; i++){
				ndvi.push(data.values[i][1]);
				date.push(new Date(data.values[i][0]));
			}

			var trace1 = {
			  x: date,
			  y: ndvi,
			  type: 'scatter',
			  name:"NDVI"
			};

			/*
			var trace2 = {
			  x: getDateImages(),
			  y: trace2NDVI(data.values, getDateImages()), //saporra nao existe;
			  type: 'scatter'
			};
			*/

			var trace2 = {
			  x: getDateImages(),
			  y: trace2NDVI(data.values, getDateImages()),
			  mode: 'markers',
			  marker: {
			    color: 'rgb(219, 64, 82)',
			    size: 5
			  },
			 	name: 'Landsat',
			 	hoverinfo: 'none'
			};

			var layout = {
			  width: 1100,
			  height: 500,
			  xaxis: {
			  	tickmode: 'linear',
			  	tickvals: getDateImages(),
			  	ticktext: getDateImages()
			  }
			};

			var data = [trace1, trace2];

			// mostrar o dia do MODIS no label_data
			// Remover label_landsat
			// Remove palavra do MODIS do label_MODIS
			//fazer com que a bolinha insida na data corretamente;

			Plotly.newPlot('modis', data, layout);

		});
	}

	var generateMaps = function() {
		$scope.maps = [];

		for (var year = $scope.config.initialYear; year <= $scope.config.finalYear; year++) {
			sattelite = 'L7';
			if(year > 2012) { 
				sattelite = 'L8'
			} else if(year > 2011) {
				sattelite = 'L7'
			} else if(year > 2003) {
				sattelite = 'L5'
			}

			tmsId = sattelite+'_'+year+'_'+$scope.period;
			var url = '/map/'+tmsId+'/{z}/{x}/{y}';
			$scope.maps.push({
				date: ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : year,
				year: year,
				url: url
			});
		};
	}

	$scope.getKml = function(){
		var lon = $scope.point.lon;
		var lat = $scope.point.lat;
		var county = $scope.point.county;
		var url = window.location.origin+window.location.pathname
		$window.open(url+"service/kml?longitude="+lon+"&latitude="+lat+"&county="+county);	
	}

	
	//fakeRequester.nextPoints(function(point) {
	requester._get('points/next-point', function(data) {
		
		$scope.point = data.point;
		$rootScope.total = data.total;
		$rootScope.current = data.current;
		$rootScope.count = data.count;

		generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
		createModisChart()
		createPrecipitationChart()
		generateMaps();

	});

});