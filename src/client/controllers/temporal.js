'uses trict';

Application.controller('temporalController', function ($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util, $uibModal, i18nService, $timeout, NotificationDialog) {

    $scope.pointLoaded = false;
    $scope.showChartsLandsat = false;
    $scope.showChartsLandsatNdwi = false;
    $scope.showChartsModisNdwi = false;
    $scope.planetMosaics = [];
    $scope.sentinelMosaics   = [];
    
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
    
    // Variáveis para visparams da campanha
    $scope.campaignSentinelVisParams = [];
    $scope.defaultCampaignSentinelVisParam = null;
    
    // Lista de propriedades padrão que não devem ser mostradas nas propriedades customizadas
    $scope.defaultProperties = ['biome', 'uf', 'county', 'countyCode', 'lat', 'lon', 'longitude', 'latitude'];
    
    // Função para atualizar o visparam do Landsat e propagar para todos os mapas
    $scope.updateLandsatVisparam = function() {
        localStorage.setItem('landsatVisparam', $scope.landsatVisparam);
        // Atualizar o default da campanha na memória
        if ($scope.config) {
            $scope.config.defaultVisParam = $scope.landsatVisparam;
        }
        // Broadcast para todas as diretivas landsat-map atualizarem
        $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
    };
    
    // Função para atualizar o visparam do Sentinel e propagar para todos os mapas
    $scope.updateSentinelVisparam = function() {
        localStorage.setItem('sentinelVisparam', $scope.sentinelVisparam);
        // Atualizar o default da campanha na memória
        if ($scope.config) {
            $scope.config.defaultVisParam = $scope.sentinelVisparam;
        }
        // Broadcast para todas as diretivas sentinel-map atualizarem
        $scope.$broadcast('sentinelVisparamChanged', $scope.sentinelVisparam);
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
            return [];
        }
        
        // Se temos detalhes dos visparams, retornar com display names
        if ($scope.sentinelVisparamDetails && $scope.sentinelVisparamDetails.length > 0) {
            return $scope.sentinelVisparamDetails.filter(function(vp) {
                return $scope.campaignSentinelVisParams.includes(vp.name);
            });
        }
        
        // Fallback: criar objetos básicos com nomes amigáveis
        return $scope.campaignSentinelVisParams.map(function(vp) {
            // Mapeamento manual dos nomes conhecidos
            var displayNames = {
                'tvi-green': 'TVI Green',
                'tvi-red': 'TVI Red',
                'rgb': 'Cor Natural',
                'false-color': 'Falsa Cor'
            };
            
            return {
                name: vp,
                display_name: displayNames[vp] || vp
            };
        });
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

    util.waitUserData(function () {
        $scope.size = 3;
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
        $scope.isDisabled = true;

        $scope.isObjectEmpty = function (obj) {

            keyCounts = 0;
            for (key in obj) {
                keyCounts += 1;
            }

            return keyCounts === 0;
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
                    landUse: $scope.config.landUse[1],
                    pixelBorder: false
                }
            )
        }

        $scope.formSubtraction = function () {
            if ($scope.answers.length >= 1) {
                $scope.answers.splice(-1, 1);
                $scope.optionYears.splice(-1, 1);
            }
        }

        // ---------------------------------------------------------------
        // TKT-000011: registro de dúvidas pelo intérprete
        // ---------------------------------------------------------------
        $scope.pointDoubt = null;

        // Abre o modal de registro de dúvida. Envia ao backend via
        // POST /service/points/:id/doubt e, em caso de sucesso, atualiza
        // `pointDoubt` para exibir o badge "Dúvida registrada".
        $scope.openDoubtModal = function () {
            if (!$scope.point || !$scope.point._id) {
                return;
            }

            var years = [];
            if ($scope.config && $scope.config.initialYear && $scope.config.finalYear) {
                for (var y = $scope.config.initialYear; y <= $scope.config.finalYear; y++) {
                    years.push(y);
                }
            }

            var modalInstance = $uibModal.open({
                templateUrl: 'views/doubt-register-modal.tpl.html',
                controller: 'DoubtRegisterModalController',
                size: 'md',
                backdrop: 'static',
                resolve: {
                    pointId: function () { return $scope.point._id; },
                    campaignId: function () {
                        return $rootScope.user && $rootScope.user.campaign ? $rootScope.user.campaign._id : null;
                    },
                    years: function () { return years; }
                }
            });

            modalInstance.result.then(function (result) {
                if (result && result.doubt) {
                    $scope.pointDoubt = result.doubt;
                    NotificationDialog.success('Dúvida registrada com sucesso.');
                }
            }, function () { /* dismiss: nada a fazer */ });
        };

        $scope.submitForm = function () {
            // Validar se todos os períodos têm uma classe de uso da terra selecionada
            var hasInvalidAnswer = false;
            for (var i = 0; i < $scope.answers.length; i++) {
                if (!$scope.answers[i].landUse || $scope.answers[i].landUse === '') {
                    hasInvalidAnswer = true;
                    break;
                }
            }
            
            if (hasInvalidAnswer) {
                NotificationDialog.error(i18nService.translate('TEMPORAL.FORM.VALIDATION_ERROR'));
                return;
            }
            
            var formPoint = {
                _id: $scope.point._id,
                inspection: {
                    counter: $scope.counter,
                    form: $scope.answers
                }
            }

            $scope.onSubmission = true;
            $scope.showloading = true;

            requester._post('points/update-point', {"point": formPoint}, function (data) {
                if (data.success) {
                    requester._get('points/next-point', loadPoint);
                } else {
                    $scope.showloading = false;
                    $scope.onSubmission = false;
                }
            });
        }

        $scope.changePeriod = function () {
            var newPeriod = $scope.period === 'DRY' ? 'WET' : 'DRY';
            var scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

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

        const generateOptionYears = function (initialYear, finalYear) {
            var options = [];
            for (var year = initialYear; year <= finalYear; year++) {
                options.push(year);
            }
            $scope.optionYears.push(options);
        }

        const getDateImages = function () {
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

                    Plotly.newPlot(gd, data, layout, {displayModeBar: false, scrollZoom: false});

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

                        Plotly.newPlot(gd, filteredData, layout, { displayModeBar: false, scrollZoom: false });
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

                    Plotly.newPlot(gd, data, layout, { displayModeBar: false, scrollZoom: false });
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

                    Plotly.newPlot(gd, data, layout, { displayModeBar: false, scrollZoom: false });

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                } else {
                    $scope.showChartsModisNdwi = false;
                }
            });
        };

        // Função helper para determinar o sensor Landsat baseado no ano usando collections
        const getLandsatSensor = function(year) {
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
            const collections = $scope.landsatCapabilities[0].collections;
            for (const collectionId in collections) {
                const collection = collections[collectionId];
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

        const generateMaps = function () {
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
                    date = image.datetime
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

        const initCounter = function () {
            $scope.counter = 0;
            $interval(function () {
                $scope.counter = $scope.counter + 1;
            }, 1000);
        }

        const initFormViewVariables = function () {
            $scope.optionYears = [];

            $scope.answers = [
                {
                    initialYear: $scope.config.initialYear,
                    finalYear: $scope.config.finalYear,
                    landUse: '', // Inicializar vazio para forçar seleção
                    pixelBorder: false
                }
            ];
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
                    
                    // Processar visparams configurados para a campanha
                    if (config.visParams && config.visParams.length > 0) {
                        if ($scope.isSentinel) {
                            // Se for Sentinel, carregar visparams do Sentinel
                            $scope.campaignSentinelVisParams = config.visParams;
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
                            $scope.updateVisParamsCache(); // Atualizar cache
                            
                            // Usar defaultVisParam se configurado, senão usar o primeiro da lista
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

        const loadPoint = function (data) {
            Plotly.purge('LANDSAT');
            Plotly.purge('NDVI');
            $scope.showloading = false;
            $scope.onSubmission = false;
            $scope.pointLoaded = true;
            $scope.point = data.point;
            $rootScope.total = data.total;
            $rootScope.count = data.count;
            $rootScope.current = data.current;
            $scope.datesFromService = data.point.dates;
            // TKT-000011: resetar estado de dúvida ao carregar novo ponto.
            // O backend envia a subestrutura `doubt` dentro do próprio point
            // quando existente; exibimos o badge somente para dúvidas ABERTAs.
            $scope.pointDoubt = (data.point && data.point.doubt) ? data.point.doubt : null;

            initFormViewVariables();
            generateOptionYears($scope.config.initialYear, $scope.config.finalYear);

            // Gerar mapas somente após config da campanha estar disponível
            loadCampaignConfig(function() {
                generateMaps();
            });

            // Os gráficos agora só serão carregados quando o usuário clicar no botão
            // Resetar a flag sempre que carregar um novo ponto
            $scope.showTimeseriesCharts = false;

            $scope.counter = 0;

        }

        initCounter();
        
        $scope.showloading = true;
        requester._get('points/next-point', loadPoint);

        // requester._get('mapbiomas/capabilities',function(mosaics) {
        //     if (mosaics && mosaics.length > 0) {
        //         $scope.planetMosaics = mosaics.map(mosaic => ({
        //             name: mosaic.name,
        //             firstAcquired: moment(mosaic.date).toDate(),
        //             lastAcquired: moment(mosaic.date).toDate(),
        //         }));
        //     }
        // });
        //
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
                
                // Atualizar visparams disponíveis após carregar os detalhes
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
                if (isNaN(date.getTime())) {
                    // Se não conseguir converter para data, extrair o ano da string
                    var parts = dateString.split('/');
                    if (parts.length === 3) {
                        return parts[2]; // Retorna apenas o ano
                    }
                    return dateString;
                }
                
                var day = String(date.getDate()).padStart(2, '0');
                var month = String(date.getMonth() + 1).padStart(2, '0');
                var year = date.getFullYear();
                
                return `${day}/${month}/${year}`;
            } catch (e) {
                return dateString;
            }
        };
        
        $scope.openMosaicDialog = function(map, point, config) {
            // const mosaicsForYear = $scope.planetMosaics.filter(mosaic => {
            //     const firstYear = new Date(mosaic.firstAcquired).getFullYear();
            //     const lastYear = new Date(mosaic.lastAcquired).getFullYear();
            //     const mapYear = new Date(map.date).getFullYear();
            //     return mapYear >= firstYear && mapYear <= lastYear;
            // });

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

// ---------------------------------------------------------------------
// TKT-000011: controller do modal de registro de dúvida pelo intérprete.
// Mantido neste arquivo (co-localizado com temporalController) para
// reduzir acoplamento cross-file e facilitar manutenção conjunta.
// ---------------------------------------------------------------------
Application.controller('DoubtRegisterModalController', function ($scope, $uibModalInstance, $http, pointId, campaignId, years) {
    $scope.pointId = pointId;
    $scope.campaignId = campaignId;
    $scope.years = years || [];
    $scope.form = { text: '', year: '' };
    $scope.submitting = false;
    $scope.errorMessage = null;

    $scope.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };

    $scope.submit = function () {
        $scope.errorMessage = null;
        var text = ($scope.form.text || '').trim();
        if (text.length < 5) {
            $scope.errorMessage = 'Descreva a dúvida com pelo menos 5 caracteres.';
            return;
        }
        if (text.length > 2000) {
            $scope.errorMessage = 'Texto excede o limite de 2000 caracteres.';
            return;
        }

        var payload = { text: text };
        if ($scope.form.year) {
            payload.year = parseInt($scope.form.year, 10);
        }

        $scope.submitting = true;
        $http.post('/service/points/' + encodeURIComponent(pointId) + '/doubt', payload)
            .then(function (response) {
                $scope.submitting = false;
                $uibModalInstance.close(response.data);
            }, function (error) {
                $scope.submitting = false;
                var msg = 'Não foi possível registrar a dúvida.';
                if (error && error.data && error.data.error) {
                    msg = error.data.error;
                }
                $scope.errorMessage = msg;
            });
    };
});
