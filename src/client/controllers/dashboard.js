'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {

	var data = [{
	  values: [16, 15, 12, 6, 5, 4, 42],
	  labels: ['US', 'China', 'European Union', 'Russian Federation', 'Brazil', 'India', 'Rest of World' ],
	  domain: {
	    x: [0, .48]
	  },
	  name: 'GHG Emissions',
	  hoverinfo: 'label+percent+name',
	  hole: .4,
	  type: 'pie'
	}];

	var layout = {
	  title: 'Global Emissions 1990-2011',
	  annotations: [
	    {
	      font: {
	        size: 14
	      },
	      showarrow: false,
	      text: 'GHG',
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
	  height: 400,
	  width: 480
	};

	Plotly.newPlot('myDiv', data, layout);

});