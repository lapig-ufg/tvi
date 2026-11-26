'use strict';

angular.module('application').directive('bdcComparison', function () {
    return {
        restrict: 'E',
        scope: { selection: '=', point: '=', config: '=', profile: '=', onClose: '&', onViewed: '&?' },
        templateUrl: 'views/bdc-comparison.tpl.html',
        link: function (scope, element) {
            scope.fullscreen = function () {
                var node = element[0].querySelector('.bdc-comparison');
                if (node && node.requestFullscreen) {
                    var result = node.requestFullscreen();
                    if (result && result.catch) result.catch(function () {});
                }
            };
        }
    };
});
