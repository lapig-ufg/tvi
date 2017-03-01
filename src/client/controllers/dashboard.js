'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {
	
	requester._get('points/count', function(result) {

		var data = [{
		  values: [result.inspect, result.not_inspect],
		  labels: ['inspecionado', 'não inspecionado'],
		  domain: {
		    x: [0, .48]
		  },
		  name: 'Inspeções',
		  hoverinfo: 'label+percent+name',
		  hole: .3,
		  type: 'pie'
		}];

		var layout = {
		  title: 'Inspeções da campanha treinamentoLXO60Z',
		  annotations: [
		    {
		      font: {
		        size: 14
		      },
		      showarrow: false,
		      text: 'Insp.',
		      x: 0.17,
		      y: 0.5
		    },
		    {
		      font: {
		        size: 14
		      },
		      showarrow: false,
		      text: 'CO2',
		      x: 0.82,
		      y: 0.5
		    }
		  ],
		  height: 600,
		  width: 480
		};

		Plotly.newPlot('myDiv', data, layout);
		console.log('oi', result);

	})


});