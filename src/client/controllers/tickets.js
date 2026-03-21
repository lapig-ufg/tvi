/**
 * Controllers do módulo de Tickets (usuário)
 * - TicketsListController: listagem com filtros e paginação
 * - TicketFormController: criação de novo ticket
 * - TicketDetailController: detalhe, comentários
 */

/* --- Listagem de Tickets --- */
Application.controller('TicketsListController', function ($scope, $rootScope, $location, requester, i18nService) {

  $scope.tickets = [];
  $scope.pagination = { total: 0, page: 1, limit: 10, pages: 0 };
  $scope.filters = {
    type: '',
    status: '',
    search: '',
    mine: true
  };
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

  $scope.loadTickets = function () {
    $scope.loading = true;
    var params = {
      page: $scope.pagination.page,
      limit: $scope.pagination.limit
    };
    if ($scope.filters.type) params.type = $scope.filters.type;
    if ($scope.filters.status) params.status = $scope.filters.status;
    if ($scope.filters.search) params.search = $scope.filters.search;
    if ($scope.filters.mine) params.mine = 'true';

    requester._get('tickets', params, function (result) {
      $scope.tickets = result.data || [];
      $scope.pagination = result.pagination || $scope.pagination;
      $scope.loading = false;
    });
  };

  $scope.applyFilters = function () {
    $scope.pagination.page = 1;
    $scope.loadTickets();
  };

  $scope.clearFilters = function () {
    $scope.filters = { type: '', status: '', search: '', mine: true };
    $scope.pagination.page = 1;
    $scope.loadTickets();
  };

  $scope.changePage = function () {
    $scope.loadTickets();
  };

  $scope.viewTicket = function (ticket) {
    $location.path('/tickets/' + ticket._id);
  };

  $scope.newTicket = function () {
    $location.path('/tickets/new');
  };

  $scope.getTypeBadgeClass = function (type) {
    var map = {
      'RECLAMACAO': 'label-danger',
      'SUGESTAO': 'label-info',
      'DUVIDA': 'label-warning',
      'ELOGIO': 'label-success'
    };
    return map[type] || 'label-default';
  };

  $scope.getTypeLabel = function (type) {
    var map = {
      'RECLAMACAO': 'Reclamação',
      'SUGESTAO': 'Sugestão',
      'DUVIDA': 'Dúvida',
      'ELOGIO': 'Elogio'
    };
    return map[type] || type;
  };

  $scope.getStatusBadgeClass = function (status) {
    var map = {
      'ABERTO': 'label-primary',
      'EM_ANALISE': 'label-info',
      'EM_DESENVOLVIMENTO': 'label-warning',
      'RESOLVIDO': 'label-success',
      'FECHADO': 'label-default'
    };
    return map[status] || 'label-default';
  };

  $scope.getStatusLabel = function (status) {
    var map = {
      'ABERTO': 'Aberto',
      'EM_ANALISE': 'Em Análise',
      'EM_DESENVOLVIMENTO': 'Em Desenvolvimento',
      'RESOLVIDO': 'Resolvido',
      'FECHADO': 'Fechado'
    };
    return map[status] || status;
  };

  // Carregar ao iniciar
  $scope.loadTickets();
});

/* --- Formulário de Novo Ticket --- */
Application.controller('TicketFormController', function ($scope, $rootScope, $location, requester, i18nService) {

  $scope.ticket = {
    type: '',
    category: '',
    severity: '',
    title: '',
    description: '',
    origin: 'TVI'
  };
  $scope.submitting = false;
  $scope.errorMessage = '';

  $scope.types = [
    { value: 'RECLAMACAO', label: 'Reclamação' },
    { value: 'SUGESTAO', label: 'Sugestão' },
    { value: 'DUVIDA', label: 'Dúvida' },
    { value: 'ELOGIO', label: 'Elogio' }
  ];

  $scope.categories = [
    { value: 'INTERFACE', label: 'Interface' },
    { value: 'DESEMPENHO', label: 'Desempenho' },
    { value: 'FUNCIONALIDADE', label: 'Funcionalidade' },
    { value: 'DADOS', label: 'Dados' },
    { value: 'OUTRO', label: 'Outro' }
  ];

  $scope.severities = [
    { value: 'BAIXA', label: 'Baixa' },
    { value: 'MEDIA', label: 'Média' },
    { value: 'ALTA', label: 'Alta' },
    { value: 'CRITICA', label: 'Crítica' }
  ];

  $scope.showSeverity = function () {
    return $scope.ticket.type === 'RECLAMACAO';
  };

  $scope.submitTicket = function () {
    $scope.errorMessage = '';

    if (!$scope.ticket.type || !$scope.ticket.category || !$scope.ticket.title || !$scope.ticket.description) {
      $scope.errorMessage = 'Por favor, preencha todos os campos obrigatórios.';
      return;
    }

    if ($scope.ticket.type === 'RECLAMACAO' && !$scope.ticket.severity) {
      $scope.errorMessage = 'Severidade é obrigatória para reclamações.';
      return;
    }

    $scope.submitting = true;

    var payload = {
      type: $scope.ticket.type,
      category: $scope.ticket.category,
      title: $scope.ticket.title,
      description: $scope.ticket.description,
      origin: $scope.ticket.origin
    };

    if ($scope.ticket.type === 'RECLAMACAO') {
      payload.severity = $scope.ticket.severity;
    }

    requester._post('tickets', payload, function (result) {
      $scope.submitting = false;
      if (result && result._id) {
        $location.path('/tickets/' + result._id);
      } else if (result && result.error) {
        $scope.errorMessage = result.error;
      }
    });
  };

  $scope.cancel = function () {
    $location.path('/tickets');
  };
});

/* --- Detalhe do Ticket --- */
Application.controller('TicketDetailController', function ($scope, $rootScope, $location, $routeParams, $http, requester, i18nService) {

  $scope.ticket = null;
  $scope.loading = true;
  $scope.newComment = { text: '' };
  $scope.submittingComment = false;
  $scope.votingInProgress = false;
  $scope.uploadingFile = false;
  $scope.uploadError = '';

  $scope.loadTicket = function () {
    $scope.loading = true;
    requester._get('tickets/' + $routeParams.id, function (result) {
      $scope.ticket = result;
      $scope.loading = false;
    });
  };

  $scope.addComment = function () {
    if (!$scope.newComment.text || !$scope.newComment.text.trim()) return;

    $scope.submittingComment = true;
    requester._post('tickets/' + $routeParams.id + '/comments', {
      text: $scope.newComment.text
    }, function (result) {
      $scope.submittingComment = false;
      if (result && result._id) {
        if (!$scope.ticket.comments) $scope.ticket.comments = [];
        $scope.ticket.comments.push(result);
        $scope.newComment.text = '';
      }
    });
  };

  // --- Votos ---
  $scope.toggleVote = function () {
    if ($scope.votingInProgress) return;
    $scope.votingInProgress = true;

    requester._post('tickets/' + $routeParams.id + '/vote', {}, function (result) {
      $scope.votingInProgress = false;
      if (result && result.voteCount !== undefined) {
        $scope.ticket.voteCount = result.voteCount;
        $scope.ticket.votes = result.votes;
      }
    });
  };

  $scope.hasVoted = function () {
    if (!$scope.ticket || !$scope.ticket.votes || !$rootScope.user) return false;
    return $scope.ticket.votes.indexOf($rootScope.user.name) !== -1;
  };

  // --- Anexos ---
  $scope.getAttachmentUrl = function (attachment) {
    return 'service/tickets/' + $routeParams.id + '/attachments/' + attachment._id;
  };

  $scope.uploadAttachment = function (files) {
    if (!files || files.length === 0) return;
    var file = files[0];

    // Validação client-side
    if (['image/png', 'image/jpeg'].indexOf(file.type) === -1) {
      $scope.uploadError = 'Apenas imagens PNG e JPG são permitidas.';
      $scope.$apply();
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      $scope.uploadError = 'O arquivo excede o tamanho máximo de 10 MB.';
      $scope.$apply();
      return;
    }

    $scope.uploadError = '';
    $scope.uploadingFile = true;

    var formData = new FormData();
    formData.append('file', file);

    $http.post('service/tickets/' + $routeParams.id + '/attachments', formData, {
      transformRequest: angular.identity,
      headers: { 'Content-Type': undefined }
    }).then(function (resp) {
      $scope.uploadingFile = false;
      if (resp.data && resp.data._id) {
        if (!$scope.ticket.attachments) $scope.ticket.attachments = [];
        $scope.ticket.attachments.push(resp.data);
      }
    }, function (err) {
      $scope.uploadingFile = false;
      $scope.uploadError = (err.data && err.data.error) || 'Erro ao enviar arquivo.';
    });
  };

  $scope.formatFileSize = function (bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  $scope.goBack = function () {
    $location.path('/tickets');
  };

  $scope.getTypeBadgeClass = function (type) {
    var map = {
      'RECLAMACAO': 'label-danger',
      'SUGESTAO': 'label-info',
      'DUVIDA': 'label-warning',
      'ELOGIO': 'label-success'
    };
    return map[type] || 'label-default';
  };

  $scope.getTypeLabel = function (type) {
    var map = {
      'RECLAMACAO': 'Reclamação',
      'SUGESTAO': 'Sugestão',
      'DUVIDA': 'Dúvida',
      'ELOGIO': 'Elogio'
    };
    return map[type] || type;
  };

  $scope.getStatusBadgeClass = function (status) {
    var map = {
      'ABERTO': 'label-primary',
      'EM_ANALISE': 'label-info',
      'EM_DESENVOLVIMENTO': 'label-warning',
      'RESOLVIDO': 'label-success',
      'FECHADO': 'label-default'
    };
    return map[status] || 'label-default';
  };

  $scope.getStatusLabel = function (status) {
    var map = {
      'ABERTO': 'Aberto',
      'EM_ANALISE': 'Em Análise',
      'EM_DESENVOLVIMENTO': 'Em Desenvolvimento',
      'RESOLVIDO': 'Resolvido',
      'FECHADO': 'Fechado'
    };
    return map[status] || status;
  };

  $scope.getSeverityBadgeClass = function (severity) {
    var map = {
      'BAIXA': 'label-info',
      'MEDIA': 'label-warning',
      'ALTA': 'label-danger',
      'CRITICA': 'label-danger'
    };
    return map[severity] || 'label-default';
  };

  $scope.getSeverityLabel = function (severity) {
    var map = {
      'BAIXA': 'Baixa',
      'MEDIA': 'Média',
      'ALTA': 'Alta',
      'CRITICA': 'Crítica'
    };
    return map[severity] || severity;
  };

  $scope.getCategoryLabel = function (category) {
    var map = {
      'INTERFACE': 'Interface',
      'DESEMPENHO': 'Desempenho',
      'FUNCIONALIDADE': 'Funcionalidade',
      'DADOS': 'Dados',
      'OUTRO': 'Outro'
    };
    return map[category] || category;
  };

  $scope.canEdit = function () {
    if (!$scope.ticket) return false;
    if ($scope.ticket.status !== 'ABERTO') return false;
    if ($rootScope.isAdminMode) return true;
    return $rootScope.user && $scope.ticket.author && $rootScope.user.name === $scope.ticket.author.name;
  };

  $scope.editTicket = function () {
    $location.path('/tickets/' + $routeParams.id + '/edit');
  };

  // Carregar ao iniciar
  $scope.loadTicket();
});
