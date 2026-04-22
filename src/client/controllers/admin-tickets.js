/**
 * Controllers do módulo de Tickets (admin)
 * - AdminTicketsController: gestão de todos os tickets
 * - AdminTicketsDashboardController: dashboard com gráficos (Fase 2)
 */

/* --- Gestão Admin de Tickets --- */
Application.controller('AdminTicketsController', function ($scope, $rootScope, $location, $uibModal, requester, $http) {

  $scope.tickets = [];
  $scope.pagination = { total: 0, page: 1, limit: 50, pages: 0 };
  $scope.pageSizes = [25, 50, 100, 200];
  $scope.filters = {
    type: '',
    status: '',
    category: '',
    origin: '',
    search: ''
  };
  $scope.stats = null;
  $scope.loading = false;

  $scope.types = [
    { value: '', label: 'Todos os tipos' },
    { value: 'RECLAMACAO', label: 'Reclamação' },
    { value: 'SUGESTAO', label: 'Sugestão' },
    { value: 'DUVIDA', label: 'Dúvida' },
    { value: 'ELOGIO', label: 'Elogio' }
  ];

  $scope.statuses = [
    { value: '', label: 'Todos os status' },
    { value: 'ABERTO', label: 'Aberto' },
    { value: 'EM_ANALISE', label: 'Em Análise' },
    { value: 'EM_DESENVOLVIMENTO', label: 'Em Desenvolvimento' },
    { value: 'RESOLVIDO', label: 'Resolvido' },
    { value: 'FECHADO', label: 'Fechado' }
  ];

  $scope.categories = [
    { value: '', label: 'Todas as categorias' },
    { value: 'INTERFACE', label: 'Interface' },
    { value: 'DESEMPENHO', label: 'Desempenho' },
    { value: 'FUNCIONALIDADE', label: 'Funcionalidade' },
    { value: 'DADOS', label: 'Dados' },
    { value: 'OUTRO', label: 'Outro' }
  ];

  $scope.origins = [
    { value: '', label: 'Todas as origens' },
    { value: 'TVI', label: 'TVI' },
    { value: 'PLUGIN_FGI', label: 'Plugin FGI' },
    { value: 'PONTO', label: 'Dúvida de ponto' }
  ];

  $scope.loadTickets = function () {
    $scope.loading = true;
    var params = {
      page: $scope.pagination.page,
      limit: $scope.pagination.limit
    };
    if ($scope.filters.type) params.type = $scope.filters.type;
    if ($scope.filters.status) params.status = $scope.filters.status;
    if ($scope.filters.category) params.category = $scope.filters.category;
    if ($scope.filters.origin) params.origin = $scope.filters.origin;
    if ($scope.filters.search) params.search = $scope.filters.search;

    requester._get('tickets', params, function (result) {
      $scope.tickets = result.data || [];
      $scope.pagination = result.pagination || $scope.pagination;
      $scope.loading = false;
    });
  };

  $scope.loadStats = function () {
    requester._get('tickets/stats/summary', function (result) {
      $scope.stats = result;
    });
  };

  $scope.applyFilters = function () {
    $scope.pagination.page = 1;
    $scope.loadTickets();
  };

  $scope.clearFilters = function () {
    $scope.filters = { type: '', status: '', category: '', origin: '', search: '' };
    $scope.pagination.page = 1;
    $scope.loadTickets();
  };

  $scope.changePage = function () {
    $scope.loadTickets();
  };

  $scope.changePageSize = function () {
    $scope.pagination.page = 1;
    $scope.loadTickets();
  };

  $scope.getInicio = function () {
    if (!$scope.pagination.total) return 0;
    return (($scope.pagination.page - 1) * $scope.pagination.limit) + 1;
  };

  $scope.getFim = function () {
    var fim = $scope.pagination.page * $scope.pagination.limit;
    return Math.min(fim, $scope.pagination.total);
  };

  $scope.viewTicket = function (ticket) {
    if (ticket && ticket._isDoubt) {
      $scope.openDoubtResolveModal(ticket);
      return;
    }
    $location.path('/tickets/' + ticket._id);
  };

  $scope.openStatusModal = function (ticket) {
    if (ticket && ticket._isDoubt) {
      // Dúvida de ponto usa fluxo próprio de resolução
      $scope.openDoubtResolveModal(ticket);
      return;
    }
    var modalInstance = $uibModal.open({
      templateUrl: 'views/ticket-status-modal.tpl.html',
      controller: 'TicketStatusModalController',
      resolve: {
        ticket: function () { return ticket; }
      }
    });

    modalInstance.result.then(function () {
      $scope.loadTickets();
      $scope.loadStats();
    });
  };

  $scope.openDoubtResolveModal = function (ticket) {
    if (!ticket || !ticket._isDoubt || !ticket._pointId) return;
    $http.get('/service/points/' + ticket._pointId + '/doubt')
      .success(function (result) {
        var point = {
          _id: result.pointId,
          campaign: result.campaign,
          doubt: result.doubt
        };
        var campaign = { _id: result.campaign };
        var modalInstance = $uibModal.open({
          templateUrl: 'views/doubt-resolve-modal.tpl.html',
          controller: 'AdminDoubtResolveModalController',
          size: 'lg',
          backdrop: 'static',
          resolve: {
            point: function () { return point; },
            campaign: function () { return campaign; }
          }
        });
        modalInstance.result.then(function () {
          $scope.loadTickets();
          $scope.loadStats();
        }, function () {
          // Recarregar mesmo em dismiss: o admin pode ter comentado antes de fechar
          $scope.loadTickets();
        });
      })
      .error(function () {
        alert('Não foi possível carregar a dúvida deste ponto.');
      });
  };

  // Labels e badges (mesmo padrão dos controllers de usuário)
  $scope.getTypeBadgeClass = function (type) {
    var map = { 'RECLAMACAO': 'label-danger', 'SUGESTAO': 'label-info', 'DUVIDA': 'label-warning', 'ELOGIO': 'label-success' };
    return map[type] || 'label-default';
  };

  $scope.getTypeLabel = function (type) {
    var map = { 'RECLAMACAO': 'Reclamação', 'SUGESTAO': 'Sugestão', 'DUVIDA': 'Dúvida', 'ELOGIO': 'Elogio' };
    return map[type] || type;
  };

  $scope.getStatusBadgeClass = function (status) {
    var map = { 'ABERTO': 'label-primary', 'EM_ANALISE': 'label-info', 'EM_DESENVOLVIMENTO': 'label-warning', 'RESOLVIDO': 'label-success', 'FECHADO': 'label-default' };
    return map[status] || 'label-default';
  };

  $scope.getStatusLabel = function (status) {
    var map = { 'ABERTO': 'Aberto', 'EM_ANALISE': 'Em Análise', 'EM_DESENVOLVIMENTO': 'Em Desenvolvimento', 'RESOLVIDO': 'Resolvido', 'FECHADO': 'Fechado' };
    return map[status] || status;
  };

  $scope.getSeverityBadgeClass = function (severity) {
    var map = { 'BAIXA': 'label-info', 'MEDIA': 'label-warning', 'ALTA': 'label-danger', 'CRITICA': 'label-danger' };
    return map[severity] || 'label-default';
  };

  $scope.getSeverityLabel = function (severity) {
    var map = { 'BAIXA': 'Baixa', 'MEDIA': 'Média', 'ALTA': 'Alta', 'CRITICA': 'Crítica' };
    return map[severity] || severity;
  };

  // Carregar ao iniciar
  $scope.loadTickets();
  $scope.loadStats();
});

/* --- Modal de Mudança de Status --- */
Application.controller('TicketStatusModalController', function ($scope, $uibModalInstance, requester, ticket) {

  $scope.ticket = ticket;
  $scope.form = {
    status: '',
    reason: ''
  };
  $scope.submitting = false;
  $scope.errorMessage = '';

  // Transições válidas a partir do status atual
  var transitions = {
    'ABERTO': ['EM_ANALISE', 'FECHADO'],
    'EM_ANALISE': ['EM_DESENVOLVIMENTO', 'RESOLVIDO', 'ABERTO'],
    'EM_DESENVOLVIMENTO': ['RESOLVIDO', 'EM_ANALISE'],
    'RESOLVIDO': ['FECHADO', 'ABERTO'],
    'FECHADO': []
  };

  var statusLabels = {
    'ABERTO': 'Aberto',
    'EM_ANALISE': 'Em Análise',
    'EM_DESENVOLVIMENTO': 'Em Desenvolvimento',
    'RESOLVIDO': 'Resolvido',
    'FECHADO': 'Fechado'
  };

  $scope.availableStatuses = (transitions[ticket.status] || []).map(function (s) {
    return { value: s, label: statusLabels[s] || s };
  });

  $scope.submit = function () {
    $scope.errorMessage = '';

    if (!$scope.form.status) {
      $scope.errorMessage = 'Selecione o novo status.';
      return;
    }
    if (!$scope.form.reason || !$scope.form.reason.trim()) {
      $scope.errorMessage = 'O motivo é obrigatório.';
      return;
    }

    $scope.submitting = true;

    requester._patch('tickets/' + ticket._id + '/status', {
      status: $scope.form.status,
      reason: $scope.form.reason
    }, function (result) {
      $scope.submitting = false;
      if (result && result.error) {
        $scope.errorMessage = result.error;
      } else {
        $uibModalInstance.close(result);
      }
    });
  };

  $scope.cancel = function () {
    $uibModalInstance.dismiss('cancel');
  };
});

/* --- Dashboard Admin com gráficos Chart.js --- */
Application.controller('AdminTicketsDashboardController', function ($scope, $timeout, requester) {
  $scope.loading = true;
  $scope.dashboard = null;
  $scope.charts = {};

  var typeLabels = { 'RECLAMACAO': 'Reclamação', 'SUGESTAO': 'Sugestão', 'DUVIDA': 'Dúvida', 'ELOGIO': 'Elogio' };
  var typeColors = { 'RECLAMACAO': '#d9534f', 'SUGESTAO': '#5bc0de', 'DUVIDA': '#f0ad4e', 'ELOGIO': '#5cb85c' };
  var statusLabels = { 'ABERTO': 'Aberto', 'EM_ANALISE': 'Em Análise', 'EM_DESENVOLVIMENTO': 'Em Desenvolvimento', 'RESOLVIDO': 'Resolvido', 'FECHADO': 'Fechado' };
  var statusColors = { 'ABERTO': '#337ab7', 'EM_ANALISE': '#5bc0de', 'EM_DESENVOLVIMENTO': '#f0ad4e', 'RESOLVIDO': '#5cb85c', 'FECHADO': '#777' };

  $scope.formatAvgResolution = function (ms) {
    if (!ms) return '—';
    var hours = ms / (1000 * 60 * 60);
    if (hours < 24) return hours.toFixed(1) + 'h';
    var days = hours / 24;
    return days.toFixed(1) + 'd';
  };

  function destroyCharts() {
    Object.keys($scope.charts).forEach(function (key) {
      if ($scope.charts[key]) $scope.charts[key].destroy();
    });
    $scope.charts = {};
  }

  function buildCharts(data) {
    // Gráfico Pizza: distribuição por tipo
    var typeData = data.charts.byType || [];
    var ctxType = document.getElementById('chartByType');
    if (ctxType) {
      $scope.charts.byType = new Chart(ctxType.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: typeData.map(function (d) { return typeLabels[d._id] || d._id; }),
          datasets: [{
            data: typeData.map(function (d) { return d.count; }),
            backgroundColor: typeData.map(function (d) { return typeColors[d._id] || '#999'; })
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    }

    // Gráfico Barras: tickets por status
    var statusData = data.charts.byStatus || [];
    var ctxStatus = document.getElementById('chartByStatus');
    if (ctxStatus) {
      $scope.charts.byStatus = new Chart(ctxStatus.getContext('2d'), {
        type: 'bar',
        data: {
          labels: statusData.map(function (d) { return statusLabels[d._id] || d._id; }),
          datasets: [{
            label: 'Tickets',
            data: statusData.map(function (d) { return d.count; }),
            backgroundColor: statusData.map(function (d) { return statusColors[d._id] || '#999'; })
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }

    // Gráfico Barras Horizontais: top categorias
    var catData = data.charts.byCategory || [];
    var catColors = ['#337ab7', '#5bc0de', '#5cb85c', '#f0ad4e', '#d9534f'];
    var ctxCat = document.getElementById('chartByCategory');
    if (ctxCat) {
      $scope.charts.byCategory = new Chart(ctxCat.getContext('2d'), {
        type: 'bar',
        data: {
          labels: catData.map(function (d) { return d._id; }),
          datasets: [{
            label: 'Tickets',
            data: catData.map(function (d) { return d.count; }),
            backgroundColor: catData.map(function (d, i) { return catColors[i % catColors.length]; })
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }

    // Gráfico Linha: tickets criados por semana
    var weeklyData = data.charts.weekly || [];
    var ctxWeekly = document.getElementById('chartWeekly');
    if (ctxWeekly) {
      $scope.charts.weekly = new Chart(ctxWeekly.getContext('2d'), {
        type: 'line',
        data: {
          labels: weeklyData.map(function (d) { return 'S' + d._id.week + '/' + d._id.year; }),
          datasets: [{
            label: 'Tickets criados',
            data: weeklyData.map(function (d) { return d.count; }),
            borderColor: '#337ab7',
            backgroundColor: 'rgba(51, 122, 183, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }

  requester._get('tickets/stats/dashboard', function (result) {
    $scope.dashboard = result;
    $scope.loading = false;

    // Aguardar o DOM renderizar antes de criar os gráficos
    $timeout(function () {
      destroyCharts();
      buildCharts(result);
    }, 100);
  });

  $scope.$on('$destroy', function () {
    destroyCharts();
  });
});
