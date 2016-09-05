Application
	.service('requester', function ($http) {

		this.servicePrefix = 'service/';

		this._parseParams = function(params) {
			var result = '';

			if(params.length > 0)
				result = '?'

			for(var key in params) {
				
				if(result.indexOf('&') > 0) {
					result += "&"
				}

				result += key + '=' + params[key] + '&';
			}

			return result;
		}

		this._put = function(url, params, callback)	{

			url = this.servicePrefix + url;
			if (typeof params === "function") {
				callback = params;
				params = [];
			}

			$http.put(url, params).success(function(response){
        callback(response);
      }.bind(this));
		}

		this._post = function(url, params, callback)	{

			url = this.servicePrefix + url;
			if (typeof params === "function") {
				callback = params;
				params = [];
			}
			
			$http.post(url, params).success(function(response){
        callback(response);
      }.bind(this));
		}

		this._get = function(url, params, callback)	{
			
			url = this.servicePrefix + url;			
			if (typeof params === "function") {
				callback = params;
				params = [];
			}

      url += this._parseParams(params);
			$http.get(url).success(function(response){
        callback(response);
      }.bind(this));
		}

		this._delete = function(url, params, callback)	{

			url = this.servicePrefix + url;
			if (typeof params === "function") {
				callback = params;
				params = [];
			}

			$http.delete(url).success(function(response){
        callback(response);
      }.bind(this));
		}

  });