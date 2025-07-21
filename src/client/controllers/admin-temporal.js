'use strict';

Application.controller('adminTemporalController', function ($rootScope, $scope, $location, $interval, $window, requester, fakeRequester, util, $uibModal, $timeout, i18nService, mapLoadingService, NotificationDialog, $routeParams, $http, $injector) {
    $scope.showCharts = false;
    $scope.showChartsLandsat = false;
    $scope.showChartsNDDI = false;
    $scope.showCorrectCampaign = false;
    $scope.showloading = true;
    $scope.planetMosaics = [];
    $scope.sentinelMosaics = [];
    $scope.landsatMosaics = [];
    $scope.tilesCapabilities = [];
    
    // Estados para lazy loading
    $scope.mapStates = {};
    
    // Valores padrão para as configurações de visualização
    $scope.showTimeseries = true;
    $scope.showPointInfo = true;
    $scope.useDynamicMaps = false;
    
    // Inicializar visparam do Landsat
    $scope.landsatVisparam = localStorage.getItem('landsatVisparam') || 'landsat-tvi-false';
    
    // Inicializar visparam e período do Sentinel
    $scope.sentinelVisparam = localStorage.getItem('sentinelVisparam') || 'default';
    $scope.sentinelPeriod = localStorage.getItem('sentinelPeriod') || 'DRY';
    
    // Lista de propriedades padrão que não devem ser mostradas nas propriedades customizadas
    $scope.defaultProperties = ['biome', 'uf', 'county', 'countyCode', 'lat', 'lon', 'longitude', 'latitude'];
    
    // Configuração dos accordions
    $scope.accordions = {
        navigation: true,  // Navegação aberta por padrão
        info: true,        // Informações abertas por padrão
        maps: true,        // Mapas abertos por padrão
        timeseries: false  // Timeseries fechado por padrão
    };
    
    // Função para toggle dos accordions
    $scope.toggleAccordion = function(section) {
        $scope.accordions[section] = !$scope.accordions[section];
    };
    
    // Função para atualizar o visparam do Landsat e propagar para todos os mapas
    $scope.updateLandsatVisparam = function() {
        localStorage.setItem('landsatVisparam', $scope.landsatVisparam);
        $scope.$broadcast('landsatVisparamChanged', $scope.landsatVisparam);
    };
    
    // Função para obter visparams disponíveis da campanha
    $scope.getAvailableVisParams = function() {
        if (!$scope.campaignVisParams || $scope.campaignVisParams.length === 0) {
            return [];
        }
        
        // Se temos detalhes dos visparams, retornar com display names
        if ($scope.landsatVisparamDetails && $scope.landsatVisparamDetails.length > 0) {
            return $scope.landsatVisparamDetails.filter(function(vp) {
                return $scope.campaignVisParams.includes(vp.name);
            });
        }
        
        // Fallback: criar objetos básicos se não temos os detalhes ainda
        return $scope.campaignVisParams.map(function(vp) {
            return {
                name: vp,
                display_name: vp // Usar o próprio nome como display temporariamente
            };
        });
    };
    
    // Funções para atualizar parâmetros do Sentinel
    $scope.updateSentinelVisparam = function() {
        localStorage.setItem('sentinelVisparam', $scope.sentinelVisparam);
        generateMaps(); // Regenerar mapas com novo visparam
    };
    
    $scope.updateSentinelPeriod = function() {
        localStorage.setItem('sentinelPeriod', $scope.sentinelPeriod);
        $scope.period = $scope.sentinelPeriod; // Sincronizar com o período global
        generateMaps(); // Regenerar mapas com novo período
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

    $rootScope.campaignFinished = false;
    
    // Carregar campanha do ponto ou usar campanha padrão
    var loadCampaignAndInit = function() {
        // Obter ID da campanha a partir do URL ou usar padrão
        var urlParams = $location.search();
        var campaignId = urlParams.campaignId || localStorage.getItem('currentCampaignId');
        
        if (!campaignId) {
            // Se não tiver campanha, tentar buscar do ponto
            if (urlParams.pointId) {
                $http.get('/service/admin/points/' + urlParams.pointId).then(function(response) {
                    if (response.data && response.data.campaign) {
                        campaignId = response.data.campaign;
                        initializeWithCampaign(campaignId);
                    } else {
                        NotificationDialog.error('Não foi possível identificar a campanha');
                        $scope.showloading = false;
                    }
                }).catch(function(error) {
                    NotificationDialog.error('Erro ao carregar informações do ponto');
                    $scope.showloading = false;
                });
            } else {
                NotificationDialog.error('Campanha não especificada');
                $scope.showloading = false;
            }
        } else {
            initializeWithCampaign(campaignId);
        }
    };
    
    var initializeWithCampaign = function(campaignId) {
        // Buscar dados da campanha
        $http.get('/api/campaigns/' + campaignId).then(function(response) {
            var campaign = response.data;
            
            // Simular estrutura do user para compatibilidade
            $rootScope.user = {
                campaign: campaign
            };
            
            // Definir campaign no scope para uso nas funções
            $scope.campaign = campaign;
            
            $scope.showloading = false;
            $scope.size = 4;
            $scope.onSubmission = false;
            $scope.period = 'DRY';
            $scope.periodo = i18nService.translate('PERIODS.DRY');
            $scope.pointEnabled = true;
            $scope.config = {
                initialYear: campaign.initialYear,
                finalYear: campaign.finalYear,
                zoomLevel: 13,
                landUse: campaign.landUse
            };

            $scope.isChaco = (campaign._id.indexOf('chaco') != -1);
            $scope.isRaisg = (campaign._id.indexOf('samples') != -1 || campaign._id.indexOf('raisg') != -1);
            
            // Detectar tipo de imagem baseado na campanha
            if (campaign.imageType) {
                $scope.isSentinel = campaign.imageType === 'sentinel-2-l2a' || 
                                   campaign.imageType === 'sentinel-2' || 
                                   (campaign.imageType && campaign.imageType.toLowerCase().includes('sentinel'));
            } else {
                // Fallback para detecção legacy
                $scope.isSentinel = campaign.hasOwnProperty('image') && campaign['image'] === 'sentinel-2-l2a';
            }
            
            // Aplicar configurações da campanha como no supervisor
            $scope.showTimeseries = campaign.showTimeseries !== undefined ? campaign.showTimeseries : true;
            $scope.showPointInfo = campaign.showPointInfo !== undefined ? campaign.showPointInfo : true;
            $scope.useDynamicMaps = campaign.useDynamicMaps !== undefined ? campaign.useDynamicMaps : false;
            $scope.hasVisParam = campaign.visParam !== null && campaign.visParam !== undefined;
            
            // Processar visparams configurados para a campanha
            if (campaign.visParams && campaign.visParams.length > 0) {
                $scope.campaignVisParams = campaign.visParams;
                $scope.availableVisParams = campaign.visParams;
                
                // Usar defaultVisParam se configurado, senão usar o primeiro da lista
                if (campaign.defaultVisParam && campaign.visParams.includes(campaign.defaultVisParam)) {
                    $scope.landsatVisparam = campaign.defaultVisParam;
                } else if (campaign.visParams.length > 0) {
                    $scope.landsatVisparam = campaign.visParams[0];
                }
                
                localStorage.setItem('landsatVisparam', $scope.landsatVisparam);
            } else if (campaign.visParam) {
                // Compatibilidade com campo antigo visParam
                $scope.landsatVisparam = campaign.visParam;
                $scope.campaignVisParams = [campaign.visParam];
                $scope.availableVisParams = [campaign.visParam];
                localStorage.setItem('landsatVisparam', campaign.visParam);
            }
            
            // Inicializar o resto após carregar a campanha
            initializeController();
        }).catch(function(error) {
            NotificationDialog.error('Erro ao carregar dados da campanha');
            $scope.showloading = false;
        });
    };
    
    // Função para sincronizar filtros com a URL
    var syncFiltersWithUrl = function() {
        var urlParams = $location.search();
        
        // Sincronizar index
        if (urlParams.index) {
            $scope.currentIndex = parseInt(urlParams.index);
        }
        
        // Sincronizar filtros
        if (urlParams.landUse) {
            $scope.selectedLandUse = decodeURIComponent(urlParams.landUse);
        }
        
        if (urlParams.userName) {
            $scope.selectUserNames = decodeURIComponent(urlParams.userName);
        }
        
        if (urlParams.biome) {
            $scope.selectBiomes = decodeURIComponent(urlParams.biome);
        }
        
        if (urlParams.uf) {
            $scope.selectUf = decodeURIComponent(urlParams.uf);
        }
        
        if (urlParams.typeSort) {
            $scope.typeSort = urlParams.typeSort;
        }
    };
    
    // Função para atualizar a URL com os filtros atuais
    var updateUrlWithFilters = function(filter) {
        var params = {};
        
        // Sempre incluir campaignId
        if ($scope.campaign && $scope.campaign._id) {
            params.campaignId = $scope.campaign._id;
        }
        
        // Incluir index
        if (filter.index) {
            params.index = filter.index;
        }
        
        var allText = i18nService.translate('COMMON.ALL');
        
        // Incluir filtros apenas se não forem "ALL"
        if (filter.landUse && filter.landUse !== allText) {
            params.landUse = encodeURIComponent(filter.landUse);
        }
        
        if (filter.userName && filter.userName !== allText) {
            params.userName = encodeURIComponent(filter.userName);
        }
        
        if (filter.biome && filter.biome !== allText) {
            params.biome = encodeURIComponent(filter.biome);
        }
        
        if (filter.uf && filter.uf !== allText) {
            params.uf = encodeURIComponent(filter.uf);
        }
        
        if (filter.timeInspection) {
            params.typeSort = 'timeInspection';
        } else if (filter.agreementPoint) {
            params.typeSort = 'agreementPoint';
        }
        
        // Atualizar URL sem recarregar a página
        $location.search(params);
    };

    var initializeController = function() {
        // Sincronizar filtros com a URL
        syncFiltersWithUrl();

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
        };

        $scope.formPlus = function () {
            var prevIndex = $scope.answers.length - 1;
            var initialYear = $scope.answers[prevIndex].finalYear + 1;

            if ($scope.answers[prevIndex].finalYear == $scope.config.finalYear)
                return;

            var finalYear = $scope.config.finalYear;
            generateOptionYears(initialYear, finalYear);

            $scope.answers.push({
                initialYear: initialYear,
                finalYear: finalYear,
                landUse: $scope.config.landUse[1]
            });
        };

        $scope.formSubtraction = function () {
            if ($scope.answers.length >= 1) {
                $scope.answers.splice(-1, 1);
                $scope.optionYears.splice(-1, 1);
            }
        };

        $scope.submitForm = function () {
            var formPoint = {
                _id: $scope.point._id,
                inspection: {
                    counter: $scope.counter,
                    form: $scope.answers
                }
            };

            $scope.onSubmission = true;
            requester._post('admin/points/next-point', {"point": formPoint, "campaignId": $scope.campaign._id}, loadPoint);
        };

        $scope.changePeriod = function () {
            if ($scope.newValue == undefined)
                $scope.newValue = true;

            $scope.newValue = !$scope.newValue;
            $scope.period = ($scope.period == 'DRY') ? 'WET' : 'DRY';
            $scope.periodo = ($scope.period == 'DRY') ? i18nService.translate('PERIODS.WET') : i18nService.translate('PERIODS.DRY');
            generateMaps();
        };

        var generateOptionYears = function (initialYear, finalYear) {
            var options = [];
            for (var year = initialYear; year <= finalYear; year++) {
                options.push(year);
            }
            $scope.optionYears.push(options);
        };

        var getDateImages = function () {
            var date = [];
            for (var i = 0; i < $scope.maps.length; i++) {
                date.push(new Date($scope.maps[i].date));
            }
            return date;
        };

        var trace2NDVI = function (values, date) {
            var ndvi = [];
            for (var i = 0; i < date.length; i++) {
                for (var j = 0; j < values.length; j = j + 2) {
                    var dateFromValues = new Date(values[j][0]);
                    var dateFromDate = new Date(date[i]);

                    if (((dateFromDate.getUTCMonth() + 1) == (dateFromValues.getUTCMonth() + 1)) && (dateFromDate.getUTCFullYear() == dateFromValues.getUTCFullYear())) {
                        ndvi.push(values[j][1]);
                    }
                }
            }
            return ndvi;
        };

        var getPrecipitationData = function (callback) {
            requester._get('admin/spatial/precipitation', {
                "longitude": $scope.point.lon,
                "latitude": $scope.point.lat
            }, function (data) {
                var precipit = [];
                var date = [];
                var text = [];

                for (var i = 0; i < data.values.length; i++) {
                    precipit.push(data.values[i][1]);
                    date.push(new Date(data.values[i][0]));
                    var dateObj = new Date(data.values[i][0]);
                    var month = dateObj.getUTCMonth() + 1;
                    var day = dateObj.getUTCDate();
                    var year = dateObj.getUTCFullYear();
                    text.push(day + "/" + month + "/" + year);
                }

                var result = {
                    "precipit": precipit,
                    "date": date,
                    "text": text
                };

                callback(result);
            });
        };

        var getDryDate = function (dates, tmsIdList) {
            var dry = [];
            for (var key in dates) {
                for (var i = 0; i < tmsIdList.length; i++) {
                    if (key == tmsIdList[i]) {
                        var year = parseInt(dates[key].split('-')[0]);
                        if (year >= 2000) {
                            dry.push(dates[key]);
                        }
                    }
                }
            }
            return dry.sort();
        };

        var createModisChart = function (datesFromService) {
            Plotly.purge('NDVI');
            requester._get('admin/time-series/MOD13Q1_NDVI', {
                "longitude": $scope.point.lon,
                "latitude": $scope.point.lat
            }, function (data) {
                if(data){
                    getPrecipitationData(function (dataPrecip) {
                        var ndvi = [];
                        var ndviSg = [];
                        var date = [];
                        var text = [];
                        $scope.showCharts = data.values.length > 0;

                        for (var i = 0; i < data.values.length; i++) {
                            var dateObj = new Date(data.values[i][0]);
                            var month = dateObj.getUTCMonth() + 1;
                            var day = dateObj.getUTCDate();
                            var year = dateObj.getUTCFullYear();
                            ndvi.push(data.values[i][1]);
                            ndviSg.push(data.values[i][3]);
                            date.push(data.values[i][0]);
                            text.push(day + "/" + month + "/" + year);
                        }

                        var dry = getDryDate(datesFromService, $scope.tmsIdListDry);
                        var wet = getDryDate(datesFromService, $scope.tmsIdListWet);

                        var d3 = Plotly.d3;
                        var gd3 = d3.select('#NDVI');
                        var gd = gd3.node();

                        var trace1 = {
                            x: date,
                            y: ndvi,
                            text: date,
                            name: "NDVI",
                            hoverinfo: "text+y",
                            line: {
                                width: 1.5,
                                color: '#f6b2b2'
                            }
                        };

                        var trace2 = {
                            x: date,
                            y: ndviSg,
                            text: date,
                            name: "NDVI (savGol)",
                            hoverinfo: "none",
                            line: {
                                width: 1,
                                color: '#db2828'
                            }
                        };

                        var trace3 = {
                            x: dry,
                            y: trace2NDVI(data.values, dry),
                            text: dry,
                            name: 'Landsat (' + i18nService.translate('PERIODS.DRY') + ')',
                            hoverinfo: "none",
                            mode: 'markers',
                            marker: {
                                size: 6,
                                color: '#818181'
                            }
                        };

                        var trace4 = {
                            x: wet,
                            y: trace2NDVI(data.values, wet),
                            text: wet,
                            name: 'Landsat (' + i18nService.translate('PERIODS.WET') + ')',
                            hoverinfo: "none",
                            mode: 'markers',
                            marker: {
                                color: '#323232',
                                size: 6
                            }
                        };

                        var initDate = date.length > 0 ? date[0].split("-") : ["1985", "01", "01"];
                        var initPrec = 0;
                        var precData = [];
                        var precValue = [];
                        var precText = [];

                        for (var i = 0; i < dataPrecip.text.length; i++) {
                            dataPrecip.text[i] = dataPrecip.text[i].split("/");
                            dataPrecip.text[i] = dataPrecip.text[i].reverse();
                            dataPrecip.text[i] = dataPrecip.text[i].toString();
                            dataPrecip.text[i] = dataPrecip.text[i].replace(',', '-');
                            dataPrecip.text[i] = dataPrecip.text[i].replace(',', '-');
                        }

                        var count = 0;
                        for (var i = 0; i < dataPrecip.text.length; i++) {
                            initPrec = dataPrecip.text[i].split("-");

                            if (initPrec[0] >= initDate[0]) {
                                precData[count] = dataPrecip.text[i];
                                precValue[count] = dataPrecip.precipit[i];
                                var temp = dataPrecip.text[i].split("-");
                                precText[count] = temp[0] + '-' + temp[1];
                                count++;
                            }
                        }

                        var trace5 = {
                            x: precData,
                            y: precValue,
                            text: precText,
                            name: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION'),
                            hoverinfo: 'text+y',
                            opacity: 0.5,
                            mode: 'markers',
                            marker: {
                                size: 6,
                                color: '#0000ff',
                                line: {
                                    width: 0.1
                                }
                            },
                            yaxis: 'y5',
                            type: 'bar'
                        };

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
                                fixedrange: true,
                                rangemode: "nonnegative"
                            },
                            yaxis5: {
                                title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION'),
                                fixedrange: true,
                                overlaying: 'y',
                                side: 'right'
                            }
                        };

                        var dataChart = [trace1, trace2, trace3, trace4, trace5];
                        Plotly.newPlot(gd, dataChart, layout, {displayModeBar: false});

                        window.onresize = function () {
                            Plotly.Plots.resize(gd);
                        };
                    });
                }
            });
        };

        var createLandsatChart = function () {
            Plotly.purge('LANDSAT');

            requester._get(`admin/timeseries/landsat/ndvi`, {
                "lon": $scope.point.lon,
                "lat": $scope.point.lat
            }, function (data) {
                if (data && data.length > 0) {
                    $scope.showChartsLandsat = true;
                    let d3 = Plotly.d3;
                    let gd3 = d3.select('#LANDSAT');
                    let gd = gd3.node();

                    let trace1 = {
                        x: data[0].x,
                        y: data[0].y,
                        type: "scatter",
                        mode: "lines",
                        name: "NDVI (Savgol)",
                        line: {
                            color: "rgb(50, 168, 82)"
                        }
                    };

                    let trace2 = {
                        x: data[1].x,
                        y: data[1].y,
                        type: "scatter",
                        mode: "markers",
                        name: "NDVI (Original)",
                        marker: {
                            color: "rgba(50, 168, 82, 0.3)"
                        }
                    };

                    let trace3 = {
                        x: data[2].x,
                        y: data[2].y,
                        type: "bar",
                        name: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION'),
                        marker: {
                            color: "blue"
                        },
                        yaxis: "y2"
                    };

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
                            fixedrange: true,
                            rangemode: "nonnegative"
                        },
                        yaxis2: {
                            title: i18nService.translate('TEMPORAL.CHARTS.PRECIPITATION') + ' (mm)',
                            overlaying: "y",
                            side: "right",
                            fixedrange: true
                        }
                    };

                    let dataChart = [trace1, trace2, trace3];
                    Plotly.newPlot(gd, dataChart, layout, { displayModeBar: false });
                    Plotly.Plots.resize(gd);

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                }
            });
        };

        var createNDDIChart = function () {
            Plotly.purge('NDDI');

            $http.get('/service/admin/timeseries/nddi', {
                params: {
                    "lon": $scope.point.lon,
                    "lat": $scope.point.lat
                }
            }).then(function (response) {
                var data = response.data;
                if (data && data.length > 0) {
                    $scope.showChartsNDDI = true;
                    let d3 = Plotly.d3;
                    let gd3 = d3.select('#NDDI');
                    let gd = gd3.node();

                    let trace = {
                        x: data[0].x,
                        y: data[0].y,
                        type: "scatter",
                        mode: "lines",
                        name: "NDDI (MapBiomas Mosaics)",
                        line: {
                            color: "rgb(0, 168, 82)"
                        }
                    };

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
                        }
                    };

                    let dataChart = [trace];
                    Plotly.newPlot(gd, dataChart, layout, { displayModeBar: false });
                    Plotly.Plots.resize(gd);

                    window.onresize = function () {
                        Plotly.Plots.resize(gd);
                    };
                }
            });
        };

        var generateMaps = function () {
            $scope.maps = [];
            $scope.mapStates = {};
            mapLoadingService.reset();
            
            if ($scope.isSentinel) {
                generateSentinelMaps();
            } else {
                generateLandsatMaps();
            }
            
            $timeout(function() {
                const initialMapsToLoad = Math.min(3, $scope.maps.length);
                for (let i = 0; i < initialMapsToLoad; i++) {
                    if ($scope.mapStates[i] && !$scope.mapStates[i].visible) {
                        $scope.onMapVisible(i);
                    }
                }
            }, 1000);
        };
        
        var generateSentinelMaps = function() {
            if (!$scope.sentinelMosaics || $scope.sentinelMosaics.length === 0) {
                console.warn('No Sentinel capabilities loaded yet');
                return;
            }
            
            const sentinelData = $scope.sentinelMosaics[0]; // s2_harmonized collection
            if (!sentinelData || !sentinelData.years) {
                console.warn('No Sentinel years data available');
                return;
            }
            
            // Usar período atual ou padrão
            const currentPeriod = $scope.period || 'DRY';
            const currentVisparam = $scope.sentinelVisparam || (sentinelData.visparams && sentinelData.visparams[0]) || 'default';
            
            sentinelData.years.forEach(function(year, index) {
                // Construir URL para tiles Sentinel
                let tileUrl;
                if ($injector.has('AppConfig')) {
                    const AppConfig = $injector.get('AppConfig');
                    tileUrl = AppConfig.buildTileUrl('s2_harmonized', {
                        visparam: currentVisparam,
                        period: currentPeriod,
                        year: year
                    });
                } else {
                    tileUrl = `https://tm{s}.lapig.iesa.ufg.br/api/layers/s2_harmonized/{x}/{y}/{z}?visparam=${currentVisparam}&period=${currentPeriod}&year=${year}`;
                }
                
                // Data fictícia para compatibilidade com a interface
                const date = `01/07/${year}`;
                
                const mapIndex = $scope.maps.length;
                $scope.maps.push({
                    date: date,
                    year: year,
                    url: tileUrl,
                    bounds: $scope.point.bounds,
                    index: mapIndex,
                    period: currentPeriod,
                    visparam: currentVisparam
                });
                
                $scope.mapStates[mapIndex] = {
                    visible: false,
                    loading: false
                };
            });
            
            console.log(`Generated ${$scope.maps.length} Sentinel maps for period ${currentPeriod}`);
        };
        
        var generateLandsatMaps = function() {
            // Se temos capabilities do Landsat, usar dados dinâmicos
            if ($scope.landsatMosaics && $scope.landsatMosaics.length > 0) {
                generateLandsatMapsFromCapabilities();
            } else {
                // Usar código legacy existente
                generateLandsatMapsLegacy();
            }
        };
        
        var generateLandsatMapsFromCapabilities = function() {
            const currentPeriod = $scope.period || 'DRY';
            const currentVisparam = $scope.landsatVisparam || 'landsat-tvi-false';
            
            $scope.landsatMosaics.forEach(function(collection) {
                if (!collection.years || !Array.isArray(collection.years)) {
                    return;
                }
                
                collection.years.forEach(function(year) {
                    // Construir URL para tiles Landsat usando API de capabilities
                    let tileUrl;
                    if ($injector.has('AppConfig')) {
                        const AppConfig = $injector.get('AppConfig');
                        tileUrl = AppConfig.buildTileUrl(collection.name, {
                            visparam: currentVisparam,
                            period: currentPeriod,
                            year: year
                        });
                    } else {
                        tileUrl = `https://tm{s}.lapig.iesa.ufg.br/api/layers/${collection.name}/{x}/{y}/{z}?visparam=${currentVisparam}&period=${currentPeriod}&year=${year}`;
                    }
                    
                    // Data fictícia para compatibilidade com a interface
                    const date = `01/07/${year}`;
                    
                    const mapIndex = $scope.maps.length;
                    $scope.maps.push({
                        date: date,
                        year: year,
                        url: tileUrl,
                        bounds: $scope.point.bounds,
                        index: mapIndex,
                        period: currentPeriod,
                        visparam: currentVisparam,
                        collection: collection.name
                    });
                    
                    $scope.mapStates[mapIndex] = {
                        visible: false,
                        loading: false
                    };
                });
            });
            
            console.log(`Generated ${$scope.maps.length} Landsat maps from capabilities for period ${currentPeriod}`);
        };
        
        // Função helper para determinar o sensor Landsat baseado no ano usando collections
        var getLandsatSensor = function(year) {
            // Se não temos capabilities do Landsat ou collections, usar lógica padrão
            if (!$scope.landsatMosaics || !$scope.landsatMosaics[0] || !$scope.landsatMosaics[0].collections) {
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
            var collections = $scope.landsatMosaics[0].collections;
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

        var generateLandsatMapsLegacy = function() {
            var tmsIdList = [];
            $scope.tmsIdListWet = [];
            $scope.tmsIdListDry = [];

            for (var year = $scope.config.initialYear; year <= $scope.config.finalYear; year++) {
                var sattelite = getLandsatSensor(year);

                var tmsId = sattelite + '_' + year + '_' + $scope.period;
                var tmsIdDry = sattelite + '_' + year + '_DRY';
                var tmsIdWet = sattelite + '_' + year + '_WET';

                $scope.tmsIdListDry.push(tmsIdDry);
                $scope.tmsIdListWet.push(tmsIdWet);

                var host = location.host;
                var campaignId = $rootScope.user && $rootScope.user.campaign ? $rootScope.user.campaign._id : localStorage.getItem('currentCampaignId');
                var url = "http://" + host + '/image/' + tmsId + '/' + $scope.point._id + "?campaign=" + campaignId;

                let date = ($scope.point.dates[tmsId]) ? $scope.point.dates[tmsId] : '00/00/' + year;
                if($scope.point.hasOwnProperty('images')){
                    const image = $scope.point['images'].find(img => img.image_index === tmsId);
                    if (image && image.datetime) {
                        date = image.datetime;
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
                
                $scope.mapStates[mapIndex] = {
                    visible: false,
                    loading: false
                };
            }
        };
        
        $scope.onMapVisible = function(index) {
            if (!$scope.mapStates[index].visible && !mapLoadingService.isLoaded(index)) {
                $scope.mapStates[index].visible = true;
                $scope.mapStates[index].loading = true;
                mapLoadingService.startLoading(index);
                
                $timeout(function() {
                    $scope.mapStates[index].loading = false;
                    mapLoadingService.finishLoading(index);
                }, 500);
            }
        };
        
        $scope.$on('preloadMaps', function(event, indices) {
            indices.forEach(function(index) {
                if (index >= 0 && index < $scope.maps.length && 
                    !$scope.mapStates[index].visible && 
                    !mapLoadingService.isLoaded(index) &&
                    !mapLoadingService.isLoading(index)) {
                    
                    $timeout(function() {
                        $scope.onMapVisible(index);
                    }, 200);
                }
            });
        });

        $scope.getKml = function () {
            var lon = $scope.point.lon;
            var lat = $scope.point.lat;
            var county = $scope.point.county;
            var url = window.location.origin + window.location.pathname;
            $window.open(url + "service/kml?longitude=" + lon + "&latitude=" + lat + "&county=" + county);
        };

        var initCounter = function () {
            $scope.counter = 0;
            $interval(function () {
                $scope.counter = $scope.counter + 1;
            }, 1000);
        };

        var initFormViewVariables = function () {
            $scope.optionYears = [];
            $scope.answers = [{
                initialYear: $scope.config.initialYear,
                finalYear: $scope.config.finalYear,
                landUse: $scope.config.landUse[1]
            }];
        };

        $scope.submit = function (index) {
            $scope.showloading = true;
            var filter = {
                "index": index
            };

            $scope.changeClass = function (index) {
                for (var i = index; i < $scope.selectedLandUses.length; i++) {
                    $scope.selectedLandUses[i] = $scope.selectedLandUses[index];
                }
            };

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

            // Atualizar URL com os filtros atuais
            updateUrlWithFilters(filter);
            
            updatedClassConsolidated(filter);
            getClassLandUse(filter);
            landUseFilter(filter);
            usersFilter(filter);
            biomeFilter(filter);
            ufFilter(filter);

            var params = Object.assign({}, filter, { campaignId: $scope.campaign._id });
            $http.post('/service/admin/points/get-point', params).then(function(response) {
                loadPoint(response.data);
            }).catch(function(error) {
                console.error('Error loading point:', error);
                $scope.showloading = false;
            });
            $scope.showloading = false;
        };

        var updatedClassConsolidated = function (callback) {
            $scope.saveClass = function (element) {
                var result = {};
                $scope.objConsolidated = $scope.selectedLandUses;

                result._id = $scope.point._id;
                result.class = $scope.objConsolidated;

                requester._post('admin/points/updatedClassConsolidated', result, function (data) {
                    var aux = 0;
                    var flagError = true;

                    for (var i = 0; i < $scope.objConsolidated.length; i++) {
                        if ($scope.objConsolidated[i] == i18nService.translate('COMMON.NOT_CONSOLIDATED')) {
                            if (flagError)
                                NotificationDialog.error(i18nService.translate('ALERTS.FILL_ALL_FIELDS'));
                            flagError = false;
                        } else {
                            aux++;

                            if (aux == $scope.objConsolidated.length) {
                                $scope.submit(1);
                                $scope.modeEdit = false;
                                $scope.buttonEdit = false;
                            }
                        }
                    }

                    aux = 0;
                });
            };
        };

        var getClassLandUse = function (filter) {
            if (!$scope.campaign || !$scope.campaign._id) {
                console.warn('Campaign not loaded yet, skipping getClassLandUse');
                return;
            }
            $http.get('/service/admin/points/landUses', { params: { campaignId: $scope.campaign._id } }).then(function (response) {
                $scope.getLandUses = response.data;
                $scope.buttonEdit = false;

                $scope.editClass = function (element) {
                    var arrayConsolid = $scope.objConsolidated;
                    $scope.selectedLandUses = [];
                    $scope.modeEdit = true;

                    for (var i = 0; i < arrayConsolid.length; i++) {
                        $scope.selectedLandUses.push(arrayConsolid[i]);
                    }
                    $scope.buttonEdit = true;
                };
            }).catch(function(error) {
                console.error('Error loading land uses:', error);
            });
        };

        var landUseFilter = function (filter) {
            if (!$scope.campaign || !$scope.campaign._id) {
                console.warn('Campaign not loaded yet, skipping landUseFilter');
                return;
            }
            var params = Object.assign({}, filter, { campaignId: $scope.campaign._id });
            $http.get('/service/admin/points/landUses', { params: params }).then(function (response) {
                var landUses = response.data;
                landUses.unshift(i18nService.translate('COMMON.ALL'));
                landUses.push(i18nService.translate('COMMON.NOT_CONSOLIDATED'));

                if (filter.landUse == undefined)
                    filter.landUse = i18nService.translate('COMMON.ALL');

                $scope.selectedLandUse = filter.landUse;
                $scope.landUses = landUses;
            }).catch(function(error) {
                console.error('Error loading land uses:', error);
            });
        };

        var usersFilter = function (filter) {
            if (!$scope.campaign || !$scope.campaign._id) {
                console.warn('Campaign not loaded yet, skipping usersFilter');
                return;
            }
            var params = Object.assign({}, filter, { campaignId: $scope.campaign._id });
            $http.get('/service/admin/points/users', { params: params }).then(function (response) {
                var userNames = response.data;
                userNames.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.userName == undefined)
                    filter.userName = i18nService.translate('COMMON.ALL');

                $scope.selectUserNames = filter.userName;
                $scope.userNames = userNames;
            }).catch(function(error) {
                console.error('Error loading users:', error);
            });
        };

        var biomeFilter = function (filter) {
            if (!$scope.campaign || !$scope.campaign._id) {
                console.warn('Campaign not loaded yet, skipping biomeFilter');
                return;
            }
            var params = Object.assign({}, filter, { campaignId: $scope.campaign._id });
            $http.get('/service/admin/points/biome', { params: params }).then(function (response) {
                var biomes = response.data;
                biomes.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.biome == undefined)
                    filter.biome = i18nService.translate('COMMON.ALL');

                $scope.selectBiomes = filter.biome;
                $scope.biomes = biomes;
            }).catch(function(error) {
                console.error('Error loading biomes:', error);
            });
        };

        var ufFilter = function (filter) {
            if (!$scope.campaign || !$scope.campaign._id) {
                console.warn('Campaign not loaded yet, skipping ufFilter');
                return;
            }
            
            var params = Object.assign({}, filter, { campaignId: $scope.campaign._id });
            $http.get('/service/admin/points/uf', { params: params }).then(function (response) {
                var stateUF = response.data;
                stateUF.unshift(i18nService.translate('COMMON.ALL'));

                if (filter.uf == undefined)
                    filter.uf = i18nService.translate('COMMON.ALL');

                $scope.selectUf = filter.uf;
                $scope.stateUF = stateUF;
            }).catch(function(error) {
                console.error('Error loading UFs:', error);
            });
        };

        var loadCampaignConfig = function(callback) {
            requester._get('admin/campaign/config', {campaignId: $scope.campaign._id}, function(config) {
                if (config) {
                    $scope.showTimeseries = config.showTimeseries;
                    $scope.showPointInfo = config.showPointInfo;
                    $scope.useDynamicMaps = config.useDynamicMaps;
                    $scope.hasVisParam = config.visParam !== null;
                    
                    if (config.visParam) {
                        $scope.landsatVisparam = config.visParam;
                        localStorage.setItem('landsatVisparam', config.visParam);
                        $scope.$broadcast('landsatVisparamChanged', config.visParam);
                    }
                    
                    if (config.imageType) {
                        $scope.isSentinel = config.imageType === 'sentinel-2-l2a' || 
                                           config.imageType === 'sentinel-2' || 
                                           (config.imageType && config.imageType.toLowerCase().includes('sentinel'));
                    }
                }
                
                if (callback) {
                    callback();
                }
            });
        };

        var loadPoint = function (data) {
            Plotly.purge('NDDI');
            Plotly.purge('LANDSAT');
            Plotly.purge('NDVI');

            if(data.totalPoints === 0){
                console.warn('No points found with current filters');
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
            generateMaps();
            getCampaignMatadata();

            loadCampaignConfig(function() {
                if (!$scope.isChaco && $scope.showTimeseries) {
                    createModisChart(data.point.dates);
                    createLandsatChart();
                    createNDDIChart();
                }
            });
            
            $scope.counter = 0;
            $scope.total = data.totalPoints;
        };

        initCounter();
        
        // Verificar se há um pointId na URL
        var urlParams = $location.search();
        if (urlParams.pointId) {
            // Carregar ponto específico por ID
            $scope.showloading = true;
            requester._post('admin/points/get-point-by-id', {
                pointId: urlParams.pointId
            }, function(data) {
                if (data && data.point) {
                    loadPoint(data);
                } else {
                    NotificationDialog.warning('Ponto não encontrado');
                    $scope.submit($scope.currentIndex || 1);
                }
            }, function(error) {
                NotificationDialog.error('Erro ao carregar ponto');
                $scope.submit($scope.currentIndex || 1);
            });
        } else {
            // Usar o index da URL se disponível, senão usar 1
            $scope.submit($scope.currentIndex || 1);
        }

        var correctCampain = () => {
            $scope.showloading = true;
            var campaignId = $rootScope.user && $rootScope.user.campaign ? $rootScope.user.campaign._id : localStorage.getItem('currentCampaignId');
            requester._get(`admin/campaign/correct`, {
                campaignId: $scope.campaign._id
            }, function (data) {
                $scope.showloading = false;
                if (data) {
                    NotificationDialog.success(i18nService.translate('ALERTS.POINTS_CORRECTED', {count: data}));
                } else {
                    NotificationDialog.info(i18nService.translate('ALERTS.CAMPAIGN_NO_ISSUES'));
                }
            });
        };

        const getCampaignMatadata = () => {
            $scope.showloading = true;
            requester._get(`admin/dashboard/points-inspection`, {campaignId: $scope.campaign._id}, function (data) {
                $scope.showloading = false;
                $rootScope.campaignFinished = data.pointsInspection === 0 && data.pointsNoComplet === 0;
            });
        };

        $window.addEventListener("keydown", (event) => {
            if (event.key !== undefined) {
                if (event.key === 'F10') {
                    correctCampain();
                    event.preventDefault();
                }
            }
        }, true);

        $scope.downloadCSVBorda = function() {
            window.open('service/campaign/csv-borda', '_blank');
        };

        $scope.removeInspections = () => {
            NotificationDialog.confirm(i18nService.translate('ALERTS.CONFIRM_REMOVE_INSPECTIONS', {pointId: $scope.point._id})).then(function(confirmed) {
                if (confirmed) {
                    requester._get(`admin/campaign/removeInspections?pointId=${$scope.point._id}`, function (data) {
                        if(data) {
                            NotificationDialog.success(i18nService.translate('ALERTS.INSPECTIONS_REMOVED', {pointId: $scope.point._id}));
                            $scope.submit($scope.point.index);
                        }
                    });
                }
            });
        };

        $scope.hasMosaicForYear = function (year) {
            const y = Number(year);
            if (!Array.isArray($scope.sentinelMosaics)) {
                return false;
            }
            return $scope.sentinelMosaics.some(m =>
                Array.isArray(m.years) && m.years.includes(y)
            );
        };

        // Carregar capabilities unificado
        requester._get('admin/capabilities', function(capabilities) {
            $scope.tilesCapabilities = capabilities || [];
            
            if (Array.isArray(capabilities)) {
                // Processar Sentinel
                $scope.sentinelMosaics = capabilities
                    .filter(c => c.satellite === 'sentinel')
                    .map(c => ({
                        name: c.name,
                        years: c.year,
                        periods: c.period,
                        visparams: c.visparam
                    }));
                
                // Processar Landsat
                const landsatCap = capabilities.find(c => c.satellite === 'landsat');
                if (landsatCap && !$scope.isSentinel) {
                    $scope.landsatMosaics = [{
                        name: landsatCap.name,
                        years: landsatCap.year,
                        periods: landsatCap.period,
                        visparams: landsatCap.visparam
                    }];
                    
                    // Armazenar detalhes dos visparams
                    $scope.landsatVisparamDetails = landsatCap.visparam_details || [];
                    
                    // Trigger update dos visparams disponíveis após carregar os detalhes
                    if ($scope.campaignVisParams && $scope.campaignVisParams.length > 0) {
                        $scope.$evalAsync(function() {
                            // Forçar atualização da view
                        });
                    }
                } else {
                    $scope.landsatMosaics = [];
                    $scope.landsatVisparamDetails = [];
                }
            } else {
                $scope.sentinelMosaics = [];
                $scope.landsatMosaics = [];
            }
        });

        $scope.shouldShowProperty = function(key) {
            return $scope.defaultProperties.indexOf(key.toLowerCase()) === -1;
        };
        
        $scope.formatPropertyName = function(key) {
            return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
        };
        
        $scope.hasCustomProperties = function() {
            if (!$scope.point || !$scope.point.properties) {
                return false;
            }
            
            for (var key in $scope.point.properties) {
                if ($scope.shouldShowProperty(key)) {
                    return true;
                }
            }
            return false;
        };
        
        $scope.openMosaicDialog = function(map, point, config) {
            const mapYear = map.year || Number(new Date(map.date).getFullYear());
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
    };
    
    // Iniciar carregamento da campanha
    loadCampaignAndInit();
});