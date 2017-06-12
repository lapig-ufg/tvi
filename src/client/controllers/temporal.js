'uses trict';

Application.controller('temporalController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {

	$scope.size = 3;
	$scope.onSubmission = false;
	$scope.period = 'DRY';
	$scope.periodo = 'SECO';
	$scope.pointEnabled = true;

	$scope.config = {
		initialYear: 2000,
		finalYear: 2016,
		zoomLevel: 13,
		landUse: ["Agricultura", "Área urbana", "Água", "Mata de galeria", "Mosaico de ocupação", "Não observado", "Pastagem", "Silvicultura", "Vegetação nativa"]
	}

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

	$scope.submitForm = function() {
		var formPoint = {
			_id: $scope.point._id,
			inspection: {
        counter: $scope.counter,
        form: $scope.answers
			}
    }
		
    $scope.onSubmission = true;

    requester._post('points/next-point', { "point": formPoint }, loadPoint);

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
			/*
			var ndvi = [];
			var date = [];
			var text = [];
			var ndviAndDate = {}

			for(var i = 0; i < data.values.length; i++){
				ndvi.push(data.values[i][1]);
				date.push(new Date(data.values[i][0]));
				var dateObj = new Date(data.values[i][0])
				var month = dateObj.getUTCMonth() + 1;
				var day = dateObj.getUTCDate();
				var year = dateObj.getUTCFullYear();
				text.push(day + "/" + month + "/" + year);
			}
			*/
		})		
	}

	var createModisChart = function() {
		
		Plotly.purge('modis');

		requester._get('spatial/query2',{"longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {
	
			var ndvi = [];
			var date = [];
			var text = [];

			var ndviAndDate = {}
			for(var i = 0; i < data.values.length; i++){
				ndvi.push(data.values[i][1]);
				date.push(new Date(data.values[i][0]));
				var dateObj = new Date(data.values[i][0])
				var month = dateObj.getUTCMonth() + 1;
				var day = dateObj.getUTCDate();
				var year = dateObj.getUTCFullYear();
				text.push(day + "/" + month + "/" + year);
			}

			var trace1 = {
			  x: date,
			  y: ndvi,
			  text: text,
			  type: 'scatter',
			  name:"NDVI",
			  hoverinfo: "text"
			};

			var trace2 = {
			  x: getDateImages(),
			  y: trace2NDVI(data.values, getDateImages()),
			  mode: 'markers',
			  marker: {
			    color: 'rgb(219, 64, 82)',
			    size: 8
			  },
			 	name: 'Landsat',
			 	hoverinfo: 'none'
			};

			var layout = {
			  width: 1100,
			  height: 500,
			  xaxis: {
			  	tickmode: 'auto',
			  	tickvals: getDateImages(),
			  	ticktext: getDateImages()
			  }
			};

			var data = [trace1, trace2];

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
				date: ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : 'Sem observação no período',
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

	var initCounter = function() {
		$scope.counter = 0;
    $interval(function () {
			$scope.counter = $scope.counter + 1;
    }, 1000);
	}

	var initFormViewVariables = function() {
		$scope.optionYears = [];

		$scope.answers = [
			{
				initialYear: $scope.config.initialYear,
				finalYear: $scope.config.finalYear,
				landUse: $scope.config.landUse[1]
			}
		];
	}

	var loadPoint = function(data) {
		
		$scope.onSubmission = false;

		$scope.point = data.point;
		$rootScope.total = data.total;
		$rootScope.count = data.count;
		$rootScope.current = data.current;

		initFormViewVariables();
		generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
		createModisChart()
		createPrecipitationChart()
		generateMaps();
		$scope.counter = 0;

	}

	initCounter();
	requester._get('points/next-point', loadPoint);

});