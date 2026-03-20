'use strict';

Application.controller('AdminCampaignMonitoringController', function($scope, $http, $routeParams, $timeout, $location, $window, NotificationDialog, mapLoadingService) {

	var chartsGd = [];
	var socket = null;
	var refreshDebounce = null;
	var chartsGeneration = 0; // Guard contra race condition em refreshes sobrepostos

	$scope.campaignId = $routeParams.id;
	$scope.campaign = null;
	$scope.user = null;
	$scope.loading = true;
	$scope.chartsLoading = true;

	// Stats
	$scope.totalPoints = 0;
	$scope.inspectedPoints = 0;
	$scope.progressPercent = 0;
	$scope.onlineInspectors = 0;

	// Inspetores
	$scope.inspectorCards = [];
	$scope.selectedInspector = null;

	// Ponto selecionado
	$scope.point = null;
	$scope.maps = [];
	$scope.mapStates = {};
	$scope.dataTab = [
		{ name: 'Classificação', checked: true },
		{ name: 'Tempo', checked: false }
	];

	// Seções colapsáveis
	$scope.showCharts = true;
	$scope.showMemberStatus = true;

	// Tabela de status
	$scope.tableStatus = {};

	// Configurações de mapa
	$scope.period = 'DRY';
	$scope.isSentinel = false;
	$scope.useDynamicMaps = false;
	$scope.useWmsForCurrentPeriod = false;
	$scope.wmsEnabled = false;
	$scope.wmsConfig = null;
	$scope.landsatVisparam = null;
	$scope.sentinelVisparam = null;
	$scope.availableVisParams = [];
	$scope.availableSentinelVisParams = [];
	$scope.config = {};

	var apiBase = '/api/admin/campaigns/' + $scope.campaignId + '/monitoring';

	// ========== AUTENTICAÇÃO ==========

	$scope.checkAuth = function() {
		$scope.$root.isAdminMode = true;
		$http.get('/api/admin/check').then(function(response) {
			if (!response.data.authenticated) {
				$location.path('/admin/login');
			} else {
				$scope.user = response.data.user;
				$scope.init();
			}
		}, function() {
			$location.path('/admin/login');
		});
	};

	$scope.logout = function() {
		$scope.$root.isAdminMode = false;
		$http.post('/api/admin/logout').then(function() {
			$location.path('/admin/login');
		});
	};

	$scope.navigateBack = function() {
		$location.path('/admin/campaigns');
	};

	// ========== INICIALIZAÇÃO ==========

	$scope.init = function() {
		$scope.loadCampaign(function() {
			// Gráficos só devem ser renderizados após o DOM estar disponível
			// (loading=false ocorre em loadCampaign, ng-show libera o DOM)
			$timeout(function() {
				$scope.loadAllCharts();
			}, 100);
		});
		$scope.loadInspectorCards();
		$scope.loadMemberStatus();
		$scope.connectSocket();
	};

	$scope.loadCampaign = function(callback) {
		$http.get('/api/campaigns/' + $scope.campaignId).then(function(response) {
			$scope.campaign = response.data;
			$scope.config = {
				initialYear: response.data.initialYear,
				finalYear: response.data.finalYear,
				zoomLevel: response.data.zoomLevel || 13
			};

			// Configuração de mapas dinâmicos
			if (response.data.useDynamicMaps) {
				$scope.useDynamicMaps = true;
			}
			if (response.data.imageType === 'sentinel') {
				$scope.isSentinel = true;
			}

			// Configuração WMS
			if (response.data.wmsConfig && response.data.wmsConfig.enabled) {
				$scope.wmsEnabled = true;
				$scope.wmsConfig = response.data.wmsConfig;
				$scope.wmsPeriod = response.data.wmsConfig.period || 'BOTH';
			}

			// Visparams
			if (response.data.visParams && response.data.visParams.length > 0) {
				$scope.availableVisParams = response.data.visParams;
				$scope.landsatVisparam = response.data.visParams[0];
			}
			if (response.data.sentinelVisParams && response.data.sentinelVisParams.length > 0) {
				$scope.availableSentinelVisParams = response.data.sentinelVisParams;
				$scope.sentinelVisparam = response.data.sentinelVisParams[0];
			}

			$scope.loading = false;
			if (callback) callback();
		}, function() {
			NotificationDialog.error('Erro ao carregar campanha');
			$scope.loading = false;
		});
	};

	// ========== GRÁFICOS ==========

	$scope.loadAllCharts = function() {
		$scope.chartsLoading = true;

		// Incrementar geração — callbacks de chamadas anteriores serão ignorados
		chartsGeneration++;
		var currentGen = chartsGeneration;

		// Purge gráficos existentes antes de recriar (evita memory leak no Plotly)
		var chartSelectors = ['#mon-pointsInsp', '#mon-totalInspec', '#mon-meanTime', '#mon-cachedPoints', '#mon-agreementPoints', '#mon-coverPoints'];
		chartSelectors.forEach(function(sel) {
			var el = document.querySelector(sel);
			if (el) {
				try { Plotly.purge(el); } catch (e) { /* ignore */ }
			}
		});
		chartsGd = [];

		var loaded = 0;
		var total = 6;

		var isStale = function() { return currentGen !== chartsGeneration; };

		var checkDone = function() {
			loaded++;
			if (loaded >= total && !isStale()) {
				$scope.chartsLoading = false;
			}
		};

		$http.get(apiBase + '/inspections-per-user').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createUserInspectionsChart(r.data); });
			checkDone();
		}, checkDone);

		$http.get(apiBase + '/points-summary').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createPointsInspectionChart(r.data); });
			$scope.totalPoints = (r.data.pointsComplet || 0) + (r.data.pointsInspection || 0) + (r.data.pointsNoComplet || 0);
			$scope.inspectedPoints = r.data.pointsComplet || 0;
			$scope.progressPercent = $scope.totalPoints > 0
				? Math.round(($scope.inspectedPoints / $scope.totalPoints) * 100)
				: 0;
			checkDone();
		}, checkDone);

		$http.get(apiBase + '/mean-time').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createMeanTimeChart(r.data); });
			checkDone();
		}, checkDone);

		$http.get(apiBase + '/cached-points').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createCachedPointsChart(r.data); });
			checkDone();
		}, checkDone);

		$http.get(apiBase + '/agreement').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createAgreementPointsChart(r.data); });
			checkDone();
		}, checkDone);

		$http.get(apiBase + '/land-cover').then(function(r) {
			if (isStale()) return;
			$timeout(function() { createLandCoverChart(r.data); });
			checkDone();
		}, checkDone);
	};

	// ========== FUNÇÕES DE GRÁFICOS (padrão dashboard.js) ==========

	function showNoDataMessage(gd, title, height) {
		if (!gd) return;
		Plotly.newPlot(gd, [], {
			height: height,
			title: title,
			titlefont: { size: 16 },
			xaxis: { visible: false },
			yaxis: { visible: false },
			annotations: [{
				text: 'Sem dados disponíveis',
				xref: 'paper', yref: 'paper',
				showarrow: false,
				font: { size: 18, color: 'grey' },
				x: 0.5, y: 0.5
			}]
		}, { displayModeBar: false });
	}

	function getGd(selector) {
		var d3 = Plotly.d3;
		var gd3 = d3.select(selector);
		return gd3.node();
	}

	function createUserInspectionsChart(data) {
		var gd = getGd('#mon-pointsInsp');
		if (!gd) return;

		if (!data || !data.coordx || data.coordx.length === 0) {
			showNoDataMessage(gd, 'Inspeções por Usuário', 350);
			return;
		}

		Plotly.newPlot(gd, [{
			type: 'bar',
			marker: { color: 'rgba(168,80,81,1)' },
			x: data.coordx,
			y: data.coordy,
			orientation: 'h',
			hoverinfo: 'x'
		}], {
			height: 350,
			margin: { l: 110, pad: 0 },
			xaxis: { fixedrange: true },
			yaxis: { fixedrange: true, gridwidth: 2 },
			title: 'Inspeções por Usuário',
			titlefont: { size: 16 }
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	function createPointsInspectionChart(data) {
		var gd = getGd('#mon-totalInspec');
		if (!gd) return;

		if (!data || (data.pointsComplet === undefined && data.pointsInspection === undefined && data.pointsNoComplet === undefined)) {
			showNoDataMessage(gd, 'Status das Inspeções', 400);
			return;
		}

		// Campanha sem pontos: todos os valores são zero
		var total = (data.pointsComplet || 0) + (data.pointsInspection || 0) + (data.pointsNoComplet || 0);
		if (total === 0) {
			showNoDataMessage(gd, 'Status das Inspeções', 400);
			return;
		}

		Plotly.newPlot(gd, [{
			values: [data.pointsComplet, data.pointsInspection, data.pointsNoComplet],
			marker: { colors: ['rgba(44,160,44,0.9)', 'rgba(221,221,42,0.9)', 'rgba(237,19,21,0.85)'] },
			labels: ['Completas', 'Em andamento', 'Não inspecionadas'],
			type: 'pie',
			hoverinfo: 'label+value'
		}], {
			height: 400,
			title: 'Status das Inspeções',
			titlefont: { size: 16 }
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	function createMeanTimeChart(data) {
		var gd = getGd('#mon-meanTime');
		if (!gd) return;

		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, 'Tempo Médio por Ponto (s)', 350);
			return;
		}

		var names = [];
		var avgs = [];
		for (var key in data) {
			names.push(key);
			avgs.push(data[key].avg);
		}

		Plotly.newPlot(gd, [{
			type: 'bar',
			x: avgs,
			y: names,
			orientation: 'h',
			hoverinfo: 'x'
		}], {
			height: 350,
			margin: { l: 110, pad: 0 },
			xaxis: { fixedrange: true },
			yaxis: { fixedrange: true, gridwidth: 2 },
			title: 'Tempo Médio por Ponto (s)',
			titlefont: { size: 16 }
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	function createCachedPointsChart(data) {
		var gd = getGd('#mon-cachedPoints');
		if (!gd) return;

		if (!data || (data.pointsCached === undefined && data.pointsNoCached === undefined)) {
			showNoDataMessage(gd, 'Pontos em Cache', 400);
			return;
		}

		// Campanha sem pontos: ambos zero
		if ((data.pointsCached || 0) + (data.pointsNoCached || 0) === 0) {
			showNoDataMessage(gd, 'Pontos em Cache', 400);
			return;
		}

		Plotly.newPlot(gd, [{
			values: [data.pointsCached, data.pointsNoCached],
			marker: { colors: ['rgba(29,84,54,0.9)', 'rgba(208,201,26,0.9)'] },
			labels: ['Com cache', 'Sem cache'],
			type: 'pie',
			hoverinfo: 'label+value'
		}], {
			height: 400,
			title: 'Pontos em Cache',
			titlefont: { size: 16 }
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	function createAgreementPointsChart(data) {
		var gd = getGd('#mon-agreementPoints');
		if (!gd) return;

		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, 'Concordância entre Inspetores', 400);
			return;
		}

		var lengthObj = Object.keys(data).length;
		var years = [];
		var pts = [];
		var count = 0;

		for (var key in data) {
			count++;
			if (count <= lengthObj) {
				years.push(key);
				pts.push(data[key]);
			}
		}

		var yearsSplit = [];
		var pointsAgree = [];
		var pointsAgreeAdm = [];
		var pointsNoAgree = [];

		for (var i = 0; i < years.length; i = i + 3) {
			yearsSplit.push(years[i].split('_'));
		}

		var j = 0, k = 1, l = 2;
		for (var m = 0; m < lengthObj / 3; m++) {
			yearsSplit[m] = yearsSplit[m][0];
			pointsAgree[m] = pts[j];
			pointsAgreeAdm[m] = pts[k];
			pointsNoAgree[m] = pts[l];
			j += 3; k += 3; l += 3;
		}

		Plotly.newPlot(gd, [
			{ x: pointsAgree, y: yearsSplit, marker: { color: 'rgba(32,128,72,0.8)' }, name: 'Concordantes', type: 'bar', orientation: 'h', hoverinfo: 'x' },
			{ x: pointsAgreeAdm, y: yearsSplit, marker: { color: 'rgba(65,105,225,0.8)' }, name: 'Alterados (Admin)', type: 'bar', orientation: 'h', hoverinfo: 'x' },
			{ x: pointsNoAgree, y: yearsSplit, marker: { color: 'rgba(255,127,14,0.8)' }, name: 'Não concordantes', type: 'bar', orientation: 'h', hoverinfo: 'x' }
		], {
			height: 400,
			margin: { l: 125, pad: 0 },
			xaxis: { fixedrange: true },
			yaxis: { fixedrange: true, gridwidth: 2 },
			title: 'Concordância entre Inspetores',
			titlefont: { size: 16 },
			barmode: 'stack'
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	function createLandCoverChart(data) {
		var gd = getGd('#mon-coverPoints');
		if (!gd) return;

		if (!data || Object.keys(data).length === 0) {
			showNoDataMessage(gd, 'Média de Votos por Cobertura', 400);
			return;
		}

		var names = [];
		var values = [];
		for (var key in data) {
			names.push(key);
			values.push(data[key]);
		}

		Plotly.newPlot(gd, [{
			type: 'bar',
			marker: { color: 'rgba(169,169,169,1)' },
			x: values,
			y: names,
			orientation: 'h',
			hoverinfo: 'x'
		}], {
			height: 400,
			margin: { l: 125, pad: 0 },
			xaxis: { fixedrange: true },
			yaxis: { fixedrange: true, gridwidth: 2 },
			title: 'Média de Votos por Cobertura',
			titlefont: { size: 16 }
		}, { displayModeBar: false });
		chartsGd.push(gd);
	}

	// ========== STATUS DOS MEMBROS ==========

	$scope.loadMemberStatus = function() {
		$http.get(apiBase + '/member-status').then(function(response) {
			var data = response.data;
			var onlineCount = 0;
			for (var key in data) {
				if (data[key] && data[key].dateLastPoint) {
					var dateTemp = data[key].dateLastPoint.split('T')[0];
					dateTemp = dateTemp.split('-');
					data[key].dateLastPoint = dateTemp[2] + '-' + dateTemp[1] + '-' + dateTemp[0];
				}
				if (data[key] && data[key].status === 'Online') {
					onlineCount++;
				}
			}
			$scope.tableStatus = data;
			$scope.onlineInspectors = onlineCount;
		});
	};

	$scope.isTableStatusEmpty = function() {
		for (var key in $scope.tableStatus) {
			if ($scope.tableStatus.hasOwnProperty(key)) return false;
		}
		return true;
	};

	// ========== CARTÕES DE INSPETORES ==========

	$scope.loadInspectorCards = function() {
		$http.get(apiBase + '/inspector-cards').then(function(response) {
			$scope.inspectorCards = response.data;
			// Atualizar contagem de online
			var online = 0;
			response.data.forEach(function(card) {
				if (card.status === 'Online') online++;
			});
			$scope.onlineInspectors = online;
		});
	};

	$scope.selectInspector = function(inspector) {
		if ($scope.selectedInspector && $scope.selectedInspector.name === inspector.name) {
			$scope.selectedInspector = null;
			$scope.point = null;
			$scope.maps = [];
			return;
		}

		$scope.selectedInspector = inspector;

		if (inspector.currentPoint) {
			$scope.loadingPoint = true;
			$http.post(apiBase + '/point', { pointId: inspector.currentPoint }).then(function(response) {
				$scope.point = response.data.point;
				$scope.loadingPoint = false;
				generateMaps();
			}, function() {
				$scope.loadingPoint = false;
				NotificationDialog.error('Erro ao carregar ponto');
			});
		} else {
			$scope.point = null;
			$scope.maps = [];
		}
	};

	$scope.getInspectorInitials = function(name) {
		if (!name) return '?';
		var parts = name.split(' ');
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	};

	$scope.getInspectorProgress = function(inspector) {
		if (!inspector.totalPoints || inspector.totalPoints === 0) return 0;
		return Math.round((inspector.inspectionCount / inspector.totalPoints) * 100);
	};

	// ========== TABELA DE INSPEÇÃO ==========

	$scope.sortTimeInspection = function(element) {
		$scope.dataTab.forEach(function(tab) { tab.checked = false; });
		element.checked = true;
	};

	// ========== GRID DE MAPAS ==========

	$scope.formatMapDate = function(dateString) {
		if (!dateString) return '';
		if (dateString.startsWith('00/00/')) {
			return dateString.split('/')[2];
		}
		return dateString;
	};

	$scope.getMapBoxClass = function(mapCount) {
		if (mapCount === 1) return 'col-xs-12 col-sm-12 col-md-12 col-lg-12 ee-mapbox';
		if (mapCount === 2) return 'col-xs-12 col-sm-12 col-md-6 col-lg-6 ee-mapbox';
		if (mapCount === 3) return 'col-xs-12 col-sm-12 col-md-4 col-lg-4 ee-mapbox';
		return 'col-xs-12 col-sm-6 col-md-3 col-lg-3 ee-mapbox';
	};

	$scope.onMapVisible = function(index) {
		if ($scope.mapStates[index].visible || mapLoadingService.isLoaded(index)) {
			return;
		}

		mapLoadingService.enqueue(index, function() {
			$scope.mapStates[index].visible = true;
			$scope.mapStates[index].loading = true;
			mapLoadingService.startLoading(index);

			$timeout(function() {
				mapLoadingService.mapReady(index);
			}, 0);

			$timeout(function() {
				$scope.mapStates[index].loading = false;
				mapLoadingService.finishLoading(index);
			}, 800);
		});
	};

	function generateMaps() {
		$scope.maps = [];
		$scope.mapStates = {};
		mapLoadingService.reset();

		if (!$scope.point || !$scope.config.initialYear) return;

		// Determinar se deve usar WMS
		$scope.useWmsForCurrentPeriod = false;
		if ($scope.wmsEnabled) {
			if ($scope.wmsPeriod === 'BOTH' || $scope.wmsPeriod === $scope.period) {
				$scope.useWmsForCurrentPeriod = true;
			}
		}

		for (var year = $scope.config.initialYear; year <= $scope.config.finalYear; year++) {
			var sattelite = getLandsatSensor(year);
			var tmsId = sattelite + '_' + year + '_' + $scope.period;
			var host = location.host;
			var url = 'http://' + host + '/image/' + tmsId + '/' + $scope.point._id + '?campaign=' + $scope.campaignId;

			var date = ($scope.point.dates && $scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : '00/00/' + year;
			if ($scope.point.images) {
				var image = $scope.point.images.find(function(img) { return img.image_index === tmsId; });
				if (image && image.datetime) {
					date = image.datetime;
				}
			}

			var mapIndex = $scope.maps.length;
			$scope.maps.push({
				date: date,
				year: year,
				url: url,
				bounds: $scope.point.bounds,
				index: mapIndex
			});

			$scope.mapStates[mapIndex] = { visible: false, loading: false };
		}

		// Carregar primeiros mapas
		$timeout(function() {
			var initialMapsToLoad = Math.min(3, $scope.maps.length);
			for (var i = 0; i < initialMapsToLoad; i++) {
				if ($scope.mapStates[i] && !$scope.mapStates[i].visible) {
					$scope.onMapVisible(i);
				}
			}
		}, 200);
	}

	function getLandsatSensor(year) {
		if (year > 2012) return 'L8';
		if (year > 2011) return 'L7';
		if (year > 2003 || year < 2000) return 'L5';
		return 'L7';
	}

	// ========== SOCKET.IO — TEMPO REAL ==========

	$scope.connectSocket = function() {
		socket = io({
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			reconnectionAttempts: 10,
			transports: ['websocket']
		});

		var room = 'campaign-monitoring-' + $scope.campaignId;
		socket.emit('join', room);

		socket.on('inspection-update', function(data) {
			if (refreshDebounce) $timeout.cancel(refreshDebounce);
			refreshDebounce = $timeout(function() {
				$scope.loadAllCharts();
				$scope.loadInspectorCards();
				$scope.loadMemberStatus();
			}, 2000);
		});
	};

	// ========== RESIZE ==========

	var resizeHandler = function() {
		chartsGd.forEach(function(gd) {
			if (gd && Plotly && Plotly.Plots) {
				Plotly.Plots.resize(gd);
			}
		});
	};

	$window.addEventListener('resize', resizeHandler);

	// ========== CLEANUP ==========

	$scope.$on('$destroy', function() {
		// Socket
		if (socket) {
			socket.emit('leave', 'campaign-monitoring-' + $scope.campaignId);
			socket.disconnect();
			socket = null;
		}

		// Debounce
		if (refreshDebounce) {
			$timeout.cancel(refreshDebounce);
		}

		// Gráficos Plotly
		var containers = ['#mon-pointsInsp', '#mon-totalInspec', '#mon-meanTime', '#mon-cachedPoints', '#mon-agreementPoints', '#mon-coverPoints'];
		containers.forEach(function(sel) {
			var el = document.querySelector(sel);
			if (el) {
				try { Plotly.purge(el); } catch (e) { /* ignore */ }
			}
		});
		chartsGd = [];

		// Resize
		$window.removeEventListener('resize', resizeHandler);

		// Map loading
		mapLoadingService.reset();
	});

	// ========== INÍCIO ==========

	$scope.checkAuth();
});
