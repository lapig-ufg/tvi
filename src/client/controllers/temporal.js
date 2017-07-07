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
		landUse: ["Agricultura Anual", "Agricultura Perene", "Área urbana", "Água", "Cana-de-açucar", "Mosaico de ocupação", "Não observado", "Pastagem Cultivada", "Pastagem Natural", "Solo Exposto", "Silvicultura", "Vegetação nativa"]
	}

	$scope.formPlus = function(){
		
		var prevIndex = $scope.answers.length - 1;
		var initialYear = $scope.answers[prevIndex].finalYear + 1

		if($scope.answers[prevIndex].finalYear == $scope.config.finalYear)
			return;

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
		if($scope.answers.length >= 1){
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

	var getDryDate = function(dates, tmsIdList){
		var dry = [];
		for(key in dates){
			for(var i = 0; i < tmsIdList.length; i++){
				if(key == tmsIdList[i]){
					dry.push(dates[key])
				}
			}
		}
		return dry.sort()
	}

	var createModisChart = function(datesFromService) {
		
		Plotly.purge('modis');

		requester._get('spatial/query2',{"longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {


	
			var ndvi = [];
			var date = [];
			var text = [];

			var ndviAndDate = {}
			for(var i = 0; i < data.values.length; i++){
				ndvi.push(data.values[i][1]);
				date.push(data.values[i][0]);
				var dateObj = new Date(data.values[i][0])
				var month = dateObj.getUTCMonth() + 1;
				var day = dateObj.getUTCDate();
				var year = dateObj.getUTCFullYear();
				text.push(day + "/" + month + "/" + year);
			}
			
			var dry = getDryDate(datesFromService, $scope.tmsIdListDry);
			var wet = getDryDate(datesFromService, $scope.tmsIdListWet);
			
			var d3 = Plotly.d3;

			var WIDTH_IN_PERCENT_OF_PARENT = 100, HEIGHT_IN_PERCENT_OF_PARENT = 100;

			var gd3 = d3.select('#modis')
					    .append('div')
					    .style({
					        width: WIDTH_IN_PERCENT_OF_PARENT + '%',
					        'margin-left': (100 - WIDTH_IN_PERCENT_OF_PARENT) / 2 + '%',

					        height: HEIGHT_IN_PERCENT_OF_PARENT + 'vh',
					        'margin-top': (100 - HEIGHT_IN_PERCENT_OF_PARENT) / 2 + 'vh'
					    });

			var gd = gd3.node();
			console.log(date);
			var trace1 = {
			  x: date,
			  y: ndvi,
			  text: date,
			  name:"MODIS",
			  hoverinfo: "text+y"
			};
			
			var trace2 = {
			  x: dry,
			  y: trace2NDVI(data.values, dry),
			  text: dry,
			  mode: 'markers',
			  marker: {
			    color: 'rgb(219, 64, 82)',
			    size: 8
			  },
			 	name: 'Landsat dry',
			 	hoverinfo:"none"
			};

			var trace3 = {
			  x: wet,
			  y: trace2NDVI(data.values, wet),
			  text: wet,
			  mode: 'markers',
			  marker: {
			    color: 'rgb(100, 64, 82)',
			    size: 8
			  },
			 	name: 'Landsat Wet',
			 	hoverinfo:"none"
			};
			
			var layout = {
			  width: 1100,
			  height: 500,
			  xaxis: {
			  	tickmode: 'auto',
			  	nticks: 19
			  }
			};

			var data = [trace1, trace2, trace3];

			Plotly.newPlot(gd, data, layout);

			window.onresize = function() {
			  Plotly.Plots.resize(gd);
			};

		});
	}

	var generateMaps = function() {
		$scope.maps = [];
		var tmsIdList = [];

		$scope.tmsIdListWet = [];
		$scope.tmsIdListDry = [];

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
			tmsIdList.push(tmsId);
			$scope.maps.push({
				date: ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : 'Sem observação no período',
				year: year,
				url: url
			});
		};

		for (var year = $scope.config.initialYear; year <= $scope.config.finalYear; year++) {
			sattelite = 'L7';
			if(year > 2012) { 
				sattelite = 'L8'
			} else if(year > 2011) {
				sattelite = 'L7'
			} else if(year > 2003) {
				sattelite = 'L5'
			}

			tmsIdDry = sattelite+'_'+year+'_DRY';
			tmsIdWet = sattelite+'_'+year+'_WET';

			$scope.tmsIdListDry.push(tmsIdDry)
			$scope.tmsIdListWet.push(tmsIdWet)
			
		};

		return tmsIdList;

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
		$scope.datesFromService = data.point.dates;

		initFormViewVariables();
		generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
		generateMaps();
		createModisChart(data.point.dates);
		createPrecipitationChart();
		$scope.counter = 0;

	}

	initCounter();
	requester._get('points/next-point', loadPoint);

});