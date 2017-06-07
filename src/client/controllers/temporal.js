'uses trict';

Application.controller('temporalController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {

	$scope.size = 3;
	$scope.onSubmission = false;
	$scope.period = 'DRY';
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
		generateMaps();
	}

	var generateOptionYears = function(initialYear, finalYear) {
		var options = [];
		for (var year = initialYear; year <= finalYear; year++) {
			options.push(year);
		}

		$scope.optionYears.push(options);
	}

	var createModisChart = function() {
		
		MODIS = document.getElementById('modis');
		Plotly.purge(MODIS);

		requester._get('spatial/query2',{"longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {

			var date = [];
			var ndvi = []
			for(var i = 0; i < data.values.length; i++){
				date.push(data.values[i][0]);
				ndvi.push(data.values[i][1])
			}
			
			Plotly.plot( MODIS, [{
			    x: date,
			    y: ndvi }], { 
			    margin: { t: 0 } }, {displayModeBar: false} );
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

	var startCounter = function() {
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
		createModisChart();
		generateMaps();
		startCounter();

	}

	requester._get('points/next-point', loadPoint);

});