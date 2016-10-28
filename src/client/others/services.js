Application
	.service('requester', function ($http) {

		this.servicePrefix = 'service/';

		this._parseParams = function(params) {
			var result = '';

			if(params.length > 0)
				console.log('oi')
				result += '?'

			for(var key in params) {

				result += key + '=' + params[key] + '&';
			}
			result = result.slice(0, -1);

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

  })
  .service('util', function () {
  	this._suport = function(pastagem, callback){
  		suportData = {};
  		var totalArea;

  		for(var i = 0; i < pastagem.length; i++){

				if(pastagem[i].name === "BOV_QTDE"){
					suportData["info"] = pastagem[i].info;
					suportData["value"] = pastagem[i].value;
				}else if(pastagem[i].name === "POL_HA"){
					totalArea = pastagem[i].value.replace(" ha", "");			
					suportData["area"] = pastagem[i].value;
					totalArea = parseFloat(totalArea);
				}else if(pastagem[i].name === "ALG_APLAN"){
					if(pastagem[i].value === "Sem inform."){
						suportData["algodao"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "")
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["algodao"] = (relative.toFixed(2))+"%";
					}
				}else if(pastagem[i].name == "CAN_APLAN"){
					if(pastagem[i].value === "Sem inform."){
						suportData["cana"] = pastagem[i].value;
					}else{
						var value = pastagem[i].value.replace(" ha", "")
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["cana"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "MIL_APLAN"){
					if(pastagem[i].value === "Sem inform."){
						suportData["milho"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "")
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["milho"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "SOJ_APLAN"){
					if(pastagem[i].value === "Sem inform."){
						suportData["soja"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "")
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["soja"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "FOR_AREAHA"){
					if(pastagem[i].value === "Sem inform."){
						suportData["floresta"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "");
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["floresta"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "REM_AREAHA"){
					if(pastagem[i].value === "Sem inform."){
						suportData["vegetacao"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "");
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["vegetacao"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "DES08_AREAHA"){
					if(pastagem[i].value === "Sem inform."){
						suportData["desmatamento"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "");
						suportData["desmatamento"] = value+ " mha";
					}
				}else if(pastagem[i].name == "ATV_AMBIEN"){
					if(pastagem[i].value === "Sem inform."){
						suportData["ativos"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "");
						var relative = 100*(parseFloat(value)/totalArea)
						suportData["ativos"] = (relative.toFixed(2))+"%"
					}
				}else if(pastagem[i].name == "LEI_LITROS"){
					if(pastagem[i].value === "Sem inform."){
						suportData["leite"] = pastagem[i].value
					}else{
						var value = pastagem[i].value.replace(" ha", "");						
						suportData["leite"] = value
					}
				}

			}

			callback(suportData);

  	}	
  });
