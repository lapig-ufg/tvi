'use strict';

Application.directive('languageSelector', function(i18nService, $rootScope, $timeout, $window) {
    return {
        restrict: 'E',
        replace: true,
        scope: {},
        template: '<div class="language-selector">' +
                    '<button class="btn btn-default btn-sm" ' +
                            'ng-class="{\'active\': currentLanguage === \'pt-BR\'}" ' +
                            'ng-click="selectLanguage(\'pt-BR\')" ' +
                            'title="Português">' +
                        'PT' +
                    '</button>' +
                    '<button class="btn btn-default btn-sm" ' +
                            'ng-class="{\'active\': currentLanguage === \'en\'}" ' +
                            'ng-click="selectLanguage(\'en\')" ' +
                            'title="English">' +
                        'EN' +
                    '</button>' +
                  '</div>',
        link: function(scope, element, attrs) {
            console.log('[language-selector] Initializing component');
            
            // Initialize with current language
            scope.currentLanguage = i18nService.currentLanguage;
            console.log('[language-selector] Current language:', scope.currentLanguage);
            
            // Function to select language
            scope.selectLanguage = function(lang) {
                console.log('[language-selector] Selecting language:', lang);
                var promise = i18nService.setLanguage(lang);
                
                if (promise && promise.then) {
                    promise.then(function() {
                        scope.currentLanguage = lang;
                        console.log('[language-selector] Language changed to:', lang);
                        // Force page reload to update all translations
                        $timeout(function() {
                            $window.location.reload();
                        }, 100);
                    });
                } else {
                    scope.currentLanguage = lang;
                    $timeout(function() {
                        $window.location.reload();
                    }, 100);
                }
            };
            
            // Listen for language changes
            var unregister = $rootScope.$on('languageChanged', function(event, lang) {
                console.log('[language-selector] Received language change event:', lang);
                scope.currentLanguage = lang;
                if (!scope.$$phase) {
                    scope.$apply();
                }
            });
            
            // Clean up on destroy
            scope.$on('$destroy', function() {
                unregister();
            });
        }
    };
});