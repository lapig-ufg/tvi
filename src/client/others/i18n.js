'use strict';

// Simple i18n service for TVI application
Application.factory('i18nService', function($http, $rootScope, $q) {
    // Initializing i18n service
    var service = {
        currentLanguage: 'pt-BR',
        translations: {},
        fallbackLanguage: 'en',
        loadingPromises: {}
    };
    
    // Load translation file
    service.loadTranslations = function(lang) {
        // Return cached promise if already loading
        if (service.loadingPromises[lang]) {
            return service.loadingPromises[lang];
        }
        
        // Return resolved promise if already loaded
        if (service.translations[lang]) {
            return $q.resolve(service.translations[lang]);
        }
        
        // Loading translations for language
        service.loadingPromises[lang] = $http.get('i18n/' + lang + '.json').then(function(response) {
            // Successfully loaded translations
            service.translations[lang] = response.data;
            delete service.loadingPromises[lang];
            return response.data;
        }).catch(function(error) {
            console.error('[i18n] Error loading translations for', lang, ':', error);
            delete service.loadingPromises[lang];
            return null;
        });
        
        return service.loadingPromises[lang];
    };
    
    // Set current language
    service.setLanguage = function(lang) {
        // Setting language
        service.currentLanguage = lang;
        localStorage.setItem('tvi-language', lang);
        
        // Load translations if not already loaded
        if (!service.translations[lang]) {
            return service.loadTranslations(lang).then(function() {
                // Language loaded and set
                $rootScope.$broadcast('languageChanged', lang);
                return lang;
            });
        } else {
            // Language already loaded, broadcasting change
            $rootScope.$broadcast('languageChanged', lang);
            return $q.resolve(lang);
        }
    };
    
    // Get translation
    service.translate = function(key) {
        var keys = key.split('.');
        var current = service.translations[service.currentLanguage];
        
        if (!current) {
            // No translations loaded for language, using key as fallback
            return key; // Return key if no translations loaded
        }
        
        // Navigate through nested keys
        for (var i = 0; i < keys.length; i++) {
            if (current[keys[i]]) {
                current = current[keys[i]];
            } else {
                // Try fallback language
                current = service.translations[service.fallbackLanguage];
                if (current) {
                    for (var j = 0; j < keys.length; j++) {
                        if (current[keys[j]]) {
                            current = current[keys[j]];
                        } else {
                            return key; // Return key if not found
                        }
                    }
                    return current;
                }
                return key; // Return key if not found
            }
        }
        
        return current;
    };
    
    // Ensure translations are loaded
    service.ensureLoaded = function() {
        var promises = [];
        
        // Ensure current language is loaded
        promises.push(service.loadTranslations(service.currentLanguage));
        
        // Ensure fallback language is loaded
        if (service.currentLanguage !== service.fallbackLanguage) {
            promises.push(service.loadTranslations(service.fallbackLanguage));
        }
        
        return $q.all(promises);
    };
    
    // Function to detect browser language
    service.detectBrowserLanguage = function() {
        var browserLang = navigator.language || navigator.userLanguage || 'pt-BR';
        // Browser language detected
        
        // Map browser language codes to our supported languages
        if (browserLang.toLowerCase().startsWith('pt')) {
            return 'pt-BR';
        } else if (browserLang.toLowerCase().startsWith('en')) {
            return 'en';
        }
        
        // Default to Portuguese if not supported
        return 'pt-BR';
    };
    
    // Initialize with saved language or browser language
    var savedLang = localStorage.getItem('tvi-language');
    if (!savedLang) {
        savedLang = service.detectBrowserLanguage();
        // No saved language, using browser language
    } else {
        // Using saved language
    }
    
    service.currentLanguage = savedLang;
    
    // Pre-load both languages
    service.loadTranslations(savedLang);
    service.loadTranslations(service.fallbackLanguage);
    
    return service;
});

// i18n filter
Application.filter('i18n', function(i18nService, $rootScope) {
    var filter = function(key) {
        return i18nService.translate(key);
    };
    
    // Make filter stateful so it updates when language changes
    filter.$stateful = true;
    
    return filter;
});

// i18n directive for dynamic translations
Application.directive('i18n', function(i18nService) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            function updateTranslation() {
                var key = attrs.i18n || element.text();
                element.text(i18nService.translate(key));
            }
            
            // Initial translation
            updateTranslation();
            
            // Update on language change
            scope.$on('languageChanged', updateTranslation);
        }
    };
});