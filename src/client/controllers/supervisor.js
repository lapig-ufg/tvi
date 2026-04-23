'uses trict';

Application.controller('supervisorController', function ($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util, $uibModal, $timeout, i18nService, NotificationDialog) {
    $scope.showCharts = false
    $scope.showChartsLandsat = false;
    $scope.showChartsLandsatNdwi = false;
    $scope.showChartsModisNdwi = false;
    $scope.showCorrectCampaign = false;
    $scope.showloading = true;
    $scope.planetMosaics = [];
    $scope.sentinelMosaics   = [];
    $scope.tilesCapabilities = [];
    
    // Variáveis para controle dos gráficos
    $scope.showTimeseriesCharts = false;
    $scope.chartFilterStartYear = 1985;
    $scope.chartFilterEndYear = new Date().getFullYear();
    
    // Estados para lazy loading
    
    // Declarar as funções de gráfico no escopo principal
    var createModisChart, createLandsatChart, createLandsatNdwiChart, createModisNdwiChart;
    
    // Valores padrão para as configurações de visualização
    $scope.showTimeseries = true;
    $scope.showPointInfo = true;
    $scope.useDynamicMaps = false; // Default to inspection-map
    $scope.wmsEnabled = false;
    $scope.wmsConfig = null;
    $scope.wmsPeriod = 'BOTH';
    
    // Inicializar visparam do Landsat
    $scope.landsatVisparam = localStorage.getItem('landsatVisparam') || 'landsat-tvi-false';
    $scope.landsatCapabilities = [];
    $scope.landsatVisparams = [];
    $scope.landsatVisparamDetails = [];
    
    // Inicializar visparam do Sentinel
    $scope.sentinelVisparam = localStorage.getItem('sentinelVisparam') || 'tvi-green';
    $scope.sentinelCapabilities = [];
    $scope.sentinelVisparams = [];
    $scope.sentinelVisparamDetails = [];
    
    // Lista de propriedades padrão que não devem ser mostradas nas propriedades customizadas
    $scope.defaultProperties = ['biome', 'uf', 'county', 'countyCode', 'lat', 'lon', 'longitude', 'latitude'];
    
    // Variáveis para visparams da campanha
    $scope.campaignVisParams = [];
    $scope.defaultCampaignVisParam = null;
    $scope.campaignSentinelVisParams = [];
    $scope.defaultCampaignSentinelVisParam = null;
    
    // Função para atualizar o visparam do Landsat e propagar para todos os mapas
    $scope.updateLandsatVisparam = function() {
        localStorage.setItem('landsatVisparam', $scope.landsatVisparam);
        // Atualizar o default da campanha na memória
        if ($scope.config) {
            $scope.config.defaultVisParam = $scope.landsatVisparam;
        }
        // Atualizar também a variável defaultCampaignVisParam
        $scope.defaultCampaignVisParam = $scope.landsatVisparam;
        // Broadcast para todas as diretivas landsat-map atualizarem
        $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
    };
    
    // Função para atualizar o visparam do Sentinel e propagar para todos os mapas
    $scope.updateSentinelVisparam = function(value) {
        // O valor pode vir do parâmetro ou do scope
        var newVisparam = value || $scope.sentinelVisparam;
        
        console.log('updateSentinelVisparam chamado com:', newVisparam);
        
        // Garantir que temos um valor válido
        if (!newVisparam) {
            console.warn('updateSentinelVisparam: valor inválido');
            return;
        }
        
        // Atualizar o modelo
        $scope.sentinelVisparam = newVisparam;
        
        // Salvar no localStorage
        localStorage.setItem('sentinelVisparam', newVisparam);
        
        // Atualizar o default da campanha na memória
        if ($scope.config) {
            $scope.config.defaultVisParam = newVisparam;
        }
        
        // Atualizar também a variável defaultCampaignSentinelVisParam
        $scope.defaultCampaignSentinelVisParam = newVisparam;
        
        // Broadcast para todas as diretivas sentinel-map atualizarem
        $scope.$broadcast('sentinelVisparamChanged', newVisparam);
        
        console.log('Sentinel visparam atualizado para:', newVisparam);
    };
    
    // Cache para visparams disponíveis
    $scope.availableVisParams = [];
    $scope.availableSentinelVisParams = [];
    
    // Função para obter visparams disponíveis da campanha
    $scope.getAvailableVisParams = function() {
        // Se não há campaignVisParams, retornar vazio
        if (!$scope.campaignVisParams || $scope.campaignVisParams.length === 0) {
            return [];
        }
        
        // Se temos detalhes dos visparams, retornar com display names
        if ($scope.landsatVisparamDetails && $scope.landsatVisparamDetails.length > 0) {
            return $scope.landsatVisparamDetails.filter(function(vp) {
                return $scope.campaignVisParams.includes(vp.name);
            });
        }
        
        // Fallback: criar objetos básicos com nomes amigáveis
        return $scope.campaignVisParams.map(function(vp) {
            // Mapeamento manual dos nomes conhecidos
            var displayNames = {
                'landsat-tvi-true': 'Cor Natural',
                'landsat-tvi-false': 'Falsa Cor',
                'landsat-tvi-agri': 'Agricultura',
                'landsat-tvi-red': 'TVI Red'
            };
            
            return {
                name: vp,
                display_name: displayNames[vp] || vp
            };
        });
    };
    
    // Função para atualizar cache de visparams
    $scope.updateVisParamsCache = function() {
        $scope.availableVisParams = $scope.getAvailableVisParams();
    };
    
    // Função para obter visparams disponíveis do Sentinel da campanha
    $scope.getAvailableSentinelVisParams = function() {
        // Se não há campaignSentinelVisParams, retornar vazio
        if (!$scope.campaignSentinelVisParams || $scope.campaignSentinelVisParams.length === 0) {
            console.log('campaignSentinelVisParams vazio ou indefinido');
            return [];
        }
        
        console.log('campaignSentinelVisParams:', $scope.campaignSentinelVisParams);
        console.log('sentinelVisparamDetails:', $scope.sentinelVisparamDetails);
        
        var result = [];
        
        // Se temos detalhes dos visparams, usar a ordem da campanha
        if ($scope.sentinelVisparamDetails && $scope.sentinelVisparamDetails.length > 0) {
            // Preservar a ordem original da campanha
            $scope.campaignSentinelVisParams.forEach(function(vpName) {
                var detail = $scope.sentinelVisparamDetails.find(function(d) {
                    return d.name === vpName;
                });
                if (detail) {
                    result.push(detail);
                    console.log('Adicionado visparam:', detail.name, '- Display:', detail.display_name);
                }
            });
        } else {
            // Fallback: criar objetos básicos com nomes amigáveis
            var displayNames = {
                'tvi-green': 'TVI Green',
                'tvi-red': 'TVI Red',
                'rgb': 'Cor Natural',
                'false-color': 'Falsa Cor'
            };
            
            result = $scope.campaignSentinelVisParams.map(function(vp) {
                var obj = {
                    name: vp,
                    display_name: displayNames[vp] || vp
                };
                console.log('Criado visparam fallback:', obj.name, '- Display:', obj.display_name);
                return obj;
            });
        }
        
        console.log('availableSentinelVisParams final:', result);
        return result;
    };
    
    // Função para atualizar cache de visparams do Sentinel
    $scope.updateSentinelVisParamsCache = function() {
        $scope.availableSentinelVisParams = $scope.getAvailableSentinelVisParams();
    };
    
    // Função para atualizar visparams disponíveis quando ambos os dados estiverem prontos
    $scope.updateAvailableVisParams = function() {
        // Forçar atualização da view quando ambos dados estão disponíveis
        if (($scope.campaignVisParams && $scope.landsatVisparamDetails) || 
            ($scope.campaignSentinelVisParams && $scope.sentinelVisparamDetails)) {
            $scope.$evalAsync();
        }
    };
    
    // Função para formatar data do mapa - mostra apenas ano se for 00/00/YYYY
    $scope.formatMapDate = function(dateString) {
        if (!dateString) return '';
        
        // Verificar se é no formato 00/00/YYYY
        if (dateString.startsWith('00/00/')) {
            return dateString.split('/')[2]; // Retorna apenas o ano
        }
        
        // Caso contrário, formatar como data normal
        try {
            var date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                var day = ('0' + date.getDate()).slice(-2);
                var month = ('0' + (date.getMonth() + 1)).slice(-2);
                var year = date.getFullYear();
                return day + '/' + month + '/' + year;
            }
        } catch (e) {
            // Se falhar, retornar a string original
        }
        return dateString;
    };

    // Função para determinar a classe CSS do mapa individual baseado no número de mapas
    $scope.getMapBoxClass = function(mapCount) {
        if (mapCount === 1) {
            return 'col-xs-12 col-sm-12 col-md-12 col-lg-12 ee-mapbox';
        } else if (mapCount === 2) {
            return 'col-xs-12 col-sm-12 col-md-6 col-lg-6 ee-mapbox';
        } else if (mapCount === 3) {
            return 'col-xs-12 col-sm-12 col-md-4 col-lg-4 ee-mapbox';
        } else {
            return 'col-xs-12 col-sm-6 col-md-3 col-lg-3 ee-mapbox';
        }
    };

    // Função para determinar a classe CSS da seção de informações do ponto
    $scope.getPointInfoClass = function() {
        // Sempre mostrar o painel lateral - showPointInfo controla apenas a seção de localização
        return 'col-xs-12 col-sm-6 col-md-4 col-lg-3';
    };

    // Função para determinar a classe CSS da seção da tabela
    $scope.getTableClass = function() {
        // Sempre usar o layout padrão - showPointInfo não afeta o tamanho da tabela
        return 'col-xs-12 col-sm-6 col-md-8 col-lg-9';
    };

    // Função para alternar exibição dos gráficos
    $scope.toggleTimeseriesCharts = function() {
        $scope.showTimeseriesCharts = !$scope.showTimeseriesCharts;
        
        // Se estiver mostrando os gráficos e ainda não foram carregados, carregá-los
        if ($scope.showTimeseriesCharts && $scope.point && !$scope.isChaco) {
            createModisChart();
            if (createModisNdwiChart) createModisNdwiChart();
            createLandsatChart();
            if (createLandsatNdwiChart) createLandsatNdwiChart();
        }
    };

    // Função para atualizar o filtro de período dos gráficos
    $scope.updateChartFilter = function() {
        // Validar os anos
        if ($scope.chartFilterStartYear && $scope.chartFilterEndYear &&
            $scope.chartFilterStartYear <= $scope.chartFilterEndYear) {

            // Recriar os gráficos com o novo filtro
            if ($scope.showTimeseriesCharts && $scope.point && !$scope.isChaco) {
                createModisChart();
                if (createModisNdwiChart) createModisNdwiChart();
                createLandsatChart();
                if (createLandsatNdwiChart) createLandsatNdwiChart();
            }
        } else {
            NotificationDialog.warning(i18nService.translate('ALERTS.INVALID_DATE_RANGE'));
        }
    };

    $rootScope.campaignFinished = false
    util.waitUserData(function () {
        $scope.showloading = false;
        $scope.size = 4;
        $scope.onSubmission = false;
        $scope.period = 'DRY';
        $scope.periodo = i18nService.translate('PERIODS.DRY');
        $scope.pointEnabled = true;
        $scope.config = {
            initialYear: $rootScope.user.campaign.initialYear,
            finalYear: $rootScope.user.campaign.finalYear,
            zoomLevel: 13,
            landUse: $rootScope.user.campaign.landUse
        }

        $scope.isChaco = ($rootScope.user.campaign._id.indexOf('chaco') != -1);
        $scope.isRaisg = ($rootScope.user.campaign._id.indexOf('samples') != -1 || $rootScope.user.campaign._id.indexOf('raisg') != -1);
        $scope.isSentinel = $rootScope.user.campaign.hasOwnProperty('image') && $rootScope.user.campaign['image'] === 'sentinel-2-l2a'

        $scope.dataTab = [
            {"name": i18nService.translate('TABS.USERS'), "checked": true},
            {"name": i18nService.translate('TABS.POINTS'), "checked": false}
        ];

        $scope.dataTimePoints = [
            {"data": i18nService.translate('CHARTS.POINT_INSPECTION_TIME')},
            {"data": i18nService.translate('CHARTS.AVG_TIME_ALL_POINTS')}
        ];

        $scope.sortTimeInspection = function (element) {
            angular.forEach($scope.dataTab, function (elem) {
                elem.checked = false;
            });

            element.checked = !element.checked;
        }

        $scope.formPlus = function () {
            var prevIndex = $scope.answers.length - 1;
            var initialYear = $scope.answers[prevIndex].finalYear + 1

            if ($scope.answers[prevIndex].finalYear == $scope.config.finalYear)
                return;

            var finalYear = $scope.config.finalYear;

            generateOptionYears(initialYear, finalYear);

            $scope.answers.push(
                {
                    initialYear: initialYear,
                    finalYear: finalYear,
                    landUse: $scope.config.landUse[1]
                }
            )
        }

        $scope.formSubtraction = function () {
            if ($scope.answers.length >= 1) {
                $scope.answers.splice(-1, 1);
                $scope.optionYears.splice(-1, 1);
            }
        }

        $scope.submitForm = function () {
            var formPoint = {
                _id: $scope.point._id,
                inspection: {
                    counter: $scope.counter,
                    form: $scope.answers
                }
            }

            $scope.onSubmission = true;

            requester._post('points/next-point', {"point": formPoint}, loadPoint);
        }

        $scope.changePeriod = function () {
            var newPeriod = $scope.period === 'DRY' ? 'WET' : 'DRY';
            var scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

            if ($scope.newValue == undefined)
                $scope.newValue = true;

            $scope.newValue = !$scope.newValue;
            $scope.period = newPeriod;
            $scope.periodo = ($scope.period == 'DRY') ? i18nService.translate('PERIODS.DRY') : i18nService.translate('PERIODS.WET');

            generateMaps();

            // Propagar visparam para os mapas recém-criados
            if (!$scope.isSentinel && $scope.landsatVisparam) {
                $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
            } else if ($scope.isSentinel && $scope.sentinelVisparam) {
                $scope.$broadcast('sentinelVisparamChanged', $scope.sentinelVisparam);
            }

            // Restaurar posição do scroll após o digest
            $timeout(function() {
                window.scrollTo(0, scrollPosition);
            }, 0);
        }

        $scope.reloadMaps = function() {
            var scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

            generateMaps();

            if (!$scope.isSentinel && $scope.landsatVisparam) {
                $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
            } else if ($scope.isSentinel && $scope.sentinelVisparam) {
                $scope.$broadcast('sentinelVisparamChanged', $scope.sentinelVisparam);
            }

            $timeout(function() {
                window.scrollTo(0, scrollPosition);
            }, 0);
        };

        var generateOptionYears = function (initialYear, finalYear) {
            var options = [];
            for (var year = initialYear; year <= finalYear; year++) {
                options.push(year);
            }
            $scope.optionYears.push(options);
        }

        var getDateImages = function () {
            date = []
            for (var i = 0; i < $scope.maps.length; i++) {
                date.push(new Date($scope.maps[i].date));
            }
            return date;
        }

        createModisChart = function () {
            Plotly.purge('NDVI');

            requester._get(`timeseries/modis`, {
                "lon": $scope.point.lon,
                "lat": $scope.point.lat
            }, function (data) {
                if (data && data.length > 0) {
                    $scope.showCharts = true;

                    var d3 = Plotly.d3;
                    var gd3 = d3.select('#NDVI');
                    var gd = gd3.node();

                    var layout = {
                        height: 400,
                        legend: {
                            xanchor: "center",
                            yanchor: "top",
                            orientation: "h",
                            y: 1.2,
                            x: 0.5
                        },
                        xaxis: {
                            tickmode: 'auto',
                            nticks: 19,
                            fixedrange: true,
                            gridcolor: '#828282',
                            gridwidth: 1
                        },
                        yaxis: {
                            title: 'NDVI',
                            fixedrange: true
                        },
                        yaxis2: {
                            title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION') + ' (mm)',
                            overlaying: "y",
                            side: "right",
                            fixedrange: true
                        }
                    };

                    Plotly.newPlot(gd, data, layout, {displayModeBar: false});

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                } else {
                    $scope.showCharts = false;
                }
            });
        }

        createLandsatChart = function () {
            Plotly.purge('LANDSAT');

            requester._get(`timeseries/landsat/ndvi`, {
                "lon": $scope.point.lon,
                "lat": $scope.point.lat
            }, function (data) {
                if (data && data.length > 0) {
                    // Aplicar filtro de período se definido
                    let filteredData = [];
                    if ($scope.chartFilterStartYear && $scope.chartFilterEndYear) {
                        for (let i = 0; i < data.length; i++) {
                            let trace = Object.assign({}, data[i]);
                            let filteredX = [];
                            let filteredY = [];

                            for (let j = 0; j < data[i].x.length; j++) {
                                let year = new Date(data[i].x[j]).getFullYear();
                                if (year >= $scope.chartFilterStartYear && year <= $scope.chartFilterEndYear) {
                                    filteredX.push(data[i].x[j]);
                                    filteredY.push(data[i].y[j]);
                                }
                            }

                            trace.x = filteredX;
                            trace.y = filteredY;
                            filteredData.push(trace);
                        }
                    } else {
                        filteredData = data;
                    }

                    $scope.showChartsLandsat = filteredData[0].x.length > 0;

                    if ($scope.showChartsLandsat) {
                        let d3 = Plotly.d3;
                        let gd3 = d3.select('#LANDSAT');
                        let gd = gd3.node();

                    let layout = {
                        height: 400,
                        legend: {
                            xanchor: "center",
                            yanchor: "top",
                            orientation: "h",
                            y: 1.2,
                            x: 0.5
                        },
                        xaxis: {
                            tickmode: 'auto',
                            nticks: 19,
                            fixedrange: true,
                            gridcolor: '#828282',
                            gridwidth: 1
                        },
                        yaxis: {
                            title: 'NDVI',
                            fixedrange: true
                        },
                        yaxis2: {
                            title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION') + ' (mm)',
                            overlaying: "y",
                            side: "right",
                            fixedrange: true
                        }
                    };

                        Plotly.newPlot(gd, filteredData, layout, { displayModeBar: false });
                        Plotly.Plots.resize(gd);

                        window.onresize = function () {
                            Plotly.Plots.resize(gd);
                        };
                    }
                }
            });
        };

        createLandsatNdwiChart = function () {
            Plotly.purge('LANDSAT_NDWI');

            requester._get(`timeseries/landsat/ndwi`, {
                "lon": $scope.point.lon,
                "lat": $scope.point.lat
            }, function (data) {
                if (data && data.length > 0) {
                    $scope.showChartsLandsatNdwi = true;

                    let d3 = Plotly.d3;
                    let gd3 = d3.select('#LANDSAT_NDWI');
                    let gd = gd3.node();

                    let layout = {
                        height: 400,
                        legend: {
                            xanchor: "center",
                            yanchor: "top",
                            orientation: "h",
                            y: 1.2,
                            x: 0.5
                        },
                        xaxis: {
                            tickmode: 'auto',
                            nticks: 19,
                            fixedrange: true,
                            gridcolor: '#828282',
                            gridwidth: 1
                        },
                        yaxis: {
                            title: 'NDWI',
                            fixedrange: true
                        },
                        yaxis2: {
                            title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION') + ' (mm)',
                            overlaying: "y",
                            side: "right",
                            fixedrange: true
                        }
                    };

                    Plotly.newPlot(gd, data, layout, { displayModeBar: false });
                    Plotly.Plots.resize(gd);

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                } else {
                    $scope.showChartsLandsatNdwi = false;
                }
            });
        };

        createModisNdwiChart = function () {
            Plotly.purge('MODIS_NDWI');

            requester._get(`timeseries/modis/ndwi`, {
                "lon": $scope.point.lon,
                "lat": $scope.point.lat
            }, function (data) {
                if (data && data.length > 0) {
                    $scope.showChartsModisNdwi = true;

                    let d3 = Plotly.d3;
                    let gd3 = d3.select('#MODIS_NDWI');
                    let gd = gd3.node();

                    let layout = {
                        height: 400,
                        legend: {
                            xanchor: "center",
                            yanchor: "top",
                            orientation: "h",
                            y: 1.2,
                            x: 0.5
                        },
                        xaxis: {
                            tickmode: 'auto',
                            nticks: 19,
                            fixedrange: true,
                            gridcolor: '#828282',
                            gridwidth: 1
                        },
                        yaxis: {
                            title: 'NDWI',
                            fixedrange: true
                        },
                        yaxis2: {
                            title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION') + ' (mm)',
                            overlaying: "y",
                            side: "right",
                            fixedrange: true
                        }
                    };

                    Plotly.newPlot(gd, data, layout, { displayModeBar: false });

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                } else {
                    $scope.showChartsModisNdwi = false;
                }
            });
        };

        // Função helper para determinar o sensor Landsat baseado no ano usando collections
        var getLandsatSensor = function(year) {
            // Se não temos capabilities do Landsat ou collections, usar lógica padrão
            if (!$scope.landsatCapabilities || !$scope.landsatCapabilities[0] || !$scope.landsatCapabilities[0].collections) {
                // Lógica padrão (legado)
                if (year > 2012) {
                    return 'L8';
                } else if (year > 2011) {
                    return 'L7';
                } else if (year > 2003 || year < 2000) {
                    return 'L5';
                }
                return 'L7';
            }
            
            // Usar collections para determinar o sensor
            var collections = $scope.landsatCapabilities[0].collections;
            for (var collectionId in collections) {
                var collection = collections[collectionId];
                if (collection.year_range && year >= collection.year_range[0] && year <= collection.year_range[1]) {
                    // Mapear sensor para formato usado no código
                    switch (collection.sensor) {
                        case 'TM':
                            return 'L5';
                        case 'ETM+':
                            return 'L7';
                        case 'OLI':
                            return 'L8';
                        case 'OLI-2':
                            return 'L9';
                        default:
                            return 'L8'; // Padrão
                    }
                }
            }
            
            // Se não encontrar, usar lógica padrão
            if (year > 2012) {
                return 'L8';
            } else if (year > 2011) {
                return 'L7';
            } else if (year > 2003 || year < 2000) {
                return 'L5';
            }
            return 'L7';
        };

        var generateMaps = function () {
            $scope.maps = [];

            var tmsIdList = [];

            $scope.tmsIdListWet = [];
            $scope.tmsIdListDry = [];
            
            // Determinar se deve usar WMS para este período
            $scope.useWmsForCurrentPeriod = false;
            
            console.log('=== GENERATE MAPS ===');
            console.log('Período atual:', $scope.period);
            console.log('WMS habilitado:', $scope.wmsEnabled);
            console.log('WMS período config:', $scope.wmsPeriod);
            
            if ($scope.wmsEnabled) {
                if ($scope.wmsPeriod === 'BOTH') {
                    $scope.useWmsForCurrentPeriod = true;
                    console.log('DECISÃO: Usando WMS para período', $scope.period, '(wmsPeriod=BOTH)');
                } else if ($scope.wmsPeriod === $scope.period) {
                    $scope.useWmsForCurrentPeriod = true;
                    console.log('DECISÃO: Usando WMS para período', $scope.period, '(wmsPeriod=' + $scope.wmsPeriod + ')');
                } else {
                    $scope.useWmsForCurrentPeriod = false;
                    console.log('DECISÃO: Usando', $scope.isSentinel ? 'Sentinel' : 'Landsat', 'para período', $scope.period, '(wmsPeriod=' + $scope.wmsPeriod + ')');
                }
            } else {
                console.log('DECISÃO: WMS desabilitado, usando', $scope.isSentinel ? 'Sentinel' : 'Landsat');
            }
            
            console.log('useWmsForCurrentPeriod:', $scope.useWmsForCurrentPeriod);

            for (var year = $scope.config.initialYear; year <= $scope.config.finalYear; year++) {
                sattelite = getLandsatSensor(year);

                tmsId = sattelite + '_' + year + '_' + $scope.period;
                tmsIdDry = sattelite + '_' + year + '_DRY';
                tmsIdWet = sattelite + '_' + year + '_WET';

                $scope.tmsIdListDry.push(tmsIdDry)
                $scope.tmsIdListWet.push(tmsIdWet)

                var host = location.host;
                var url = "http://" + host + '/image/' + tmsId + '/' + $scope.point._id + "?campaign=" + $rootScope.user.campaign._id;

                let date =  ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : '00/00/' + year;
                if( $scope.point.hasOwnProperty('images')){
                    const image = $scope.point['images'].find(img => img.image_index === tmsId)
                    if (image && image.datetime) {
                        date = image.datetime
                    }
                }

                const mapIndex = $scope.maps.length;
                $scope.maps.push({
                    date: date,
                    year: year,
                    url: url,
                    bounds: $scope.point.bounds,
                    index: mapIndex
                });
                
            }
        }


        $scope.getKml = function () {
            var lon = $scope.point.lon;
            var lat = $scope.point.lat;
            var county = $scope.point.county;
            var url = window.location.origin + window.location.pathname
            $window.open(url + "service/kml?longitude=" + lon + "&latitude=" + lat + "&county=" + county);
        }

        var initCounter = function () {
            $scope.counter = 0;
            $interval(function () {
                $scope.counter = $scope.counter + 1;
            }, 1000);
        }

        var initFormViewVariables = function () {
            $scope.optionYears = [];

            // TKT-000031: iniciar a primeira caixa no começo da série temporal,
            // alinhando o comportamento do supervisor ao do inspector padrão.
            $scope.answers = [
                {
                    initialYear: $scope.config.initialYear,
                    finalYear: $scope.config.initialYear,
                    landUse: $scope.config.landUse[1]
                }
            ];
        }

        $scope.submit = function (index) {
            $scope.showloading = true;
            var filter = {
                "index": index
            };

            $scope.changeClass = function (index) {
                for (var i = index; i < $scope.selectedLandUses.length; i++) {
                    $scope.selectedLandUses[i] = $scope.selectedLandUses[index]
                }
            }

            var allText = i18nService.translate('COMMON.ALL');
            
            if ($scope.selectedLandUse && $scope.selectedLandUse != allText)
                filter["landUse"] = $scope.selectedLandUse;

            if ($scope.selectUserNames && $scope.selectUserNames != allText)
                filter["userName"] = $scope.selectUserNames;

            if ($scope.selectBiomes && $scope.selectBiomes != allText)
                filter["biome"] = $scope.selectBiomes;

            if ($scope.selectUf && $scope.selectUf != allText)
                filter["uf"] = $scope.selectUf;

            if ($scope.typeSort == 'timeInspection') {
                filter["timeInspection"] = true;
            }

            if ($scope.typeSort == 'agreementPoint') {
                filter["agreementPoint"] = true;
            }

            updatedClassConsolidated(filter)
            getClassLandUse(filter);
            landUseFilter(filter);
            usersFilter(filter);
            biomeFilter(filter);
            ufFilter(filter);

            requester._post('points/get-point', filter, loadPoint);
            $scope.showloading = false;
        }

        var updatedClassConsolidated = function (callback) {
            $scope.saveClass = function (element) {
                var result = {}
                $scope.objConsolidated = $scope.selectedLandUses

                result._id = $scope.point._id
                result.class = $scope.objConsolidated

                requester._post('points/updatedClassConsolidated', result, function (data) {
                    var aux = 0;
                    var flagError = true

                    for (var i = 0; i < $scope.objConsolidated.length; i++) {
                        if ($scope.objConsolidated[i] == i18nService.translate('COMMON.NOT_CONSOLIDATED')) {
                            if (flagError)
                                NotificationDialog.error(i18nService.translate('ALERTS.FILL_ALL_FIELDS'));
                            flagError = false;

                        } else {
                            aux++

                            if (aux == $scope.objConsolidated.length) {
                                $scope.submit(1)
                                $scope.modeEdit = false;
                                $scope.buttonEdit = false;
                            }
                        }
                    }

                    aux = 0;
                });
            }
        }

        var getClassLandUse = function (filter) {
            requester._get('points/landUses', function (getLandUses) {
                $scope.getLandUses = getLandUses;
                $scope.buttonEdit = false;

                $scope.editClass = function (element) {
                    var arrayConsolid = $scope.objConsolidated
                    $scope.selectedLandUses = []
                    $scope.modeEdit = true;

                    for (var i = 0; i < arrayConsolid.length; i++) {
                        $scope.selectedLandUses.push(arrayConsolid[i])
                    }
                    $scope.buttonEdit = true;
                }
            });
        }

        var landUseFilter = function (filter) {
            requester._get('points/landUses', filter, function (landUses) {
                landUses.unshift(i18nService.translate('COMMON.ALL'));
                landUses.push(i18nService.translate('COMMON.NOT_CONSOLIDATED'));

                if (filter.landUse == undefined)
                    filter.landUse = i18nService.translate('COMMON.ALL');

                $scope.selectedLandUse = filter.landUse;
                $scope.landUses = landUses;
            });
        }

        var usersFilter = function (filter) {
            requester._get('points/users', filter, function (userNames) {
                userNames.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.userName == undefined)
                    filter.userName = i18nService.translate('COMMON.ALL');

                $scope.selectUserNames = filter.userName;
                $scope.userNames = userNames;
            });
        }

        var biomeFilter = function (filter) {
            requester._get('points/biome', filter, function (biomes) {
                biomes.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.biome == undefined)
                    filter.biome = i18nService.translate('COMMON.ALL');

                $scope.selectBiomes = filter.biome;
                $scope.biomes = biomes;
            });
        }

        var ufFilter = function (filter) {
            requester._get('points/uf', filter, function (stateUF) {
                stateUF.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.uf == undefined)
                    filter.uf = i18nService.translate('COMMON.ALL');

                $scope.selectUf = filter.uf;
                $scope.stateUF = stateUF;
            });
        }

        var loadCampaignConfig = function(callback) {
            requester._get('campaign/config', {}, function(config) {
                if (config) {
                    // Atualizar as configurações de visualização
                    $scope.showTimeseries = config.showTimeseries;
                    $scope.showPointInfo = config.showPointInfo;
                    $scope.useDynamicMaps = config.useDynamicMaps;
                    $scope.hasVisParam = config.visParam !== null;
                    
                    // Verificar se é Sentinel baseado no imageType PRIMEIRO
                    if (config.imageType) {
                        $scope.isSentinel = config.imageType === 'sentinel-2-l2a' || 
                                           config.imageType === 'sentinel-2' || 
                                           (config.imageType && config.imageType.toLowerCase().includes('sentinel'));
                        
                        // Verificar se é WMS
                        $scope.isWms = config.imageType === 'wms';
                    }
                    
                    // Processar configuração WMS
                    if (config.wmsConfig && config.wmsConfig.enabled) {
                        $scope.wmsEnabled = true;
                        $scope.wmsConfig = config.wmsConfig;
                        $scope.wmsPeriod = config.wmsPeriod || 'BOTH';
                        
                        // Se for WMS, forçar useDynamicMaps para true
                        if ($scope.isWms) {
                            $scope.useDynamicMaps = true;
                        }
                    }
                    
                    // Processar visparams baseado no tipo de imagem
                    if (config.visParams && config.visParams.length > 0) {
                        if ($scope.isSentinel) {
                            // Se for Sentinel, carregar visparams do Sentinel
                            $scope.campaignSentinelVisParams = config.visParams;
                            $scope.defaultCampaignSentinelVisParam = config.defaultVisParam || null;
                            $scope.updateSentinelVisParamsCache(); // Atualizar cache
                            
                            // Usar defaultVisParam se configurado
                            if (config.defaultVisParam && config.visParams.includes(config.defaultVisParam)) {
                                $scope.sentinelVisparam = config.defaultVisParam;
                            } else if (config.visParams.length > 0) {
                                $scope.sentinelVisparam = config.visParams[0];
                            }
                            
                            // Salvar e broadcast
                            if ($scope.sentinelVisparam) {
                                localStorage.setItem('sentinelVisparam', $scope.sentinelVisparam);
                                $scope.$broadcast('sentinelVisparamChanged', $scope.sentinelVisparam);
                            }
                        } else {
                            // Se for Landsat, carregar visparams do Landsat
                            $scope.campaignVisParams = config.visParams;
                            $scope.defaultCampaignVisParam = config.defaultVisParam || null;
                            $scope.updateVisParamsCache(); // Atualizar cache
                            
                            // Se houver defaultVisParam, usar ele
                            if (config.defaultVisParam && config.visParams.includes(config.defaultVisParam)) {
                                $scope.landsatVisparam = config.defaultVisParam;
                            } else if (config.visParams.length > 0) {
                                $scope.landsatVisparam = config.visParams[0];
                            }
                            
                            // Salvar e broadcast
                            if ($scope.landsatVisparam) {
                                localStorage.setItem('landsatVisparam', $scope.landsatVisparam);
                                $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
                            }
                        }
                    } else if (config.visParam && !$scope.isSentinel) {
                        // Compatibilidade com campo antigo visParam (apenas para Landsat)
                        $scope.landsatVisparam = config.visParam;
                        $scope.campaignVisParams = [config.visParam];
                        $scope.defaultCampaignVisParam = config.visParam;
                        $scope.updateVisParamsCache(); // Atualizar cache
                        
                        localStorage.setItem('landsatVisparam', config.visParam);
                        $scope.$broadcast('landsatVisparamChanged', config.visParam);
                    }
                    
                    // Atualizar visparams disponíveis
                    $scope.updateAvailableVisParams();
                }
                
                // Chamar callback se fornecido
                if (callback) {
                    callback();
                }
            });
        };

        var loadPoint = function (data) {
            Plotly.purge('LANDSAT');
            Plotly.purge('NDVI');

            // Se não há pontos com o filtro atual, avisar o usuário mas continuar
            if(data.totalPoints === 0){
                // Não bloquear - apenas informar o usuário
                console.warn('No points found with current filters');
                // Podemos opcionalmente mostrar uma mensagem mais amigável
                if (!data.point) {
                    NotificationDialog.warning(i18nService.translate('ALERTS.NO_UNCONSOLIDATED_POINTS'));
                    return;
                }
            }
            $scope.campaign = data.campaign;
            $scope.objConsolidated = data.point.classConsolidated;
            $scope.onSubmission = false;
            $scope.pointLoaded = true;
            $scope.point = data.point;
            $rootScope.total = data.total;
            $rootScope.count = data.count;
            $rootScope.current = data.current;
            $scope.datesFromService = data.point.dates;
            $scope.timeInspectionPoint = data.point.dataPointTime.slice(-1)[0].totalPointTime * data.point.userName.length;

            initFormViewVariables();
            //generateOptionYears($scope.config.initialYear, $scope.config.finalYear);
            getCampaignMatadata();

            // TKT-000031: restaurar o intervalo padrão dos filtros de gráfico
            // ao carregar um novo ponto, evitando herdar o filtro anterior.
            $scope.chartFilterStartYear = ($scope.config && $scope.config.initialYear) || 1985;
            $scope.chartFilterEndYear = ($scope.config && $scope.config.finalYear) || new Date().getFullYear();

            loadCampaignConfig(function() {
                generateMaps();
                // Os gráficos agora só serão carregados quando o usuário clicar no botão
                // Resetar a flag sempre que carregar um novo ponto
                $scope.showTimeseriesCharts = false;
            });
            
            $scope.counter = 0;

            $scope.total = data.totalPoints;
        }

        initCounter();

        // Deep-link vindo de /tickets: quando a URL traz ?pointIndex=N,
        // abrimos a tela já posicionada no ponto solicitado (valores
        // inválidos caem silenciosamente para o índice 1).
        var initialIndex = 1;
        var qs = $location.search();
        var parsed = parseInt(qs && qs.pointIndex, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            initialIndex = parsed;
            if (!$scope.point) $scope.point = {};
            $scope.point.index = initialIndex;
        }

        $scope.submit(initialIndex);

        var correctCampain = () => {
            $scope.showloading = true;
            requester._get(`campaign/correct`, {
                "campaign": $rootScope.user.campaign._id
            }, function (data) {
                $scope.showloading = false;
                if (data) {
                    NotificationDialog.success(i18nService.translate('ALERTS.POINTS_CORRECTED', {count: data}));
                } else {
                    NotificationDialog.info(i18nService.translate('ALERTS.CAMPAIGN_NO_ISSUES'));
                }
            });
        }

        const getCampaignMatadata = () => {
            $scope.showloading = true;
            requester._get(`dashboard/points-inspection`, function (data) {
                $scope.showloading = false;
                $rootScope.campaignFinished = data.pointsInspection === 0 && data.pointsNoComplet === 0;
            });

        }
        $window.addEventListener("keydown", (event) => {
                if (event.key !== undefined) {
                    if (event.key === 'F10') {
                        correctCampain()
                        event.preventDefault();
                    }
                }
            }, true);

        $scope.downloadCSVBorda = function() {
            window.open('service/campaign/csv-borda', '_blank')
        };
        $scope.removeInspections = () => {
            NotificationDialog.confirm(i18nService.translate('ALERTS.CONFIRM_REMOVE_INSPECTIONS', {pointId: $scope.point._id})).then(function(confirmed) {
                if (confirmed) {
                    requester._get(`campaign/removeInspections?pointId=${$scope.point._id}`, function (data) {
                        if(data) {
                            NotificationDialog.success(i18nService.translate('ALERTS.INSPECTIONS_REMOVED', {pointId: $scope.point._id}));
                            $scope.submit($scope.point.index);
                        }
                    });
                }
            });
        };

        // requester._get('mapbiomas/capabilities', function(mosaics) {
        //     if (mosaics && mosaics.length > 0) {
        //         $scope.planetMosaics = mosaics.map(mosaic => ({
        //             name: mosaic.name,
        //             firstAcquired: moment(mosaic.date).toDate(),
        //             lastAcquired: moment(mosaic.date).toDate(),
        //         }));
        //     }
        // });


        // $scope.hasPlanetMosaicForYear = function(year) {
        //     return $scope.planetMosaics.some(mosaic => {
        //         const firstYear = mosaic.firstAcquired.getFullYear();
        //         const lastYear = mosaic.lastAcquired.getFullYear();
        //         return year >= firstYear && year <= lastYear;
        //     });
        // };

        $scope.hasMosaicForYear = function (year) {
            // garante que o ano é number e evita erro se a lista ainda não chegou
            const y = Number(year);
            if (!Array.isArray($scope.sentinelMosaics)) {
                return false;
            }
            return $scope.sentinelMosaics.some(m =>
                Array.isArray(m.years) && m.years.includes(y)
            );
        };


        // Carregar capabilities unificado (Sentinel + Landsat)
        requester._get('capabilities', function(capabilities) {
            $scope.tilesCapabilities = capabilities || [];
            
            if (Array.isArray(capabilities)) {
                // Processar capabilities do Sentinel
                $scope.sentinelMosaics = capabilities
                    .filter(c => c.satellite === 'sentinel')
                    .map(c => ({
                        name: c.name,
                        display_name: c.display_name,
                        years: c.year,          // [2017 … 2025]
                        periods: c.period,      // ["WET","DRY","MONTH"]
                        visparams: c.visparam,  // ["tvi-green", …]
                        visparam_details: c.visparam_details // detalhes completos dos visparams
                    }));
                
                // Processar capabilities do Landsat
                const landsatCap = capabilities.find(c => c.satellite === 'landsat');
                if (landsatCap) {
                    $scope.landsatCapabilities = [landsatCap];
                    $scope.landsatVisparams = landsatCap.visparam || [];
                    $scope.landsatVisparamDetails = landsatCap.visparam_details || [];
                }
                
                // Processar capabilities do Sentinel
                const sentinelCap = capabilities.find(c => c.satellite === 'sentinel');
                if (sentinelCap) {
                    $scope.sentinelCapabilities = [sentinelCap];
                    $scope.sentinelVisparams = sentinelCap.visparam || [];
                    $scope.sentinelVisparamDetails = sentinelCap.visparam_details || [];
                }
                
                // Atualizar visparams disponíveis quando capabilities carregarem
                $scope.updateAvailableVisParams();
            } else {
                $scope.sentinelMosaics = [];
                $scope.landsatCapabilities = [];
                $scope.landsatVisparams = [];
                $scope.landsatVisparamDetails = [];
            }
        });

        // Função para verificar se deve mostrar uma propriedade
        $scope.shouldShowProperty = function(key) {
            return $scope.defaultProperties.indexOf(key.toLowerCase()) === -1;
        };
        
        // Função para formatar o nome da propriedade
        $scope.formatPropertyName = function(key) {
            // Capitalizar primeira letra e substituir underscores por espaços
            return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
        };
        
        // Função para verificar se existem propriedades customizadas
        $scope.hasCustomProperties = function() {
            if (!$scope.point || !$scope.point.properties) {
                return false;
            }
            
            // Verificar se existe alguma propriedade que não está na lista de defaultProperties
            for (var key in $scope.point.properties) {
                if ($scope.shouldShowProperty(key)) {
                    return true;
                }
            }
            return false;
        };
        
        $scope.openMosaicDialog = function(map, point, config) {
            // ano do “thumbnail” que o usuário clicou
            const mapYear = map.year || Number(new Date(map.date).getFullYear());

            // Sentinel-2 harmonizado cobre o ano?
            const mosaicsForYear = $scope.sentinelMosaics.filter(m =>
                Array.isArray(m.years) && m.years.includes(mapYear)
            );

            $uibModal.open({
                controller: 'MosaicDialogController',
                templateUrl: 'views/mosaic-dialog.tpl.html',
                windowClass: 'modal-80-percent',
                size: 'lg',
                resolve: {
                    mosaics: function() {
                        return mosaicsForYear;
                    },
                    map: function() {
                        return map;
                    },
                    point: function() {
                        return point;
                    },
                    config: function() {
                        return config;
                    },
                    tilesCapabilities: function() {
                        return $scope.tilesCapabilities;
                    },
                    period: function() {
                        return $scope.period;
                    }
                }
            });
        };
    });
});
