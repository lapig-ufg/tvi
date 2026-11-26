'use strict';

Application.controller('AdminPageController', function($scope, $location, $q, page, NotificationDialog, $window) {
    var destroyed = false;
    var leaving = false;
    var confirmationPending = false;
    $scope.page = page;
    page.busy = false;
    page.dirty = false;
    page.operationPending = function() { return false; };
    page.isBusy = function() { return page.busy || page.operationPending(); };
    $scope.backToOrigin = function() {
        if (!page.isBusy()) $location.url(page.returnTo);
    };

    $scope.$on('$locationChangeStart', function(event) {
        if (leaving || destroyed) return;
        if (page.isBusy()) {
            event.preventDefault();
            return;
        }
        if (!page.dirty) return;
        var destination = $location.url();
        event.preventDefault();
        if (confirmationPending) return;
        confirmationPending = true;
        NotificationDialog.confirm('Há alterações não salvas. Deseja sair desta página?', 'Sair sem salvar').then(function(confirmed) {
            confirmationPending = false;
            if (confirmed && !destroyed && !page.isBusy()) {
                leaving = true;
                $location.url(destination);
            }
        });
    });
    function beforeUnload(event) {
        if (!page.dirty && !page.isBusy()) return;
        event.preventDefault();
        event.returnValue = '';
    }
    $window.addEventListener('beforeunload', beforeUnload);
    $scope.$on('$destroy', function() {
        destroyed = true;
        $window.removeEventListener('beforeunload', beforeUnload);
    });
    if (!page.definition) return;

    page.context = {
        dismiss: $scope.backToOrigin,
        close: function(result) {
            if (destroyed || page.busy) return;
            page.busy = true;
            page.error = null;
            return $q.when().then(function() {
                return page.definition.save ? page.definition.save(result, page.locals, page.params) : result;
            }).then(function() {
                if (!destroyed) {
                    page.dirty = false;
                    leaving = true;
                    $location.url(page.returnTo);
                }
            }).catch(function(error) {
                if (!destroyed) page.error = (error.data && (error.data.error || error.data.message)) ||
                    error.message || 'Não foi possível salvar. Os dados preenchidos foram mantidos.';
            }).finally(function() { if (!destroyed) page.busy = false; });
        }
    };
});
