'use strict';
Application
	.filter('notNull', function() {
		return function(text, empty) {
			empty = (!empty) ? '' : empty;
			return text || empty;			
		};
	})
	.filter('capitalize', function () {
		return function (text) {
			if (!text) {
				return '';
			}
			return String(text).toLowerCase().replace(/^.|\s\S/g, function(a) { 
				return a.toUpperCase(); 
			});
		};
	})
	.filter('truncate', function() {
		return function(text, length, end) {

			if (text === undefined || text === null) {
				return '';
			}
			if (length === undefined || isNaN(length)) {
				length = 10;
			}
			if (end === undefined) {
				end = '...';
			}
			
			if ((text.length <= length) || (text.length - end.length <= length)) {
				return text;
			} else {
				return String(text).substring(0, length - end.length) + end;
			}
		};
	})
	.filter('range', function() {
	  return function(input, total, startFromOne) {
	    total = parseInt(total);
	    for (var i=(startFromOne) ? 1 : 0; i<=total; i++)
	      input.push(i);
	    return input;
	  }
	});