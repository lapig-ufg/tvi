'use strict';

Application.directive('adminPageContent', function($templateRequest, $controller, $compile) {
    return {
        restrict: 'A',
        scope: true,
        link: function(scope, element) {
            var destroyed = false;
            var page = scope.page;
            function markDirty() {
                if (!page.definition.editable || page.definition.editState || destroyed) return;
                scope.$evalAsync(function() { if (!destroyed) page.dirty = true; });
            }
            element.on('input change', markDirty);
            scope.$on('$destroy', function() {
                destroyed = true;
                element.off('input change', markDirty);
            });
            $templateRequest(page.definition.templateUrl).then(function(template) {
                if (destroyed) return;
                scope.$close = page.context.close;
                scope.$dismiss = page.context.dismiss;
                // O controlador e os campos compartilham o escopo para evitar valores primitivos ocultados por escopos filhos.
                $controller(page.definition.controller, angular.extend({}, page.locals, {
                    $scope: scope, $uibModalInstance: page.context
                }));
                page.operationPending = function() {
                    return !destroyed && !!(page.definition.pending && page.definition.pending(scope));
                };
                if (page.definition.editState) {
                    var baseline = angular.copy(page.definition.editState(scope));
                    scope.$watch(function() { return page.definition.editState(scope); }, function(current) {
                        page.dirty = !angular.equals(current, baseline);
                    }, true);
                }
                element.html(template);
                $compile(element.contents())(scope);
            }).catch(function() {
                if (!destroyed) page.error = 'Não foi possível abrir o formulário. Retorne à listagem e tente novamente.';
            });
        }
    };
});
