'uses trict';

Application.controller('dashboardController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {
	
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
		var gd3 = d3.select('#totalInpec')
		var gd = gd3.node();

		var chartPizza = [{
		  values: [data.totalPoints, data.pointsInspection, data.noTotalPoints],
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

		for(key in data) {
			years.push(key)
			points.push(data[key])
		}

		var yearsSplit = [];
		var pointsAgree = [];
		var pointsNoAgree = [];

		for(var i=0; i<lengthObj; i=i+2) {
			yearsSplit.push(years[i].split("_"))
		}

		var j=1;
		var l=0;
		for(var i=0; i<yearsSplit.length; i++) {
			yearsSplit[i] = yearsSplit[i][0];
			pointsAgree[i] = points[l];
			pointsNoAgree[i] = points[j];

			l=l+2;
			j=j+2;
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

		var concordanciaDePontos = [pointsAgreement, pointsNoAgreement];
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
        color: ['rgba(115,168,0,1)', 'rgba(184,127,1,1)', 'rgba(204,204,204,1)', 'rgba(214,255,168,1)',
               'rgba(96,20,169,1)', 'rgba(255,214,0,1)', 'rgba(153,194,230,1)', 'rgba(77,55,34,1)', 'rgba(255,255,0,1)', 
               'rgba(255,168,192,1)', 'rgba(105,66,58,0.8)', 'rgba(255,127,14,1)', 'rgba(205,173,0,1)', 'rgba(250,0,0,0.8)']
		  },
		  x: meanValue,
		  y: namesCover,
		  orientation: 'h',
		  hoverinfo: 'x'
		}];
		
		var layout = {
		  height: 400,
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

});