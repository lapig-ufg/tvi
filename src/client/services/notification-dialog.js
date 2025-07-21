'use strict';

/**
 * Serviço de Notificação/Diálogo Personalizado
 * Substitui o alert() nativo por diálogos mais intuitivos e estilizados
 */
Application.factory('NotificationDialog', function($uibModal, $timeout, $q) {
    const service = {};

    // Tipos de notificação
    const TYPES = {
        SUCCESS: 'success',
        ERROR: 'error',
        WARNING: 'warning',
        INFO: 'info',
        CONFIRM: 'confirm'
    };

    // Ícones para cada tipo
    const ICONS = {
        success: 'glyphicon-ok-circle',
        error: 'glyphicon-remove-circle',
        warning: 'glyphicon-warning-sign',
        info: 'glyphicon-info-sign',
        confirm: 'glyphicon-question-sign'
    };

    // Cores de fundo para cada tipo
    const COLORS = {
        success: '#5cb85c',
        error: '#d9534f',
        warning: '#f0ad4e',
        info: '#5bc0de',
        confirm: '#337ab7'
    };

    /**
     * Exibe uma notificação do tipo toast (auto-fechamento)
     */
    service.toast = function(message, type = TYPES.INFO, duration = 3000) {
        const modalInstance = $uibModal.open({
            animation: true,
            backdrop: false,
            keyboard: false,
            windowClass: 'notification-toast notification-' + type,
            size: 'sm',
            template: `
                <div class="notification-content">
                    <div class="notification-icon">
                        <i class="glyphicon ${ICONS[type]}"></i>
                    </div>
                    <div class="notification-message">
                        <p>${message}</p>
                    </div>
                </div>
            `
        });

        // Auto-fechar após duração especificada
        $timeout(function() {
            modalInstance.close();
        }, duration);

        return modalInstance;
    };

    /**
     * Exibe um diálogo modal com botão de fechar
     */
    service.alert = function(message, title, type = TYPES.INFO, errorCode = null) {
        const modalInstance = $uibModal.open({
            animation: true,
            backdrop: 'static',
            keyboard: true,
            windowClass: 'notification-modal notification-' + type,
            size: 'md',
            template: `
                <div class="modal-header" style="background-color: ${COLORS[type]}; color: white;">
                    <button type="button" class="close" ng-click="$dismiss()" style="color: white; opacity: 0.8;">
                        <span aria-hidden="true">&times;</span>
                    </button>
                    <h4 class="modal-title">
                        <i class="glyphicon ${ICONS[type]}"></i>
                        ${title || getDefaultTitle(type)}
                    </h4>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                    ${errorCode ? `
                        <div class="error-code-section" style="margin-top: 15px; padding: 10px; background-color: #f8f9fa; border-left: 4px solid ${COLORS[type]};">
                            <small>
                                <strong>Código de Erro:</strong> 
                                <span style="font-family: monospace; font-size: 12px; color: #666;">${errorCode}</span>
                                <button type="button" class="btn btn-xs btn-default" ng-click="copyErrorCode()" style="margin-left: 10px;">
                                    <i class="glyphicon glyphicon-copy"></i> Copiar
                                </button>
                            </small>
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-default" ng-click="$dismiss()">Fechar</button>
                </div>
            `,
            controller: function($scope, $uibModalInstance) {
                $scope.$dismiss = function() {
                    $uibModalInstance.dismiss();
                };
                
                $scope.copyErrorCode = function() {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(errorCode).then(function() {
                            // Mostrar feedback visual
                            const button = event.target.closest('button');
                            const originalText = button.innerHTML;
                            button.innerHTML = '<i class="glyphicon glyphicon-ok"></i> Copiado!';
                            button.classList.add('btn-success');
                            button.classList.remove('btn-default');
                            
                            setTimeout(function() {
                                button.innerHTML = originalText;
                                button.classList.remove('btn-success');
                                button.classList.add('btn-default');
                            }, 2000);
                        }).catch(function() {
                            // Fallback para navegadores mais antigos
                            const textArea = document.createElement('textarea');
                            textArea.value = errorCode;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                        });
                    }
                };
            }
        });

        return modalInstance.result;
    };

    /**
     * Exibe um diálogo de confirmação com botões Sim/Não
     */
    service.confirm = function(message, title) {
        const deferred = $q.defer();
        
        const modalInstance = $uibModal.open({
            animation: true,
            backdrop: 'static',
            keyboard: true,
            windowClass: 'notification-modal notification-confirm',
            size: 'md',
            template: `
                <div class="modal-header" style="background-color: ${COLORS.confirm}; color: white;">
                    <button type="button" class="close" ng-click="cancel()" style="color: white; opacity: 0.8;">
                        <span aria-hidden="true">&times;</span>
                    </button>
                    <h4 class="modal-title">
                        <i class="glyphicon ${ICONS.confirm}"></i>
                        ${title || 'Confirmação'}
                    </h4>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" ng-click="confirm()">
                        <i class="glyphicon glyphicon-ok"></i> Sim
                    </button>
                    <button class="btn btn-default" ng-click="cancel()">
                        <i class="glyphicon glyphicon-remove"></i> Não
                    </button>
                </div>
            `,
            controller: function($scope, $uibModalInstance) {
                $scope.confirm = function() {
                    $uibModalInstance.close(true);
                };
                
                $scope.cancel = function() {
                    $uibModalInstance.dismiss(false);
                };
            }
        });

        modalInstance.result.then(
            function() { deferred.resolve(true); },
            function() { deferred.resolve(false); }
        );

        return deferred.promise;
    };

    /**
     * Atalhos para tipos específicos
     */
    service.success = function(message, title, errorCode) {
        return service.alert(message, title, TYPES.SUCCESS, errorCode);
    };

    service.error = function(message, title, errorCode) {
        return service.alert(message, title, TYPES.ERROR, errorCode);
    };

    service.warning = function(message, title, errorCode) {
        return service.alert(message, title, TYPES.WARNING, errorCode);
    };

    service.info = function(message, title, errorCode) {
        return service.alert(message, title, TYPES.INFO, errorCode);
    };

    /**
     * Método genérico show - mapeia tipos para os métodos específicos
     */
    service.show = function(message, type = TYPES.INFO, title) {
        type = type.toLowerCase();
        switch(type) {
            case TYPES.SUCCESS:
                return service.success(message, title);
            case TYPES.ERROR:
                return service.error(message, title);
            case TYPES.WARNING:
                return service.warning(message, title);
            case TYPES.INFO:
            default:
                return service.info(message, title);
        }
    };

    /**
     * Método para processar erros do servidor e extrair código de erro
     */
    service.handleServerError = function(error, defaultMessage = 'Erro interno do servidor') {
        let message = defaultMessage;
        let errorCode = null;
        
        if (error && error.data) {
            message = error.data.error || error.data.message || defaultMessage;
            errorCode = error.data.errorCode;
        } else if (error && error.message) {
            message = error.message;
            errorCode = error.errorCode;
        }
        
        return service.error(message, 'Erro', errorCode);
    };

    /**
     * Exibe um diálogo com campo de entrada
     */
    service.prompt = function(message, title, defaultValue = '') {
        const deferred = $q.defer();
        
        const modalInstance = $uibModal.open({
            animation: true,
            backdrop: 'static',
            keyboard: true,
            windowClass: 'notification-modal notification-prompt',
            size: 'md',
            template: `
                <div class="modal-header" style="background-color: ${COLORS.info}; color: white;">
                    <button type="button" class="close" ng-click="cancel()" style="color: white; opacity: 0.8;">
                        <span aria-hidden="true">&times;</span>
                    </button>
                    <h4 class="modal-title">
                        <i class="glyphicon glyphicon-pencil"></i>
                        ${title || 'Digite um valor'}
                    </h4>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                    <input type="text" class="form-control" ng-model="inputValue" 
                           ng-keypress="($event.charCode === 13) && confirm()">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" ng-click="confirm()">
                        <i class="glyphicon glyphicon-ok"></i> OK
                    </button>
                    <button class="btn btn-default" ng-click="cancel()">
                        <i class="glyphicon glyphicon-remove"></i> Cancelar
                    </button>
                </div>
            `,
            controller: function($scope, $uibModalInstance) {
                $scope.inputValue = defaultValue;
                
                $scope.confirm = function() {
                    $uibModalInstance.close($scope.inputValue);
                };
                
                $scope.cancel = function() {
                    $uibModalInstance.dismiss(null);
                };
            }
        });

        modalInstance.result.then(
            function(value) { deferred.resolve(value); },
            function() { deferred.resolve(null); }
        );

        return deferred.promise;
    };

    /**
     * Exibe um diálogo de progresso
     */
    service.progress = function(title, message) {
        const modalInstance = $uibModal.open({
            animation: true,
            backdrop: 'static',
            keyboard: false,
            windowClass: 'notification-modal notification-progress',
            size: 'md',
            template: `
                <div class="modal-header" style="background-color: ${COLORS.info}; color: white;">
                    <h4 class="modal-title">
                        <i class="glyphicon glyphicon-time"></i>
                        ${title || 'Processando...'}
                    </h4>
                </div>
                <div class="modal-body">
                    <p>${message || 'Por favor, aguarde...'}</p>
                    <div class="progress">
                        <div class="progress-bar progress-bar-striped active" style="width: 100%"></div>
                    </div>
                </div>
            `,
            controller: function($scope, $uibModalInstance) {
                $scope.close = function() {
                    $uibModalInstance.close();
                };
            }
        });

        return {
            close: function() {
                modalInstance.close();
            },
            update: function(newMessage) {
                // Atualizar mensagem se necessário
            }
        };
    };

    /**
     * Função auxiliar para obter título padrão baseado no tipo
     */
    function getDefaultTitle(type) {
        const titles = {
            success: 'Sucesso',
            error: 'Erro',
            warning: 'Atenção',
            info: 'Informação',
            confirm: 'Confirmação'
        };
        return titles[type] || 'Notificação';
    }

    return service;
});