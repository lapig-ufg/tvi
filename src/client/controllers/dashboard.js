'use strict';

Application.controller('dashboardController', function($rootScope, $scope, $timeout, requester) {

  requester._get('login/user', function(session) {
    
      requester._get('points/count/',{'campaign':session.campaign}, function(donut) {

       var insp = 'Inspeções da campanha'


          $scope.inspect = donut.inspect;
          $scope.not_inspect = donut.not_inspect;

          var data = [{
            values: [donut.inspect, donut.not_inspect],
            labels: [donut.inspect+' inspecionados', donut.not_inspect+' não inspecionados'],
            domain: {
              x: [0, .48]
            },
            name: '',
            hoverinfo: 'label+percent+name',
            textinfo: 'none',
            hole: .3,
            type: 'pie',
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

          Plotly.newPlot('donuts',data, layout, {displayModeBar: false});
      });

      requester._get('points/horizontal1/', {'campaign':session.campaign}, function(horizontal1) {

        var data2 = [{
          type: 'bar',
          marker:{
            color: horizontal1.color
          },
          x: horizontal1.coordx,
          y: horizontal1.coordy,
          orientation: 'h'
        }];

        var layout2 = {
          title: "Inspeções por usuario",
          showlegend: false
        }

        Plotly.newPlot('horizontal1', data2, layout2, {displayModeBar: false});

      });

      requester._get('points/horizontal2/', {'campaign':session.campaign}, function(horizontal2) {  

        var data3 = [{
          type: 'bar',
          x: horizontal2.values,
          y: horizontal2.labels,
          orientation: 'h'
        }];

        var layout3 = {
          title: "Votos em uso da terra (corcondância de dois ou mais inspetores)",
          height: 528.625,
          width: 500,
          margin: {
            l: 150,
            r: 20,
            t: 200,
            b: 70
          }
        }
        
        Plotly.newPlot('horizontal2', data3, layout3, {displayModeBar: false});
      
      });
		
	});

});