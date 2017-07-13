'uses trict';

Application.controller('dashboardController', function($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util) {
	
	requester._get('dashboard/user-inspections', function(data) {
		
		var dataChart = [{
		  type: 'bar',
		  x: data.ninspection,
		  y: data.usernames,
		  orientation: 'h',
		  hoverinfo: 'x'
		}];
		
		var layout = {
			xaxis: {title: 'Pontos inspecionados', fixedrange: true},
		  yaxis: {title: 'Nome dos inspetores', fixedrange: true },
		  title: 'Número de pontos inspecionados'
		};

		Plotly.newPlot('myDiv', dataChart, layout, {displayModeBar: false});
	});

	requester._get('dashboard/points-inspection', function(data) {

		var chartPizza = [{
		  values: [data.totalPoints, data.noTotalPoints],
		  labels: ['Inspeções completas', 'Inspeções incompletas'],
		  type: 'pie',
		  hoverinfo: 'label+value'
		}];

		var layout = {
		  height: 400,
		  width: 500,
		  title: 'Número de inspeções'
		};

		Plotly.newPlot('chart', chartPizza, layout, {displayModeBar: false});	
	});

});