Application.run(function(AdminPages, $http, NotificationDialog) {
    function identifier(params, key) {
        if (!params || typeof params[key] !== 'string' || !params[key].trim()) {
            throw new Error('Identificador obrigatório.');
        }
        return encodeURIComponent(params[key]);
    }

    function successful(response, message) {
        if (!response.data || !response.data.success) {
            throw new Error((response.data && response.data.error) || message);
        }
        return response.data;
    }

    AdminPages.register('log-details', {
        className: 'admin-log-page',
        title: 'Detalhes do log',
        templateUrl: 'views/admin-logs-detail-modal.tpl.html',
        controller: 'AdminLogsDetailModalController',
        parent: function() { return '/admin/logs'; },
        load: function(params) {
            return $http.get('/service/logs/' + identifier(params, 'logId')).then(function(response) {
                const data = successful(response, 'Não foi possível carregar o log.');
                if (!data.log) throw new Error('Log não encontrado.');
                return { logData: data.log };
            });
        }
    });

    AdminPages.register('logs-cleanup', {
        className: 'admin-log-page',
        editable: true,
        editState: function(scope) { return { cleanupDays: scope.cleanupDays, keepErrors: scope.keepErrors }; },
        title: 'Limpeza de logs',
        templateUrl: 'views/admin-logs-cleanup-modal.tpl.html',
        controller: 'AdminLogsCleanupModalController',
        parent: function() { return '/admin/logs'; },
        load: function() { return {}; },
        save: function(result) {
            const days = Number(result.cleanupDays);
            if ([7, 15, 30, 60, 90].indexOf(days) === -1) {
                throw new Error('Selecione um período válido para preservar os logs.');
            }
            return $http.delete('/service/logs/cleanup', {
                params: { daysToKeep: days, keepErrors: result.keepErrors === true }
            }).then(function(response) {
                const data = successful(response, 'Erro ao limpar logs.');
                NotificationDialog.success('Limpeza concluída', data.deleted + ' logs foram removidos');
            });
        }
    });

    AdminPages.register('logs-job-config', {
        className: 'admin-log-page',
        editable: true,
        editState: function(scope) { return scope.jobConfig; },
        pending: function(scope) { return scope.triggering === true; },
        title: 'Configuração da limpeza automática',
        templateUrl: 'views/admin-logs-job-config-modal.tpl.html',
        controller: 'AdminLogsJobConfigModalController',
        parent: function() { return '/admin/logs'; },
        load: function() {
            return $http.get('/service/logs/job-status').then(function(response) {
                const data = successful(response, 'Erro ao carregar configuração do job.');
                if (!data.jobStatus || !data.jobStatus.configuration) throw new Error('Configuração do job indisponível.');
                return { jobStatusData: data.jobStatus };
            });
        },
        save: function(configuration) {
            return $http.put('/service/logs/job-config', configuration).then(function(response) {
                successful(response, 'Erro ao salvar configuração.');
                NotificationDialog.success('Configuração salva com sucesso');
            });
        }
    });

    AdminPages.register('ticket-status', {
        editable: true,
        editState: function(scope) { return scope.form; },
        pending: function(scope) { return scope.submitting === true; },
        title: 'Alterar status do chamado',
        templateUrl: 'views/ticket-status-modal.tpl.html',
        controller: 'TicketStatusModalController',
        parent: function() { return '/admin/tickets'; },
        load: function(params) {
            return $http.get('/service/tickets/' + identifier(params, 'ticketId')).then(function(response) {
                if (!response.data || !response.data._id || response.data.error) throw new Error('Chamado não encontrado.');
                return { ticket: response.data };
            });
        }
    });

    AdminPages.register('ticket-doubt', {
        editable: true,
        editState: function(scope) { return { newComment: scope.newComment, transition: scope.transition }; },
        pending: function(scope) { return scope.submitting === true; },
        title: 'Dúvida do ponto',
        templateUrl: 'views/doubt-resolve-modal.tpl.html',
        controller: 'AdminDoubtResolveModalController',
        parent: function() { return '/admin/tickets'; },
        load: function(params) {
            return $http.get('/service/points/' + identifier(params, 'pointId') + '/doubt').then(function(response) {
                const data = response.data;
                if (!data || !data.pointId || !data.campaign || !data.doubt) throw new Error('Dúvida não encontrada.');
                return {
                    point: { _id: data.pointId, campaign: data.campaign, doubt: data.doubt },
                    campaign: { _id: data.campaign },
                    mode: 'admin'
                };
            });
        }
    });
});
