'uses trict';

Application.controller('supervisorController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {

	util.waitUserData(function() {
		$scope.size = 3;
		$scope.onSubmission = false;
		$scope.period = 'DRY';
		$scope.periodo = 'SECO';
		$scope.pointEnabled = true;
		$scope.config = {
			initialYear: $rootScope.user.campaign.initialYear,
			finalYear: $rootScope.user.campaign.finalYear,
			zoomLevel: 13,
			landUse: $rootScope.user.campaign.landUse
		}

		$scope.formPlus = function() {
			
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

		$scope.formSubtraction = function() {
			if($scope.answers.length >= 1) {
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

		var getDateImages = function() {
			date = []
			for(var i = 0; i < $scope.maps.length; i++) {
				date.push(new Date($scope.maps[i].date));
			}
			return date;
		}

		var trace2NDVI = function(values, date) {
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
			
			Plotly.purge('NDVI');

			requester._get('time-series/MOD13Q1_NDVI',{ "longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {

				var ndvi = [];
				var ndviSg = [];
				var date = [];
				var text = [];

				var ndviAndDate = {}
				for(var i = 0; i < data.values.length; i++){
					ndvi.push(data.values[i][1]);
					ndviSg.push(data.values[i][3]);
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

				var gd3 = d3.select('#NDVI')

				var gd = gd3.node();
				
				var trace1 = {
				  x: date,
				  y: ndvi,
				  text: date,
				  name:"NDVI",
				  hoverinfo: "text+y",
				  line: {
				  	width: 1.5,
				  	color: '#f6b2b2'
				  }
				};

				var trace2 = {
				  x: date,
				  y: ndviSg,
				  text: date,
				  name:"NDVI (savGol)",
				  hoverinfo:"none",
				  line: {
				  	width: 1,
				  	color: '#db2828'
				  }
				};
				
				var trace3 = {
				  x: dry,
				  y: trace2NDVI(data.values, dry),
				  text: dry,
				  mode: 'markers',
				  marker: {
				    color: '#818181',
				    size: 6
				  },
				 	name: 'Landsat (Seco)',
				 	hoverinfo:"none"
				};

				var trace4 = {
				  x: wet,
				  y: trace2NDVI(data.values, wet),
				  text: wet,
				  mode: 'markers',
				  marker: {
				    color: '#323232',
				    size: 6
				  },
				 	name: 'Landsat (Chuvoso)',
				 	hoverinfo:"none"
				};
				
				var layout = {
				  height: 400,
				  legend: {
				  	xanchor:"center",
	    			yanchor:"top",
				    orientation: "h",
				  	y: 1.2,
						x: 0.5
					},
				  xaxis: {
				  	tickmode: 'auto',
				  	nticks: 19,
				  	fixedrange: true,
				  	gridcolor: '#828282',
	    			gridwidth: 1,
				  },
				  yaxis: {
				  	fixedrange: true
				  }
				};

				var data = [trace1, trace2, trace3, trace4];

				Plotly.newPlot(gd, data, layout, {displayModeBar: false});

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
				tmsIdDry = sattelite+'_'+year+'_DRY';
				tmsIdWet = sattelite+'_'+year+'_WET';

				$scope.tmsIdListDry.push(tmsIdDry)
				$scope.tmsIdListWet.push(tmsIdWet)
				
				var host = location.host;
				if (host.indexOf('maps.lapig.iesa.ufg.br') !== -1) {
					host = host.replace('maps.lapig', 'lapig');
				}

				var url = "http://{s}." + host + '/map/'+tmsId+'/{z}/{x}/{y}';

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

		$scope.submit = function(index) {
			requester._get('points/get-point/'+index, loadPoint);
		}

		var loadPoint = function(data) {
			$scope.onSubmission = false;

			$scope.point = data.point;
			$rootScope.total = data.total;
			$rootScope.count = data.count;
			$rootScope.current = data.current;

			initFormViewVariables();
			generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
			generateMaps();
			createModisChart(data.point.dates);
			$scope.counter = 0;

			requester._get('points/total-points/', function(total) {
				$scope.total = total.count;
			});

		}

		initCounter();
		requester._get('points/get-point/1', loadPoint);

	});

});