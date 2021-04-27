'uses trict';

Application.controller('dashboardController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {
	
	util.waitUserData(function() {
	
		var chartsGd = [];

		window.onresize = function() {
			chartsGd.forEach(function(gd) {
	  		Plotly.Plots.resize(gd);
			})
		};

		requester._get('dashboard/user-inspections', function(data) {
			
			var d3 = Plotly.d3;
			var gd3 = d3.select('#pointsInsp')
			var gd = gd3.node();

			var dataChart = [{
			  type: 'bar',
			  marker: {
	        color: 'rgba(168,80,81,1)'
			  },
			  x: data.ninspection,
			  y: data.usernames,
			  orientation: 'h',
			  hoverinfo: 'x'
			}];

			var layout = {
			  height: 400,
				margin: {
			  	l: 110,
			  	pad: 0
			  },
				xaxis: {
					fixedrange: true
				},
			  yaxis: {
			  	fixedrange: true,
			    gridwidth: 2
		  	},
			  title: 'Número de pontos inspecionados',
		  	titlefont: {
		  		size: 18
		  	}
			};

			Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});
			chartsGd.push(gd);
		});

		requester._get('dashboard/points-inspection', function(data) {

			var d3 = Plotly.d3;
			var gd3 = d3.select('#totalInspec')
			var gd = gd3.node();

			var chartPizza = [{
			  values: [data.pointsComplet, data.pointsInspection, data.pointsNoComplet],
			  marker: {
			  	colors: ['rgba(44,160,44,0.9)','rgba(221,221,42,0.9)','rgba(237,19,21,0.85)']
			  },
			  labels: ['Inspeções completas', 'Inspeções incompletas', 'Sem inspeções'],
			  type: 'pie',
			  hoverinfo: 'label+value'
			}];

			var layout = {
			  height: 500,
			  title: 'Número de inspeções',
		  	titlefont: {
		  		size: 18
		  	}
			};

			Plotly.newPlot(gd, chartPizza, layout, {displayModeBar: false});	
			chartsGd.push(gd);
		});

		requester._get('dashboard/meanTime-inspection', function(data) {

			var d3 = Plotly.d3;
			var gd3 = d3.select('#meanTime')
			var gd = gd3.node();

			var name = [];
			var avg = [];

			for(key in data) {
				name.push(key);			
				avg.push(data[key].avg);
			}

			var dataChart = [{
			  type: 'bar',
			  x: avg,
			  y: name,
			  orientation: 'h',
	 		  hoverinfo: 'x'
			}];
			
			var layout = {
			  height: 400,
	 		  margin: {
			  	l: 110,
			  	pad: 0
			  },
				xaxis: {
					fixedrange: true
				},
			  yaxis: {
			  	fixedrange: true,
			    gridwidth: 2
			  },
			  title: 'Média de tempo por ponto inspecionado',
		  	titlefont: {
		  		size: 18
		  	}
			};
			
			Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});	
			chartsGd.push(gd);
		});

		requester._get('dashboard/cachedPoints-inspection', function(data) {

			var d3 = Plotly.d3;
			var gd3 = d3.select('#cachedPoints')
			var gd = gd3.node();

			var pointsCached = [{
			  values: [data.pointsCached, data.pointsNoCached],
			  marker: {
			  	colors: ['rgba(29,84,54,0.9)','rgba(208,201,26,0.9)']
			  },
			  labels: ['Pontos com cache', 'Pontos sem cache'],
			  type: 'pie',
			  hoverinfo: 'label+value'
			}];

			var layout = {
			  height: 500,
			  title: 'Total de pontos armazenados',
		  	titlefont: {
		  		size: 18
		  	}
			};

			Plotly.newPlot(gd, pointsCached, layout, {displayModeBar: false});	
			chartsGd.push(gd);
		});

		requester._get('dashboard/agreementPoints-inspection', function(data) {
			var d3 = Plotly.d3;
			var gd3 = d3.select('#agreementPoints')
			var gd = gd3.node();
			
			var lengthObj = Object.keys(data).length;
			var years = [];
			var points = [];
			var count = 0;

			for(key in data) {
				count++;
				if(count<=lengthObj) {					
					years.push(key)
					points.push(data[key])
				}
			}

			var yearsSplit = [];
			var pointsAgree = [];
			var pointsAgreeAdm = [];
			var pointsNoAgree = [];

			for(var i=0; i<years.length; i=i+3) {
				yearsSplit.push(years[i].split("_"))
			}

			var j=0;
			var k=1;
			var l=2;
			for(var i=0; i<lengthObj/3; i++) {
				yearsSplit[i] = yearsSplit[i][0];
				pointsAgree[i] = points[j];
				pointsAgreeAdm[i] = points[k];
				pointsNoAgree[i] = points[l];

				j=j+3;
				k=k+3;
				l=l+3;
			}

			var	pointsAgreement = {
			  x: pointsAgree,
			  y: yearsSplit,
			  marker: {
			  	color: 'rgba(32,128,72,0.8)'
			  },
			  name: 'Pontos com concordância',
			  type: 'bar',
		 	  orientation: 'h',
			  hoverinfo: 'x'
			};

			var	pointsAgreementAdm = {
			  x: pointsAgreeAdm,
			  y: yearsSplit,
			  marker: {
			  	color: 'rgba(65,105,225,0.8)'
			  },
			  name: 'Pontos alterados',
			  type: 'bar',
		 	  orientation: 'h',
			  hoverinfo: 'x'
			};

			var pointsNoAgreement = {
			  x: pointsNoAgree,
			  y: yearsSplit,
			  marker: {
			  	color: 'rgba(255,127,14,0.8)'
			  },
			  name: 'Pontos sem concordância',
			  type: 'bar',
			  orientation: 'h',
			  hoverinfo: 'x'
			};

			var concordanciaDePontos = [pointsAgreement, pointsAgreementAdm, pointsNoAgreement];
			var layout = {
			  height: 500,
			  margin: {
			  	l: 125,
			  	pad: 0
			  },
				xaxis: {
			  	fixedrange: true
				},
			  yaxis: {
			  	fixedrange: true,
			    gridwidth: 2
		  	},
			  title: 'Número de pontos com concordância',
		  	titlefont: {
		  		size: 18
		  	},
				barmode: 'stack'
			};

				Plotly.newPlot(gd, concordanciaDePontos, layout, {displayModeBar: false});	
				chartsGd.push(gd);
		});

		requester._get('dashboard/landCoverPoints-inspection', function(data) {
			var d3 = Plotly.d3;
			var gd3 = d3.select('#coverPoints')
			var gd = gd3.node();

			var namesCover = [];
			var meanValue = [];

			for(key in data) {
				namesCover.push(key);
				meanValue.push(data[key]);
			}

			var dataChart = [{
			  type: 'bar',
			  marker: {
	        color: 'rgba(169,169,169,1)'
			  },
			  x: meanValue,
			  y: namesCover,
			  orientation: 'h',
			  hoverinfo: 'x'
			}];
			
			var layout = {
			  height: 500,
			  margin: {
			  	l: 125,
			  	pad: 0
			  },
				xaxis: {
					fixedrange: true
				},
			  yaxis: {
			  	fixedrange: true,
			    gridwidth: 2
		  	},
			  title: 'Média de votos por cobertura em %',
		  	titlefont: {
		  		size: 18
		  	}
			};

			Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});	
			chartsGd.push(gd);
		});

		function reverse(element) {
			return (element === '') ? '' : reverse(element.substr(1)) + element.charAt(0);
		}

		requester._get('dashboard/memberStatus-inspection', function(data) {
			
			for(var key in data) {

				if(data[key].dateLastPoint) {					
					var dateTemp = data[key].dateLastPoint.split('T')[0];
					dateTemp = dateTemp.split('-');
					var dateFinal = dateTemp[2]+'-'+dateTemp[1]+'-'+dateTemp[0];

					data[key].dateLastPoint = dateFinal
				}
			}

			$scope.tableStatus = data;
		})

		$scope.setTable = function() {
			requester._get('dashboard/memberStatus-inspection', function(data) {

				for(var key in data) {

					if(data[key].dateLastPoint) {	
						var dateTemp = data[key].dateLastPoint.split('T')[0];
						dateTemp = dateTemp.split('-');
						var dateFinal = dateTemp[2]+'-'+dateTemp[1]+'-'+dateTemp[0];

						data[key].dateLastPoint = dateFinal
					}
				}
	
				$scope.tableStatus = data;
			})
		}

	});
});