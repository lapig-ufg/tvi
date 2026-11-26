'use strict';

Application.directive('adminNotifications', function(AdminNotifications, $location) {
    return {
        restrict: 'E',
        templateUrl: 'views/admin-notifications.tpl.html',
        link: function(scope, element) {
            scope.notices = AdminNotifications;
            scope.isAdministrativePage = function() { return $location.path().indexOf('/admin') === 0; };
            var stop = scope.$watchCollection(function() { return AdminNotifications.items; }, function(items) {
                var question = items.some(function(item) { return item.kind === 'confirm' || item.kind === 'prompt'; });
                if (question && element[0].scrollIntoView) element[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
            });
            scope.$on('$destroy', stop);
        }
    };
});
