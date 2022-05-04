'uses trict';

Application.controller('supervisorController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {
	$scope.showCharts = false
	util.waitUserData(function() {
		$scope.size = 4;
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

		$scope.isChaco = ($rootScope.user.campaign._id.indexOf('chaco') != -1 );
		$scope.isRaisg = ($rootScope.user.campaign._id.indexOf('samples') != -1 || $rootScope.user.campaign._id.indexOf('raisg') != -1);

		$scope.dataTab = [
		  {"name":"Usuários", "checked":true},
		  {"name":"Pontos", "checked":false}
		];

		$scope.dataTimePoints = [
		  {"data":"Tempo de inspeção do ponto (s)"},
		  {"data":"Tempo médio de todos os pontos (s)"}
		];

		$scope.sortTimeInspection = function(element) {
		  angular.forEach($scope.dataTab, function(elem) {
		    elem.checked = false;
		  });

		  element.checked = !element.checked;
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
			if($scope.newValue == undefined)
				$scope.newValue = true;

			$scope.newValue = !$scope.newValue;
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

		var getPrecipitationData = function(callback) {
			requester._get('spatial/precipitation',{"longitude": $scope.point.lon,"latitude": $scope.point.lat}, function(data) {

				var precipit = [];
				var date = [];
				var text = [];

				for(var i = 0; i < data.values.length; i++) {
					precipit.push(data.values[i][1]);
					date.push(new Date(data.values[i][0]));
					var dateObj = new Date(data.values[i][0]);
					var month = dateObj.getUTCMonth() + 1;
					var day = dateObj.getUTCDate();
					var year = dateObj.getUTCFullYear();
					text.push(day + "/" + month + "/" + year);
				}

				var result = {
					"precipit": precipit,
					"date": date,
					"text": text
				};

				callback(result);
			})			
		}

		var getDryDate = function(dates, tmsIdList) {
			var dry = [];
			for(key in dates){
				for(var i = 0; i < tmsIdList.length; i++) {
					if(key == tmsIdList[i]){
						var year = parseInt(dates[key].split('-')[0]);
						if(year >= 2000) {
							dry.push(dates[key])
						}
					}
				}
			}
			return dry.sort()
		}

		var createModisChart = function(datesFromService) {
			
			Plotly.purge('NDVI');

			requester._get('time-series/MOD13Q1_NDVI',{ "longitude":$scope.point.lon,"latitude": $scope.point.lat}, function(data) {
				getPrecipitationData(function(dataPrecip) {

					var ndvi = [];
					var ndviSg = [];
					var date = [];
					var text = [];
					$scope.showCharts = data.values.length > 0;

					for(var i = 0; i < data.values.length; i++) {
						var dateObj = new Date(data.values[i][0])
						var month = dateObj.getUTCMonth() + 1;
						var day = dateObj.getUTCDate();
						var year = dateObj.getUTCFullYear();
						ndvi.push(data.values[i][1]);
						ndviSg.push(data.values[i][3]);
						date.push(data.values[i][0]);
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
					 	name: 'Landsat (Seco)',
					 	hoverinfo:"none",
					  mode: 'markers',
					  marker: {
					    size: 6,
				    	color: '#818181'
					  }
					};

					var trace4 = {
					  x: wet,
					  y: trace2NDVI(data.values, wet),
					  text: wet,
					 	name: 'Landsat (Chuvoso)',
					 	hoverinfo:"none",
					  mode: 'markers',
					  marker: {
					    color: '#323232',
					    size: 6
					  }
					};

					var initDate = date[0].split("-")
					var initPrec = 0;
					var precData = [];
					var precValue = [];
					var precText = [];

					for(var i=0; i<dataPrecip.text.length; i++) {
						dataPrecip.text[i] = dataPrecip.text[i].split("/");
						dataPrecip.text[i] = dataPrecip.text[i].reverse();
						dataPrecip.text[i] = dataPrecip.text[i].toString();
						dataPrecip.text[i] = dataPrecip.text[i].replace(',','-');
						dataPrecip.text[i] = dataPrecip.text[i].replace(',','-');
					}
					
					var count = 0;
					for(var i=0; i<dataPrecip.text.length; i++) {					
						initPrec = dataPrecip.text[i].split("-")
						
						if(initPrec[0] >= initDate[0]) {
							precData[count] = dataPrecip.text[i];
							precValue[count] = dataPrecip.precipit[i];
							var temp = dataPrecip.text[i].split("-");
							precText[count] = temp[0]+'-'+temp[1];

							count++;
						}
					}

					var trace5 = {
						x: precData,
						y: precValue,
						text: precText,
						name: 'Precipitação',
						hoverinfo: 'text+y',
						opacity: 0.5,
						mode: 'markers',
						marker: {
							size: 6,
							color: '#0000ff',
							line: {
						  	width: 0.1
			        }
						},
						yaxis: 'y5',
				    type: 'bar'
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
		    			gridwidth: 1
					  },
					  yaxis: {
					  	title: 'NDVI',
					  	fixedrange: true,
					  	rangemode: "nonnegative"
					  },
					   yaxis5: {
					   	title: 'Precipitação',
					  	fixedrange: true,
					    overlaying: 'y',
					    side: 'right'
					  }
					};

					var dataChart = [trace1, trace2, trace3, trace4, trace5];

					Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});

					window.onresize = function() {
					  Plotly.Plots.resize(gd);
					};

				});
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
				} else if(year > 2003  || year < 2000) {
					sattelite = 'L5'
				}

				tmsId = sattelite+'_'+year+'_'+$scope.period;
				tmsIdDry = sattelite+'_'+year+'_DRY';
				tmsIdWet = sattelite+'_'+year+'_WET';

				$scope.tmsIdListDry.push(tmsIdDry)
				$scope.tmsIdListWet.push(tmsIdWet)
				
				var host = location.host;
				var url = "http://" + host + '/image/'+tmsId+'/'+$scope.point._id+"?campaign="+$rootScope.user.campaign._id;
				
				$scope.maps.push({
					date: ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : '00/00/'+year,
					year: year,
					url: url
				});
			};
		}

		$scope.getKml = function() {
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
			var filter = {
				"index": index
			};
	
			$scope.changeClass = function(index) {
				for(var i=index; i<$scope.selectedLandUses.length; i++) {
					$scope.selectedLandUses[i] = $scope.selectedLandUses[index]
				}
			}

			if($scope.selectedLandUse && $scope.selectedLandUse != 'Todos')			
				filter["landUse"] = $scope.selectedLandUse;

			if($scope.selectUserNames && $scope.selectUserNames != 'Todos')
				filter["userName"] = $scope.selectUserNames;

			if($scope.selectBiomes && $scope.selectBiomes != 'Todos')
				filter["biome"] = $scope.selectBiomes;			

			if($scope.selectUf && $scope.selectUf != 'Todos')
				filter["uf"] = $scope.selectUf;			

			if($scope.typeSort == 'timeInspection') {
				filter["timeInspection"] = true;
			}

			if($scope.typeSort == 'agreementPoint') {
				filter["agreementPoint"] = true;
			}

			updatedClassConsolidated(filter)
			getClassLandUse(filter);
			landUseFilter(filter);
			usersFilter(filter);
			biomeFilter(filter);
			ufFilter(filter);

			requester._post('points/get-point', filter, loadPoint);
		}

		var updatedClassConsolidated = function(callback) {
			$scope.saveClass = function(element) {
				var result = {}
				$scope.objConsolidated = $scope.selectedLandUses

				result._id = $scope.point._id
				result.class = $scope.objConsolidated

				requester._post('points/updatedClassConsolidated', result, function(data) {
					var aux = 0;
					var flagError = true
				
					for(var i=0; i<$scope.objConsolidated.length; i++) {
						if($scope.objConsolidated[i] == 'Não consolidado') {
							if(flagError)
								window.alert("Falha na operação, preencha todos os campos");
								flagError = false;

						} else {
							aux++

							if(aux == $scope.objConsolidated.length) {
								$scope.submit(1)
								$scope.modeEdit = false;
								$scope.buttonEdit = false;
							}
						}
					}
					
					aux = 0;	
				});
			}
		}

		var getClassLandUse = function(filter) {
			requester._get('points/landUses', function(getLandUses) {
				$scope.getLandUses = getLandUses;
				$scope.buttonEdit = false;
	
				$scope.editClass = function(element) {
					var arrayConsolid = $scope.objConsolidated
					$scope.selectedLandUses = []
					$scope.modeEdit = true;

					for(var i=0; i<arrayConsolid.length; i++) {
						$scope.selectedLandUses.push(arrayConsolid[i])
					}

					$scope.buttonEdit = true;
				}
			});
		}

		var landUseFilter = function(filter) {
			requester._get('points/landUses', filter, function(landUses) {
				landUses.unshift('Todos');

				if(filter.landUse == undefined)
					filter.landUse = 'Todos';

				$scope.selectedLandUse = filter.landUse;
				$scope.landUses = landUses;
			});
		}

		var usersFilter = function(filter) {
			requester._get('points/users', filter, function(userNames) {
				userNames.unshift('Todos');

				if(filter.userName == undefined)
					filter.userName = 'Todos';

				$scope.selectUserNames = filter.userName;
				$scope.userNames = userNames;
			});
		}

		var biomeFilter = function(filter) {
			requester._get('points/biome', filter, function(biomes) {
				biomes.unshift('Todos');

				if(filter.biome == undefined)
					filter.biome = 'Todos';

				$scope.selectBiomes = filter.biome;
				$scope.biomes = biomes;
			});
		}

		var ufFilter = function(filter) {
			requester._get('points/uf', filter, function(stateUF) {
				stateUF.unshift('Todos');

				if(filter.uf == undefined)
					filter.uf = 'Todos';

				$scope.selectUf = filter.uf;
				$scope.stateUF = stateUF;
			});
		}

		var loadPoint = function(data) {
			$scope.campaign = data.campaign;
			$scope.objConsolidated = data.point.classConsolidated;
			$scope.onSubmission = false;
			$scope.pointLoaded = true;
			$scope.point = data.point;
			$rootScope.total = data.total;
			$rootScope.count = data.count;
			$rootScope.current = data.current;
			$scope.datesFromService = data.point.dates;
			$scope.timeInspectionPoint = data.point.dataPointTime.slice(-1)[0].totalPointTime * data.point.userName.length;

			initFormViewVariables();
			//generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
			generateMaps();
			if(!$scope.isChaco) {
				createModisChart(data.point.dates);
			}
			$scope.counter = 0;

			$scope.total = data.totalPoints;
		}

		initCounter();
		$scope.submit(1);

	});
});

Application.directive('ndvi', ['$sce', function($sce) {
	return {
		restrict: 'E',
		template: '<iframe ng-show="scope.point.lon" width="100%" src="{{ trustedUrl }}" frameborder="0" allowfullscreen></iframe>',
		link: function(scope) {
			var lon = scope.point.lon;
			var lat = scope.point.lat;
			var url = `https//timeseries.lapig.iesa.ufg.br/modis/chart/${lon}/${lat}`
			scope.trustedUrl = $sce.trustAsResourceUrl(url);
		}
	}
}]);
