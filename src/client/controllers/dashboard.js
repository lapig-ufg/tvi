'uses trict';

Application.controller('dashboardController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {
	
	requester._get('dashboard/user-inspections', function(data) {
		
		var d3 = Plotly.d3;
		var gd3 = d3.select('#pointsInsp')
		var gd = gd3.node();

		var dataChart = [{
		  type: 'bar',
		  x: data.ninspection,
		  y: data.usernames,
		  orientation: 'h',
		  hoverinfo: 'x'
		}];
		
		var layout = {
		  height: 400,
			xaxis: {title: 'Pontos inspecionados', fixedrange: true, titlefont: {size: 16}},
		  yaxis: {
		  	title: 'Nome dos inspetores',
		  	titlefont: {
		  		size: 16
		  	},
		  	fixedrange: true,
		    gridwidth: 2,
		    tickangle: -45
	  	},
		  title: 'Número de pontos inspecionados',
	  	titlefont: {
	  		size: 18
	  	}
		};

		Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});
		window.onresize = function() {
    	Plotly.Plots.resize(gd);
		};
	});

	requester._get('dashboard/points-inspection', function(data) {

		var d3 = Plotly.d3;
		var gd3 = d3.select('#totalInpec')
		var gd = gd3.node();

		var chartPizza = [{
		  values: [data.totalPoints, data.pointsInspection, data.noTotalPoints],
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
		window.onresize = function() {
    	Plotly.Plots.resize(gd);
		};
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
		  orientation: 'h'
		}];
		

		var layout = {
		  height: 400,
			xaxis: {title: 'Tempo medio das inspeções por segundos', fixedrange: true, titlefont: {size: 16}},
		  yaxis: {
		  	title: 'Nome dos inspetores',
		  	titlefont: {
		  		size: 16
		  	},
		  	fixedrange: true,
		    gridwidth: 2,
		    tickangle: -45
		  },
		  title: 'Média de tempo por ponto inspecionado',
	  	titlefont: {
	  		size: 18
	  	}
		};
		
		Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});	
		window.onresize = function() {
    	Plotly.Plots.resize(gd);
		};
	});

	requester._get('dashboard/cachedPoints-inspection', function(data) {

		var d3 = Plotly.d3;
		var gd3 = d3.select('#cachedPoints')
		var gd = gd3.node();

		var pointsCached = [{
		  values: [data.pointsCached, data.pointsNoCached],
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
		window.onresize = function() {
    	Plotly.Plots.resize(gd);
		};
	});

});