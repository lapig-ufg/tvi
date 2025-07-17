'use strict';

// Controller para Gestão de Campanha Individual
Application.controller('CampaignManagementController', function ($scope, $http, $location, $routeParams, $timeout, $uibModal) {
    $scope.campaignId = $routeParams.id;
    $scope.loading = true;
    $scope.details = null;
    $scope.activeTab = 'users';
    
    // Verificar autenticação
    $scope.checkAuth = function() {
        $http.get('/api/admin/check').then(function(response) {
            if (!response.data.authenticated) {
                $location.path('/admin/login');
            } else {
                $scope.loadCampaignDetails();
            }
        }, function() {
            $location.path('/admin/login');
        });
    };
    
    // Carregar detalhes da campanha
    $scope.loadCampaignDetails = function() {
        $scope.loading = true;
        $http.get('/api/campaigns/' + $scope.campaignId + '/details').then(function(response) {
            $scope.details = response.data;
            $scope.loading = false;
            
            // Renderizar gráficos após carregar dados
            $timeout(function() {
                $scope.renderChartsForTab($scope.activeTab);
            }, 100);
        }, function(error) {
            $scope.loading = false;
            if (error.status === 401) {
                $location.path('/admin/login');
            } else if (error.status === 404) {
                NotificationDialog.error('Campanha não encontrada');
                $location.path('/admin/campaigns');
            } else {
                NotificationDialog.error('Erro ao carregar detalhes da campanha');
            }
        });
    };
    
    // Voltar para lista de campanhas
    $scope.goBack = function() {
        $location.path('/admin/campaigns');
    };
    
    // Definir aba ativa
    $scope.setActiveTab = function(tab) {
        $scope.activeTab = tab;
        
        // Renderizar gráficos quando a aba é selecionada
        $timeout(function() {
            $scope.renderChartsForTab(tab);
        }, 100);
    };
    
    // Obter classe CSS para progresso
    $scope.getProgressClass = function(progress) {
        progress = parseFloat(progress);
        if (progress >= 90) return 'success';
        if (progress >= 70) return 'warning';
        if (progress >= 50) return 'info';
        return 'danger';
    };
    
    // Renderizar gráficos por aba
    $scope.renderChartsForTab = function(tab) {
        if (!$scope.details) return;
        
        switch(tab) {
            case 'users':
                $scope.renderUserInspectionsChart();
                break;
            case 'classes':
                $scope.renderLandCoverChart();
                break;
            case 'regions':
                $scope.renderStatesChart();
                $scope.renderBiomesChart();
                break;
            case 'timeline':
                $scope.renderTimelineChart();
                $scope.renderMeanTimeChart();
                $scope.renderPointsStatusChart();
                break;
            case 'pending':
                $scope.renderPendingMunicipalitiesChart();
                break;
        }
    };
    
    // Gráfico de inspeções por usuário
    $scope.renderUserInspectionsChart = function() {
        if (!$scope.details || !$scope.details.statistics.users.topInspectors) return;
        
        var element = document.getElementById('userInspectionsChart');
        if (!element) return;
        
        var data = $scope.details.statistics.users.topInspectors;
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Número de pontos inspecionados por usuário', 500);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(168,80,81,1)'
            },
            x: data.map(user => user.inspections),
            y: data.map(user => user._id),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 150,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Número de Inspeções'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Número de Pontos Inspecionados por Usuário',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de distribuição de classes de uso do solo
    $scope.renderLandCoverChart = function() {
        if (!$scope.details || !$scope.details.statistics.classes.distribution) return;
        
        var element = document.getElementById('landCoverChart');
        if (!element) return;
        
        var data = $scope.details.statistics.classes.distribution;
        var fieldUsed = $scope.details.statistics.classes.fieldUsed;
        var noDataMessage = $scope.details.statistics.classes.noDataMessage;
        
        if (noDataMessage || !data || data.length === 0) {
            var message = noDataMessage || 'Nenhum dado disponível';
            $scope.showNoDataMessage(element, 'Distribuição de classes', 500, message);
            return;
        }
        
        // Título dinâmico baseado no campo usado
        var title = 'Distribuição de Classes';
        if (fieldUsed) {
            // Extrair nome do campo se for aninhado
            var fieldName = fieldUsed.includes('.') ? fieldUsed.split('.')[1] : fieldUsed;
            title = 'Distribuição por ' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(169,169,169,1)'
            },
            x: data.map(cls => cls.count),
            y: data.map(cls => cls._id || 'Não classificado'),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 150,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Quantidade'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: title,
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de progresso por estados
    $scope.renderStatesChart = function() {
        if (!$scope.details || !$scope.details.statistics.states.data) return;
        
        var element = document.getElementById('statesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.states.data.slice(0, 10);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso por estado', 400);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(32,128,72,0.8)'
            },
            x: data.map(state => state.completed),
            y: data.map(state => state._id || 'Não informado'),
            orientation: 'h',
            hoverinfo: 'x',
            name: 'Concluídos'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Concluídos'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Progresso por Estado',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de progresso por biomas
    $scope.renderBiomesChart = function() {
        if (!$scope.details || !$scope.details.statistics.biomes.data) return;
        
        var element = document.getElementById('biomesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.biomes.data.slice(0, 10);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso por bioma', 400);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(65,105,225,0.8)'
            },
            x: data.map(biome => biome.completed),
            y: data.map(biome => biome._id || 'Não informado'),
            orientation: 'h',
            hoverinfo: 'x',
            name: 'Concluídos'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Concluídos'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Progresso por Bioma',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de linha do tempo
    $scope.renderTimelineChart = function() {
        if (!$scope.details || !$scope.details.statistics.timeline) return;
        
        var element = document.getElementById('timelineChart');
        if (!element) return;
        
        var data = $scope.details.statistics.timeline;
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Progresso de inspeções ao longo do tempo', 400);
            return;
        }
        
        var dataChart = [{
            type: 'scatter',
            mode: 'lines+markers',
            x: data.map(point => point._id),
            y: data.map(point => point.count),
            line: {
                color: 'rgba(52,152,219,1)',
                width: 3
            },
            marker: {
                color: 'rgba(52,152,219,1)',
                size: 8
            },
            hoverinfo: 'x+y'
        }];
        
        var layout = {
            height: 400,
            margin: {
                l: 50,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Data'
            },
            yaxis: {
                fixedrange: true,
                title: 'Número de Inspeções'
            },
            title: 'Progresso de Inspeções ao Longo do Tempo',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de tempo médio por inspeção
    $scope.renderMeanTimeChart = function() {
        if (!$scope.details || !$scope.details.statistics.meanTime) return;
        
        var element = document.getElementById('meanTimeChart');
        if (!element) return;
        
        var data = $scope.details.statistics.meanTime;
        var users = Object.keys(data);
        
        if (!users || users.length === 0) {
            $scope.showNoDataMessage(element, 'Média de tempo por inspeção', 300);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            x: users.map(user => data[user].avg),
            y: users,
            orientation: 'h',
            marker: {
                color: 'rgba(255,127,14,0.8)'
            },
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 300,
            margin: {
                l: 100,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Tempo Médio (segundos)'
            },
            yaxis: {
                fixedrange: true
            },
            title: 'Média de Tempo por Inspeção',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de status dos pontos (pizza)
    $scope.renderPointsStatusChart = function() {
        if (!$scope.details || !$scope.details.campaign) return;
        
        var element = document.getElementById('pointsStatusChart');
        if (!element) return;
        
        var campaign = $scope.details.campaign;
        
        var dataChart = [{
            values: [campaign.completedPoints, campaign.pendingPoints],
            labels: ['Pontos Concluídos', 'Pontos Pendentes'],
            type: 'pie',
            marker: {
                colors: ['rgba(44,160,44,0.9)', 'rgba(237,19,21,0.85)']
            },
            hoverinfo: 'label+value+percent'
        }];
        
        var layout = {
            height: 300,
            title: 'Status dos Pontos',
            titlefont: {
                size: 16
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Gráfico de municípios com pontos pendentes
    $scope.renderPendingMunicipalitiesChart = function() {
        if (!$scope.details || !$scope.details.statistics.pendingByMunicipality) return;
        
        var element = document.getElementById('pendingMunicipalitiesChart');
        if (!element) return;
        
        var data = $scope.details.statistics.pendingByMunicipality.slice(0, 20);
        
        if (!data || data.length === 0) {
            $scope.showNoDataMessage(element, 'Distribuição de pontos pendentes por município', 500);
            return;
        }
        
        var dataChart = [{
            type: 'bar',
            marker: {
                color: 'rgba(255,193,7,0.8)'
            },
            x: data.map(item => item.count),
            y: data.map(item => (item._id.municipality || 'N/A') + ' - ' + (item._id.state || 'N/A')),
            orientation: 'h',
            hoverinfo: 'x'
        }];
        
        var layout = {
            height: 500,
            margin: {
                l: 200,
                pad: 0
            },
            xaxis: {
                fixedrange: true,
                title: 'Pontos Pendentes'
            },
            yaxis: {
                fixedrange: true,
                gridwidth: 2
            },
            title: 'Top 20 Municípios com Pontos Pendentes',
            titlefont: {
                size: 18
            }
        };
        
        Plotly.newPlot(element, dataChart, layout, {displayModeBar: false});
    };
    
    // Função para mostrar mensagem "sem dados"
    $scope.showNoDataMessage = function(element, title, height, customMessage) {
        var layout = {
            height: height,
            title: title,
            titlefont: {
                size: 18
            },
            xaxis: {
                showgrid: false,
                zeroline: false,
                showticklabels: false
            },
            yaxis: {
                showgrid: false,
                zeroline: false,
                showticklabels: false
            },
            annotations: [{
                xref: 'paper',
                yref: 'paper',
                x: 0.5,
                y: 0.5,
                xanchor: 'center',
                yanchor: 'middle',
                text: customMessage || 'Sem dados disponíveis',
                showarrow: false,
                font: {
                    size: 20,
                    color: '#666'
                }
            }]
        };
        
        Plotly.newPlot(element, [], layout, {displayModeBar: false});
    };
    
    // Funções de ação para os botões
    $scope.editCampaign = function() {
        const modalInstance = $uibModal.open({
            templateUrl: 'views/campaign-form-modal.tpl.html',
            controller: 'CampaignFormModalController',
            size: 'lg',
            resolve: {
                campaign: function() {
                    return angular.copy($scope.details.campaign);
                },
                isNew: function() {
                    return false;
                }
            }
        });
        
        modalInstance.result.then(function(updatedCampaign) {
            $http.put('/api/campaigns/' + updatedCampaign._id, updatedCampaign).then(function(response) {
                if (response.data.success) {
                    $scope.loadCampaignDetails();
                    NotificationDialog.success('Campanha atualizada com sucesso!');
                } else {
                    NotificationDialog.error('Erro ao atualizar campanha');
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao atualizar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };
    
    $scope.downloadReport = function() {
        // Implementar download de relatório da campanha
        const campaignId = $scope.details.campaign._id;
        window.open(`https://timeseries.lapig.iesa.ufg.br/api/analytics/tvi/${campaignId}/csv?direct=true`, '_blank');
    };
    
    $scope.viewPoints = function() {
        $uibModal.open({
            templateUrl: 'views/campaign-points-modal.tpl.html',
            controller: 'AdminCampaignPointsModalController',
            size: 'xl',
            windowClass: 'points-modal-wide',
            resolve: {
                campaign: function() {
                    return $scope.details.campaign;
                }
            }
        });
    };
    
    $scope.manageLandUse = function() {
        // Redirecionar para página de gestão de classes de uso
        NotificationDialog.info('Redirecionando para gestão de classes de uso do solo...');
        // TODO: Implementar redirecionamento ou modal específico
    };
    
    $scope.uploadMorePoints = function() {
        const modalInstance = $uibModal.open({
            templateUrl: 'views/geojson-upload-modal.tpl.html',
            controller: 'AdminGeoJSONUploadModalController',
            size: 'lg',
            windowClass: 'modal-90-width',
            resolve: {
                campaignId: function() {
                    return $scope.details.campaign._id;
                }
            }
        });
        
        modalInstance.result.then(function(result) {
            if (result.success) {
                $scope.loadCampaignDetails();
                NotificationDialog.success(`Upload realizado com sucesso! ${result.message}`);
            }
        });
    };
    
    $scope.deleteCampaign = function() {
        NotificationDialog.confirm(`Tem certeza que deseja deletar a campanha "${$scope.details.campaign._id}"?`, 'Confirmar Exclusão').then(function(confirmed) {
            if (!confirmed) {
                return;
            }
            
            $http.delete('/api/campaigns/' + $scope.details.campaign._id).then(function(response) {
                if (response.data.success) {
                    NotificationDialog.success('Campanha deletada com sucesso!');
                    $location.path('/admin/campaigns');
                } else if (response.data.error) {
                    NotificationDialog.error('Erro: ' + response.data.error);
                }
            }, function(error) {
                if (error.status === 401) {
                    $location.path('/admin/login');
                } else {
                    NotificationDialog.error('Erro ao deletar campanha: ' + (error.data.error || 'Erro desconhecido'));
                }
            });
        });
    };
    
    // Funções para análise de propriedades
    $scope.loadAvailableProperties = function() {
        console.log('Recarregando análise de propriedades');
        // TODO: Implementar recarregamento da análise
        NotificationDialog.info('Recarregando análise de propriedades...');
    };
    
    $scope.exportPropertyAnalysis = function() {
        console.log('Exportando análise de propriedades');
        // TODO: Implementar exportação
        NotificationDialog.info('Funcionalidade de exportação será implementada em breve');
    };
    
    $scope.renderPropertyChart = function(recommendation) {
        console.log('Renderizando gráfico para propriedade:', recommendation);
        recommendation.rendered = true;
        // TODO: Implementar renderização de gráfico dinâmico
        NotificationDialog.success('Gráfico renderizado (simulação)');
    };
    
    $scope.hasRenderedCharts = function() {
        if (!$scope.details || !$scope.details.visualizationRecommendations) return false;
        return $scope.details.visualizationRecommendations.some(rec => rec.rendered);
    };
    
    $scope.getVisualizationTypeName = function(type) {
        var types = {
            'bar': 'Gráfico de Barras',
            'pie': 'Gráfico de Pizza',
            'scatter': 'Gráfico de Dispersão',
            'line': 'Gráfico de Linha',
            'histogram': 'Histograma'
        };
        return types[type] || type;
    };

    // Verificar autenticação ao carregar
    $scope.checkAuth();
});