// db.getCollection('mosaics').find({'dates.path': 220, 'dates.row': 70 },{ dates: {$elemMatch: {row: 70, path: 220 }}})
Application
    .service('requester', function ($http) {

        this.servicePrefix = 'service/';

        this._parseParams = function (params) {
            var result = '';

            // Verificar se params é um objeto com propriedades
            if (params && Object.keys(params).length > 0) {
                result += '?';

                for (var key in params) {
                    if (params.hasOwnProperty(key) && params[key] !== null && params[key] !== undefined) {
                        result += key + '=' + encodeURIComponent(params[key]) + '&';
                    }
                }
                result = result.slice(0, -1); // Remove o último &
            }

            return result;
        }

        this._getCacheApiHeaders = function () {
            // For now, let session-based authentication handle this in the backend
            // The admin is already logged in, so the backend should have access to credentials
            return {};
        }

        this._put = function (url, params, callback) {

            url = this.servicePrefix + url;
            if (typeof params === "function") {
                callback = params;
                params = [];
            }
            
            // Add authentication headers for cache API endpoints
            var config = {};
            if (url.includes('/api/cache/') || url.includes('/api/tasks/') || url.includes('/api/vis-params/')) {
                config.headers = this._getCacheApiHeaders();
            }

            $http.put(url, params, config).success(function (response) {
                callback(response);
            }.bind(this)).error(function(error) {
                if (callback.error) {
                    callback.error(error);
                }
            });
        }

        this._post = function (url, params, callback) {

            url = this.servicePrefix + url;
            if (typeof params === "function") {
                callback = params;
                params = [];
            }
            
            // Add authentication headers for cache API endpoints
            var config = {};
            if (url.includes('/api/cache/') || url.includes('/api/tasks/') || url.includes('/api/vis-params/')) {
                config.headers = this._getCacheApiHeaders();
            }
            
            $http.post(url, params, config).success(function (response) {
                callback(response);
            }.bind(this));
        }

        this._get = function (url, params, callback) {

            url = this.servicePrefix + url;
            if (typeof params === "function") {
                callback = params;
                params = [];
            }

            url += this._parseParams(params);
            
            // Remove debug logging

            // Add authentication headers for cache API endpoints
            var config = {};
            if (url.includes('/api/cache/') || url.includes('/api/tasks/') || url.includes('/api/vis-params/')) {
                config.headers = this._getCacheApiHeaders();
            }

            $http.get(url, config).success(function (response) {
                // Success
                callback(response);
            }.bind(this)).error(function(error) {
                // Error
                if (callback.error) {
                    callback.error(error);
                }
            });
        }

        this._patch = function (url, params, callback) {

            url = this.servicePrefix + url;
            if (typeof params === "function") {
                callback = params;
                params = {};
            }
            
            // Remove debug logging
            
            // Add authentication headers for cache API endpoints
            var config = {};
            if (url.includes('/api/cache/') || url.includes('/api/tasks/') || url.includes('/api/vis-params/')) {
                config.headers = this._getCacheApiHeaders();
            }
            
            $http.patch(url, params, config).success(function (response) {
                // Success
                callback(response);
            }.bind(this)).error(function(error) {
                // Error
                if (callback.error) {
                    callback.error(error);
                }
            });
        }

        this._delete = function (url, params, callback) {

            url = this.servicePrefix + url;
            if (typeof params === "function") {
                callback = params;
                params = [];
            }

            url += this._parseParams(params);
            
            // Add authentication headers for cache API endpoints
            var config = {};
            if (url.includes('/api/cache/') || url.includes('/api/tasks/') || url.includes('/api/vis-params/')) {
                config.headers = this._getCacheApiHeaders();
            }
            
            $http.delete(url, config).success(function (response) {
                callback(response);
            }.bind(this));
        }
        
        // Task Management API methods
        this.getTasksList = function (callback) {
            this._get('/api/tasks/list', callback);
        }
        
        this.getTaskStatusById = function (taskId, callback) {
            this._get('/api/tasks/status/' + taskId, callback);
        }
        
        this.getWorkersStats = function (callback) {
            this._get('/api/tasks/workers', callback);
        }
        
        this.purgeTasks = function (params, callback) {
            this._post('/api/tasks/purge', params, callback);
        }
        
        this.getRegisteredTasks = function (callback) {
            this._get('/api/tasks/registered', callback);
        }
        
        this.getQueueLength = function (callback) {
            this._get('/api/tasks/queue-length', callback);
        }

    })
    .service('util', function ($rootScope, $interval) {

        this.waitUserData = function (callback) {

            var repeatedFn = function () {

                if ($rootScope.user != undefined) {
                    $interval.cancel(loop);
                    callback();
                }
            }

            loop = $interval(repeatedFn, 500, 10);
        }

        this._suport = function (pastagem, callback) {
            suportData = {};
            var totalArea;

            for (var i = 0; i < pastagem.length; i++) {

                if (pastagem[i].name === "BOV_QTDE") {
                    suportData["info"] = pastagem[i].info;
                    suportData["value"] = pastagem[i].value;
                } else if (pastagem[i].name === "POL_HA") {
                    totalArea = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                    suportData["area"] = pastagem[i].value;
                    totalArea = parseFloat(totalArea);
                } else if (pastagem[i].name === "ALG_APLAN") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["algodao"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["algodao"] = (relative.toFixed(2)) + "%";
                    }
                } else if (pastagem[i].name == "CAN_APLAN") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["cana"] = pastagem[i].value;
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["cana"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "MIL_APLAN") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["milho"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["milho"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "SOJ_APLAN") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["soja"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["soja"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "FOR_AREAHA") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["floresta"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["floresta"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "REM_AREAHA") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["vegetacao"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["vegetacao"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "DES08_AREAHA") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["desmatamento"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        suportData["desmatamento"] = value + " ha";
                    }
                } else if (pastagem[i].name == "ATV_AMBIEN") {
                    if (pastagem[i].value === "Sem inform.") {
                        suportData["ativos"] = pastagem[i].value
                    } else {
                        var value = pastagem[i].value.replace(" ha", "").replace(/\./g, "");
                        var relative = 100 * (parseFloat(value) / totalArea)
                        suportData["ativos"] = (relative.toFixed(2)) + "%"
                    }
                } else if (pastagem[i].name == "LEI_LITROS") {
                    suportData["leite"] = pastagem[i].value
                }

            }


        }
    })
    .service('capabilitiesService', function ($http, $q) {
        var self = this;
        self.cacheAll = null;
        self.cacheSentinel = null;
        self.promise = null;

        // Método genérico para obter todas as capabilities
        this.getAllCapabilities = function () {
            // Se já temos cache, retornar imediatamente
            if (self.cacheAll) {
                return $q.resolve(self.cacheAll);
            }

            // Se já existe uma requisição em andamento, retornar a mesma promise
            if (self.promise) {
                return self.promise;
            }

            // Fazer nova requisição e cachear
            self.promise = $http.get('/service/capabilities')
                .then(function (response) {
                    self.cacheAll = response.data || [];
                    self.promise = null; // Limpar promise após conclusão
                    return self.cacheAll;
                })
                .catch(function (error) {
                    self.promise = null; // Limpar promise em caso de erro
                    throw error;
                });

            return self.promise;
        };

        // Método específico para Sentinel (mantido para compatibilidade)
        this.getCapabilities = function () {
            // Se já temos cache do Sentinel, retornar imediatamente
            if (self.cacheSentinel) {
                return $q.resolve(self.cacheSentinel);
            }

            // Buscar todas as capabilities e filtrar
            return self.getAllCapabilities().then(function(allCapabilities) {
                // Filtrar apenas capabilities do Sentinel
                if (Array.isArray(allCapabilities)) {
                    self.cacheSentinel = allCapabilities.filter(function(cap) {
                        return cap.satellite === 'sentinel';
                    });
                } else {
                    self.cacheSentinel = [];
                }
                return self.cacheSentinel;
            });
        };

        // Método para obter capabilities por satélite
        this.getCapabilitiesBySatellite = function(satellite) {
            return self.getAllCapabilities().then(function(allCapabilities) {
                if (Array.isArray(allCapabilities)) {
                    return allCapabilities.filter(function(cap) {
                        return cap.satellite === satellite;
                    });
                }
                return [];
            });
        };

        // Método para limpar cache se necessário
        this.clearCache = function () {
            self.cacheAll = null;
            self.cacheSentinel = null;
            self.promise = null;
        };
    })
    .service('imageTypeHelper', function() {
        // Função helper para detectar se é Sentinel
        this.isSentinelImageType = function(imageType) {
            if (!imageType) return false;
            
            const normalizedType = imageType.toLowerCase();
            return normalizedType === 'sentinel-2' || 
                   normalizedType === 'sentinel-2-l2a' || 
                   normalizedType.includes('sentinel');
        };
        
        // Função helper para detectar se é Landsat
        this.isLandsatImageType = function(imageType) {
            if (!imageType) return true; // Default é Landsat
            
            const normalizedType = imageType.toLowerCase();
            return normalizedType === 'landsat' || 
                   normalizedType.includes('landsat');
        };
        
        // Função helper para detectar se é Planet
        this.isPlanetImageType = function(imageType) {
            if (!imageType) return false;
            
            const normalizedType = imageType.toLowerCase();
            return normalizedType === 'planet' || 
                   normalizedType.includes('planet');
        };
    })
    .service('fakeRequester', function () {

        this.nextPoints = function (callback) {
            var fakeData = {
                "_id": "0_teste",
                "campaign": "teste",
                "lon": -46.0502335589266,
                "lat": -3.29039269406991,
                "dateImport": new Date("2017-06-06"),
                "biome": "CERRADO",
                "uf": "MG",
                "county": "Santa Fé de Minas",
                "countyCode": "3157609",
                "path": 220,
                "row": 72,
                "dates": {
                    "L5_2002_DRY": "2002-07-24",
                    "L7_2000_WET": "2000-02-17",
                    "L7_2000_DRY": "2000-06-08",
                    "L5_2000_WET": "2000-04-29",
                    "L5_2000_DRY": "2000-06-16",
                    "L7_2001_WET": "2001-02-19",
                    "L7_2001_DRY": "2001-06-11",
                    "L5_2001_WET": "2001-04-16",
                    "L5_2002_WET": "2002-03-02",
                    "L7_2004_WET": "2004-03-31",
                    "L5_2001_DRY": "2001-07-05",
                    "L7_2002_WET": "2002-04-27",
                    "L7_2002_DRY": "2002-08-17",
                    "L7_2003_WET": "2003-02-25",
                    "L7_2003_DRY": "2003-08-20",
                    "L5_2003_DRY": "2003-07-11",
                    "L7_2004_DRY": "2004-08-22",
                    "L5_2004_WET": "2004-04-24",
                    "L5_2004_DRY": "2004-06-27",
                    "L7_2005_WET": "2005-04-03",
                    "L7_2005_DRY": "2005-07-24",
                    "L5_2005_WET": "2005-04-11",
                    "L5_2005_DRY": "2005-08-01",
                    "L7_2006_WET": "2006-04-22",
                    "L7_2006_DRY": "2006-07-11",
                    "L5_2006_WET": "2006-04-14",
                    "L5_2006_DRY": "2006-06-01",
                    "L7_2007_WET": "2007-04-25",
                    "L7_2007_DRY": "2007-06-12",
                    "L5_2007_WET": "2007-04-01",
                    "L5_2007_DRY": "2007-07-22",
                    "L7_2008_WET": "2008-04-27",
                    "L7_2008_DRY": "2008-06-14",
                    "L5_2008_WET": "2008-04-03",
                    "L5_2008_DRY": "2008-06-06",
                    "L7_2009_WET": "2009-04-14",
                    "L7_2009_DRY": "2009-07-03",
                    "L5_2009_WET": "2009-03-05",
                    "L5_2009_DRY": "2009-06-25",
                    "L7_2010_WET": "2010-04-17",
                    "L7_2010_DRY": "2010-06-20",
                    "L5_2010_WET": "2010-02-04",
                    "L5_2010_DRY": "2010-06-12",
                    "L5_2011_WET": "2011-04-12",
                    "L7_2011_WET": "2011-04-20",
                    "L7_2011_DRY": "2011-06-07",
                    "L5_2011_DRY": "2011-07-17",
                    "L7_2012_WET": "2012-03-05",
                    "L7_2012_DRY": "2012-07-11",
                    "L8_2013_WET": "2013-04-17",
                    "L8_2013_DRY": "2013-07-06",
                    "L7_2013_WET": "2013-03-08",
                    "L7_2013_DRY": "2013-06-12",
                    "L8_2014_WET": "2014-03-19",
                    "L8_2014_DRY": "2014-08-26",
                    "L7_2014_WET": "2014-01-06",
                    "L7_2014_DRY": "2014-07-01",
                    "L8_2015_WET": "2015-03-06",
                    "L8_2015_DRY": "2015-06-10",
                    "L7_2015_WET": "2015-01-09",
                    "L7_2015_DRY": "2015-07-04",
                    "L8_2016_WET": "2016-04-09",
                    "L8_2016_DRY": "2016-07-14",
                    "L7_2016_WET": "2016-04-01",
                    "L7_2016_DRY": "2016-07-06"
                },
                "userName": [],
                "landUse": [],
                "counter": [],
                "underInspection": 0,
                "index": 0,
                "cached": false
            }
            callback(fakeData);
        }

    });
