'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {
	
	

	requester._get('login/user', function(session) {
		
		requester._get('points/count/',{'campaign':session.campaign}, function(result) {

			var insp = 'Inspeções da campanha '

			console.log(result);
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
			  title: insp.concat(session.campaign),
			  showlegend: true,
			  annotations: [
			    {
			      font: {
			        size: 14
			      },
			      showarrow: false,
			      text: '',
			      x: 0.17,
			      y: 0.5
			    }
			  ],
			  height: 800,
			  width: 800
			};

			Plotly.newPlot('myDiv', data, layout, {displayModeBar: false});

		})
		
	});



});