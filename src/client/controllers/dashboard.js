'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {

  requester._get('login/user', function(session) {
    
    requester._get('points/count/',{'campaign':session.campaign}, function(donut) {

      requester._get('points/horizontal1/', {'campaign':session.campaign}, function(horizontal1){  

        var insp = 'Inspeções da campanha'

        console.log(donut)

        var data = [{
          values: [donut.inspect, donut.not_inspect],
          labels: ['inspecionado', 'não inspecionado'],
          domain: {
            x: [0, .48]
          },
          name: 'Inspecoes',
          hoverinfo: 'label+percent+name',
          hole: .3,
          type: 'pie'
        }];

        var layout = {
          title: insp,
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
        
        var data2 = [{
          type: 'bar',
          x: [horizontal1[0].value, horizontal1[1].value, horizontal1[2].value],
          y: [horizontal1[0]._id, horizontal1[1]._id, horizontal1[2]._id],
          orientation: 'h'
        }];

        var layout2 = {
          title: "Inspeçoes por usuario"
        }
        
        Plotly.newPlot('donuts',data, layout, {displayModeBar: false});
        Plotly.newPlot('myDiv2', data2, layout2, {displayModeBar: false});
        

      })

		})
		
	});

});