/*!
 * angular-translate - v2.15.2 - 2017-06-22
 * 
 * Copyright (c) 2017 The angular-translate team, Pascal Precht; Licensed MIT
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module unless amdModuleId is set
    define([], function () {
      return (factory());
    });
  } else if (typeof module === 'object' && module.exports) {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    factory();
  }
}(this, function () {

angular.module('pascalprecht.translate').factory('$translateDefaultInterpolation', ['$interpolate', function ($interpolate) {

  var $translateInterpolator = {},
      $locale,
      $identifier = 'default',
      $sanitizeValueStrategy = null,
      sanitizeValueStrategies = {
        escaped: function (value) {
          var result = angular.element('<div></div>').text(value).html();
          return result;
        }
      };

  var sanitizeParams = function (params) {
    var result;
    if (angular.isObject(params)) {
      result = angular.copy(params);
      angular.forEach(result, function (value, key) {
        result[key] = angular.element('<div></div>').text(value).html();
      });
    } else {
      result = angular.element('<div></div>').text(params).html();
    }
    return result;
  };

  var sanitizeUsingStrategy = function (value, mode, strategy) {
    strategy = strategy || $sanitizeValueStrategy;
    if (strategy === 'escaped') {
      value = sanitizeParams(value);
    }
    return value;
  };

  $translateInterpolator.setLocale = function (locale) {
    $locale = locale;
  };

  $translateInterpolator.getInterpolationIdentifier = function () {
    return $identifier;
  };

  $translateInterpolator.useSanitizeValueStrategy = function (strategy) {
    $sanitizeValueStrategy = strategy;
    return this;
  };

  $translateInterpolator.interpolate = function (string, interpolateParams, context, sanitizeStrategy) {
    interpolateParams = interpolateParams || {};
    interpolateParams = sanitizeUsingStrategy(interpolateParams, 'params', sanitizeStrategy);

    var interpolatedText;
    if (angular.isNumber(string)) {
      interpolatedText = '' + string;
    } else if (angular.isString(string)) {
      interpolatedText = $interpolate(string)(interpolateParams);
    } else {
      interpolatedText = '';
    }

    return interpolatedText;
  };

  return $translateInterpolator;
}]);

angular.module('pascalprecht.translate').constant('$STORAGE_KEY', 'NG_TRANSLATE_LANG_KEY');

}));