const axios = require("axios");
const https = require("https");

module.exports = function (app) {

    const collections = app.repository.tSCollections;
    let Timeseries = {};
    
    // Get tiles API service from app
    const tilesApi = app.services.tilesApiService;
    const logger = app.services.logger;

    const agent = new https.Agent({
        rejectUnauthorized: false, // ⚠️ Desabilita a verificação SSL (uso temporário)
    });

    Timeseries.getLandsatNdviByLonLat = function (request, response) {
        const {lon, lat, campaign} =  request.query;

        let filter = {};

        if(lon && lat && campaign){
            filter = {
                "geom":{
                    "$geoIntersects": {
                        "$geometry":  {
                            "type":"Point",
                            "coordinates": [ Number(lon), Number(lat)],
                        }
                    }
                }
            }
        } else {
            logger.error("lon lat not found", {
                module: 'timeseries',
                function: 'getLandsatNdviByLonLat',
                req: request
            });
            response.end()
        }
        if(collections[campaign]){
            collections[campaign].find(filter, {"_id": 0, "geom": 0}).toArray((err, ts) => {
                if (err) {
                    logger.error("Error fetching Landsat NDVI timeseries", {
                        module: 'timeseries',
                        function: 'getLandsatNdviByLonLat',
                        metadata: { error: err.message, lon, lat, campaign },
                        req: request
                    });
                    response.end()
                } else {
                    response.send(ts);
                    response.end();
                }
            });
        } else{
            response.end()
        }
    }
    
    Timeseries.allTimeseries = (point, campaign) => {
       return new Promise((resolve, reject) => {
           const filter = {
               "geom":{
                   "$geoIntersects": {
                       "$geometry":  point['_id']['geom']
                   }
               }
           }
           collections[campaign].find(filter, {"_id": 0, "geom": 0}).toArray((err, ts) => {
               if (err) {
                   reject(err)
               } else {
                   resolve({
                       geometry: point['_id']['geom'],
                       ts: ts
                   })
               }
           });
       })
    };
    
    Timeseries.landsatNdviByGeometry = function (request, response) {
        const {campaign, geom} =  request.body;
        let filter = {};

        if(geom){
            filter = [
                {$match: { "geom": { $geoIntersects: { $geometry: geom } } } },
                {$group: { _id : {"geom": "$geom"} }}
            ]
        } else {
            console.error("geom not found")
            response.end()
        }

        if(collections[campaign]){
            collections[campaign].aggregate(filter).toArray((err, points) => {
                if (err) {
                    console.error(err)
                    response.end()
                } else {

                   const tsPromises = points.map(point => {
                       return Timeseries.allTimeseries(point, campaign)
                   });

                   Promise.all(tsPromises).then(timeseries =>{
                       response.send(timeseries);
                       response.end();
                   }).catch(err => {
                       console.error(err)
                       response.end();
                   })
                }
            });
        } else{
            response.end()
        }
    }

    Timeseries.getTimeSeriesLandsatNdviByLonLat = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            await logger.error("lon lat not found", {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNdviByLonLat',
                req: request
            });
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getLandsatTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // Fallback to legacy URL
                const baseUrl = app.config.tilesApi.baseUrl;
                const url = `${baseUrl}/api/timeseries/landsat/${lat}/${lon}`;
                
                const res = await axios.get(url, {
                    headers: {
                        "User-Agent": "Node.js",
                    },
                    httpsAgent: agent,
                    params: { data_inicio, data_fim }
                });

                response.status(200).send(res.data);
            }
        } catch (error) {
            await logger.error("Error fetching timeseries", {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNdviByLonLat',
                metadata: { error: error.message, lon, lat, data_inicio, data_fim },
                req: request
            });
            response.status(500).send({ 
                error: "Failed to fetch timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLat = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getNddiTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // Fallback to legacy URL
                const baseUrl = app.config.tilesApi.baseUrl;
                const url = `${baseUrl}/api/timeseries/nddi/${lat}/${lon}`;
                
                const res = await axios.get(url, {
                    headers: {
                        "User-Agent": "Node.js",
                    },
                    httpsAgent: agent,
                    params: { data_inicio, data_fim }
                });

                response.status(200).send(res.data);
            }
        } catch (error) {
            console.error("Error fetching timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    // New methods for Sentinel-2 and MODIS timeseries
    Timeseries.getTimeSeriesSentinel2ByLonLat = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getSentinelTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // For legacy, we might not have Sentinel-2 endpoint
                response.status(501).send({ 
                    error: "Sentinel-2 timeseries not available in legacy API" 
                });
            }
        } catch (error) {
            console.error("Error fetching Sentinel-2 timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch Sentinel-2 timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    Timeseries.getTimeSeriesModisByLonLat = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getModisTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // For legacy, we might not have MODIS endpoint
                response.status(501).send({ 
                    error: "MODIS timeseries not available in legacy API" 
                });
            }
        } catch (error) {
            console.error("Error fetching MODIS timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch MODIS timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    // ===== MÉTODOS ADMIN (sem dependência de sessão) =====
    
    Timeseries.getTimeSeriesLandsatNdviByLonLatAdmin = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getLandsatTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // Fallback to legacy URL
                const baseUrl = app.config.tilesApi.baseUrl;
                const url = `${baseUrl}/api/timeseries/landsat/${lat}/${lon}`;
                
                const res = await axios.get(url, {
                    headers: {
                        "User-Agent": "Node.js",
                    },
                    httpsAgent: agent,
                    params: { data_inicio, data_fim }
                });

                response.status(200).send(res.data);
            }
        } catch (error) {
            console.error("Admin - Error fetching timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLatAdmin = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getNddiTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                // Fallback to legacy URL
                const baseUrl = app.config.tilesApi.baseUrl;
                const url = `${baseUrl}/api/timeseries/nddi/${lat}/${lon}`;
                
                const res = await axios.get(url, {
                    headers: {
                        "User-Agent": "Node.js",
                    },
                    httpsAgent: agent,
                    params: { data_inicio, data_fim }
                });

                response.status(200).send(res.data);
            }
        } catch (error) {
            console.error("Admin - Error fetching timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    // Admin methods for new timeseries types
    Timeseries.getTimeSeriesSentinel2ByLonLatAdmin = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getSentinelTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                response.status(501).send({ 
                    error: "Sentinel-2 timeseries not available in legacy API" 
                });
            }
        } catch (error) {
            console.error("Admin - Error fetching Sentinel-2 timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch Sentinel-2 timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    Timeseries.getTimeSeriesModisByLonLatAdmin = async function (request, response) {
        const { lon, lat, data_inicio, data_fim } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        try {
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                const params = {};
                if (data_inicio) params.data_inicio = data_inicio;
                if (data_fim) params.data_fim = data_fim;
                
                const result = await tilesApi.getModisTimeseries(lat, lon, params, request);
                response.status(200).send(result);
            } else {
                response.status(501).send({ 
                    error: "MODIS timeseries not available in legacy API" 
                });
            }
        } catch (error) {
            console.error("Admin - Error fetching MODIS timeseries:", error.message);
            response.status(500).send({ 
                error: "Failed to fetch MODIS timeseries data",
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    return Timeseries;

}