'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {
	
	

	requester._get('login/user', function(session) {
		
		requester._get('points/count/',{'campaign':session.campaign}, function(result) {
			console.log(result);

			var insp = 'Inspeções da campanha '

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
			  height: 528.625,
		    width: 600,
		    hovermode: 'closest',
		    legend: {
		      y: 1.02,
		      x: 0.52,
		      xanchor: 'left',
		      yanchor: 'top'
		    },
			  annotations: [
			    {
			      font: {
			        size: 14
			      },
			      showarrow: false,
			      text: '',
			      x: 0.20,
			      y: 0.51
			    }
			  ]
			};
		
			var data2 =[
    {
      xcalendar: "chinese",
      uid: "ad77d6",
      ysrc: "joseumbertomoreira:2:0d9424",
      ycalendar: "coptic",
      xsrc: "joseumbertomoreira:2:cebb75",
      y: [
        219,
        146,
        112,
        127,
        124
      ],
      x: [
        1995,
        1996,
        1997,
        1998,
        1999
      ],
      type: "bar",
      name: "Rest of world"
    },
    {
      opacity: 1,
      showlegend: true,
      xcalendar: "chinese",
      uid: "39d363",
      ysrc: "joseumbertomoreira:2:cebb75",
      ycalendar: "coptic",
      xsrc: "joseumbertomoreira:2:9f034c",
      marker: {
        line: {
          "width": 1
        }
      },
      textsrc: "joseumbertomoreira:2:cebb75",
      text: [
        1995,
        1996,
        1997,
        1998,
        1999
      ],
      y: [
        1995,
        1996,
        1997,
        1998,
        1999
      ],
      x: [
        1995,
        1996,
        1997,
        1998,
        1999        
      ],
      type: "bar",
      name: "B",
    }
  ]

  var layout2 =  {
    autosize: false,
    title: "How  15 pathogens contribute to the $15.5B <br>economic burden of foodborne illnesses",
    height: 500,
    width: 675,
    hovermode: "closest",
    legend: {
      y: 1.02,
      x: 3.02,
      font: {
        family: "Open Sans"
      },
      xanchor: "left",
      yanchor: "top"
    }
  }
			
			Plotly.newPlot('donuts', data, layout, {displayModeBar: false});
			Plotly.newPlot('myDiv2', data2, layout2, {displayModeBar: false});

		})
		
	});



});