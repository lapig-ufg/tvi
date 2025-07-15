'uses trict';

Application.controller('dashboardController', function($rootScope, $scope, $location, $interval, $window, $timeout, requester, fakeRequester, util, i18nService) {
	
	var chartsGd = [];
	
	// Função para criar os gráficos
	function createCharts() {
		// Verificar se estamos na página correta
		if ($location.path() !== '/dashboard') {
			return;
		}
		
		// Limpar gráficos anteriores
		chartsGd = [];
		
		// User Inspections Chart
		requester._get('dashboard/user-inspections', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#pointsInsp');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #pointsInsp não encontrado - tentando novamente...');
					$timeout(function() {
						createUserInspectionsChart(data);
					}, 500);
					return;
				}
				
				createUserInspectionsChart(data);
			});
		});
		
		// Points Inspection Chart
		requester._get('dashboard/points-inspection', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#totalInspec');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #totalInspec não encontrado - tentando novamente...');
					$timeout(function() {
						createPointsInspectionChart(data);
					}, 500);
					return;
				}
				
				createPointsInspectionChart(data);
			});
		});
		
		// Mean Time Chart
		requester._get('dashboard/meanTime-inspection', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#meanTime');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #meanTime não encontrado - tentando novamente...');
					$timeout(function() {
						createMeanTimeChart(data);
					}, 500);
					return;
				}
				
				createMeanTimeChart(data);
			});
		});
		
		// Cached Points Chart
		requester._get('dashboard/cachedPoints-inspection', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#cachedPoints');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #cachedPoints não encontrado - tentando novamente...');
					$timeout(function() {
						createCachedPointsChart(data);
					}, 500);
					return;
				}
				
				createCachedPointsChart(data);
			});
		});
		
		// Agreement Points Chart
		requester._get('dashboard/agreementPoints-inspection', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#agreementPoints');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #agreementPoints não encontrado - tentando novamente...');
					$timeout(function() {
						createAgreementPointsChart(data);
					}, 500);
					return;
				}
				
				createAgreementPointsChart(data);
			});
		});
		
		// Land Cover Points Chart
		requester._get('dashboard/landCoverPoints-inspection', function(data) {
			$timeout(function() {
				var d3 = Plotly.d3;
				var gd3 = d3.select('#coverPoints');
				var gd = gd3.node();
				
				if (!gd) {
					console.warn('Elemento #coverPoints não encontrado - tentando novamente...');
					$timeout(function() {
						createLandCoverChart(data);
					}, 500);
					return;
				}
				
				createLandCoverChart(data);
			});
		});
		
		// Member Status Table
		requester._get('dashboard/memberStatus-inspection', function(data) {
			updateMemberStatusTable(data);
		});
	}
	
	// Funções individuais para criar cada gráfico
	function createUserInspectionsChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#pointsInsp');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || !data.ninspection || !data.usernames || 
			data.ninspection.length === 0 || data.usernames.length === 0) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.INSPECTED_POINTS'), 400);
			return;
		}
		
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
			title: i18nService.translate('DASHBOARD.INSPECTED_POINTS'),
			titlefont: {
				size: 18
			}
		};
		
		Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function createPointsInspectionChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#totalInspec');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || (data.pointsComplet === undefined && data.pointsInspection === undefined && data.pointsNoComplet === undefined)) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.INSPECTIONS_NUMBER'), 500);
			return;
		}
		
		var chartPizza = [{
			values: [data.pointsComplet, data.pointsInspection, data.pointsNoComplet],
			marker: {
				colors: ['rgba(44,160,44,0.9)','rgba(221,221,42,0.9)','rgba(237,19,21,0.85)']
			},
			labels: [i18nService.translate('DASHBOARD.COMPLETE_INSPECTIONS'), i18nService.translate('DASHBOARD.INCOMPLETE_INSPECTIONS'), i18nService.translate('DASHBOARD.NO_INSPECTIONS')],
			type: 'pie',
			hoverinfo: 'label+value'
		}];
		
		var layout = {
			height: 500,
			title: i18nService.translate('DASHBOARD.INSPECTIONS_NUMBER'),
			titlefont: {
				size: 18
			}
		};
		
		Plotly.newPlot(gd, chartPizza, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function createMeanTimeChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#meanTime');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.AVG_TIME_PER_POINT'), 400);
			return;
		}
		
		var name = [];
		var avg = [];
		
		for(var key in data) {
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
			title: i18nService.translate('DASHBOARD.AVG_TIME_PER_POINT'),
			titlefont: {
				size: 18
			}
		};
		
		Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function createCachedPointsChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#cachedPoints');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || (data.pointsCached === undefined && data.pointsNoCached === undefined)) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.TOTAL_STORED_POINTS'), 500);
			return;
		}
		
		var pointsCached = [{
			values: [data.pointsCached, data.pointsNoCached],
			marker: {
				colors: ['rgba(29,84,54,0.9)','rgba(208,201,26,0.9)']
			},
			labels: [i18nService.translate('DASHBOARD.POINTS_WITH_CACHE'), i18nService.translate('DASHBOARD.POINTS_WITHOUT_CACHE')],
			type: 'pie',
			hoverinfo: 'label+value'
		}];
		
		var layout = {
			height: 500,
			title: i18nService.translate('DASHBOARD.TOTAL_STORED_POINTS'),
			titlefont: {
				size: 18
			}
		};
		
		Plotly.newPlot(gd, pointsCached, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function createAgreementPointsChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#agreementPoints');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.POINTS_WITH_AGREEMENT'), 500);
			return;
		}
		
		var lengthObj = Object.keys(data).length;
		var years = [];
		var points = [];
		var count = 0;
		
		for(var key in data) {
			count++;
			if(count <= lengthObj) {
				years.push(key);
				points.push(data[key]);
			}
		}
		
		var yearsSplit = [];
		var pointsAgree = [];
		var pointsAgreeAdm = [];
		var pointsNoAgree = [];
		
		for(var i = 0; i < years.length; i = i + 3) {
			yearsSplit.push(years[i].split("_"));
		}
		
		var j = 0;
		var k = 1;
		var l = 2;
		for(var i = 0; i < lengthObj/3; i++) {
			yearsSplit[i] = yearsSplit[i][0];
			pointsAgree[i] = points[j];
			pointsAgreeAdm[i] = points[k];
			pointsNoAgree[i] = points[l];
			
			j = j + 3;
			k = k + 3;
			l = l + 3;
		}
		
		var pointsAgreement = {
			x: pointsAgree,
			y: yearsSplit,
			marker: {
				color: 'rgba(32,128,72,0.8)'
			},
			name: i18nService.translate('DASHBOARD.POINTS_WITH_AGREEMENT'),
			type: 'bar',
			orientation: 'h',
			hoverinfo: 'x'
		};
		
		var pointsAgreementAdm = {
			x: pointsAgreeAdm,
			y: yearsSplit,
			marker: {
				color: 'rgba(65,105,225,0.8)'
			},
			name: i18nService.translate('DASHBOARD.POINTS_CHANGED'),
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
			name: i18nService.translate('DASHBOARD.POINTS_WITHOUT_AGREEMENT'),
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
			title: i18nService.translate('DASHBOARD.POINTS_WITH_AGREEMENT'),
			titlefont: {
				size: 18
			},
			barmode: 'stack'
		};
		
		Plotly.newPlot(gd, concordanciaDePontos, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function createLandCoverChart(data) {
		var d3 = Plotly.d3;
		var gd3 = d3.select('#coverPoints');
		var gd = gd3.node();
		
		if (!gd) return;
		
		// Verificar se há dados válidos
		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, i18nService.translate('DASHBOARD.AVG_VOTES_BY_COVERAGE'), 500);
			return;
		}
		
		var namesCover = [];
		var meanValue = [];
		
		for(var key in data) {
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
			title: i18nService.translate('DASHBOARD.AVG_VOTES_BY_COVERAGE'),
			titlefont: {
				size: 18
			}
		};
		
		Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});
		chartsGd.push(gd);
	}
	
	function updateMemberStatusTable(data) {
		if (!data || Object.keys(data).length === 0) {
			console.warn('Nenhum dado retornado de memberStatus-inspection');
			$scope.tableStatus = {};
			return;
		}
		
		for(var key in data) {
			if(data[key] && data[key].dateLastPoint) {
				var dateTemp = data[key].dateLastPoint.split('T')[0];
				dateTemp = dateTemp.split('-');
				var dateFinal = dateTemp[2] + '-' + dateTemp[1] + '-' + dateTemp[0];
				data[key].dateLastPoint = dateFinal;
			}
		}
		
		$scope.tableStatus = data;
	}
	
	function showNoDataMessage(element, title, height) {
		var layout = {
			height: height,
			title: title,
			titlefont: {
				size: 18
			},
			xaxis: {
				visible: false
			},
			yaxis: {
				visible: false
			},
			annotations: [{
				text: i18nService.translate('DASHBOARD.NO_DATA_AVAILABLE'),
				xref: 'paper',
				yref: 'paper',
				showarrow: false,
				font: {
					size: 20,
					color: 'grey'
				},
				x: 0.5,
				y: 0.5
			}]
		};
		Plotly.newPlot(element, [], layout, {displayModeBar: false});
	}
	
	// Window resize handler
	window.onresize = function() {
		chartsGd.forEach(function(gd) {
			if (gd && Plotly && Plotly.Plots) {
				Plotly.Plots.resize(gd);
			}
		});
	};
	
	// Função para atualizar tabela
	$scope.setTable = function() {
		requester._get('dashboard/memberStatus-inspection', function(data) {
			updateMemberStatusTable(data);
		});
	};
	
	// Aguardar o carregamento completo da view antes de criar os gráficos
	$scope.$on('$viewContentLoaded', function() {
		// Aguardar dados do usuário
		util.waitUserData(function() {
			// Aguardar um pouco mais para garantir que o DOM esteja pronto
			$timeout(function() {
				createCharts();
			}, 100);
		});
	});
	
	// Cleanup quando sair da view
	$scope.$on('$destroy', function() {
		chartsGd = [];
		if (window.onresize) {
			window.onresize = null;
		}
	});
});