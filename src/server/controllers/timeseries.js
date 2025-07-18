const axios = require("axios");
const https = require("https");

module.exports = function (app) {

    const collections = app.repository.tSCollections;
    const logger = app.services.logger;
    let Timeseries = {};

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
            logger.error('Lon lat not found', {
                module: 'timeseries',
                function: 'getLandsatNdviByLonLat',
                metadata: { lon, lat, campaign },
                req: request
            }).then(logId => {
                response.status(400).json({ error: 'Lon lat not found', logId });
            });
            return;
        }
        if(collections[campaign]){
            collections[campaign].find(filter, {"_id": 0, "geom": 0}).toArray((err, ts) => {
                if (err) {
                    logger.error('Database error fetching Landsat NDVI', {
                        module: 'timeseries',
                        function: 'getLandsatNdviByLonLat',
                        metadata: { error: err.message, lon, lat, campaign },
                        req: request
                    }).then(logId => {
                        response.status(500).json({ error: 'Database error', logId });
                    });
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
            logger.error('Geom not found', {
                module: 'timeseries',
                function: 'getSentinelNdviByLonLat',
                metadata: { lon, lat, campaign },
                req: request
            }).then(logId => {
                response.status(400).json({ error: 'Geom not found', logId });
            });
            return;
        }

        if(collections[campaign]){
            collections[campaign].aggregate(filter).toArray((err, points) => {
                if (err) {
                    logger.error('Database error fetching Sentinel NDVI', {
                        module: 'timeseries',
                        function: 'getSentinelNdviByLonLat',
                        metadata: { error: err.message, lon, lat, campaign },
                        req: request
                    }).then(logId => {
                        response.status(500).json({ error: 'Database error', logId });
                    });
                } else {

                   const tsPromises = points.map(point => {
                       return Timeseries.allTimeseries(point, campaign)
                   });

                   Promise.all(tsPromises).then(timeseries =>{
                       response.send(timeseries);
                       response.end();
                   }).catch(err => {
                       logger.error('Error mapping timeseries results', {
                           module: 'timeseries',
                           function: 'getSentinelNdviByLonLat',
                           metadata: { error: err.message },
                           req: request
                       }).then(logId => {
                           response.status(500).json({ error: 'Processing error', logId });
                       });
                   })
                }
            });
        } else{
            response.end()
        }
    }

    Timeseries.getTimeSeriesLandsatNdviByLonLat = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            const logId = await logger.error('Lon lat not found', {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNdviByLonLat',
                metadata: { lon, lat },
                req: request
            });
            return response.status(400).send({ error: "Longitude and latitude are required", logId });
        }

        const baseUrl = app.config.tilesApi.baseUrl;
        const url = `${baseUrl}/api/timeseries/landsat/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            const logId = await logger.error('Error fetching timeseries', {
                module: 'timeseries',
                function: request.route.path.includes('landsat') ? 'getTimeSeriesLandsatNdviByLonLat' : 'getTimeSeriesSentinelNdviByLonLat',
                metadata: { error: error.message, lon, lat },
                req: request
            });
            response.status(500).send({ error: "Failed to fetch timeseries data", logId });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLat = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            const logId = await logger.error('Lon lat not found', {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNDDIByLonLat',
                metadata: { lon, lat },
                req: request
            });
            return response.status(400).send({ error: "Longitude and latitude are required", logId });
        }

        const baseUrl = app.config.tilesApi.baseUrl;
        const url = `${baseUrl}/api/timeseries/nddi/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            const logId = await logger.error('Error fetching timeseries', {
                module: 'timeseries',
                function: request.route.path.includes('landsat') ? 'getTimeSeriesLandsatNdviByLonLat' : 'getTimeSeriesSentinelNdviByLonLat',
                metadata: { error: error.message, lon, lat },
                req: request
            });
            response.status(500).send({ error: "Failed to fetch timeseries data", logId });
        }
    };

    // ===== MÉTODOS ADMIN (sem dependência de sessão) =====
    
    Timeseries.getTimeSeriesLandsatNdviByLonLatAdmin = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            const logId = await logger.error('Admin - lon lat not found', {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNdviByLonLatAdmin',
                metadata: { lon, lat },
                req: request
            });
            return response.status(400).send({ error: "Longitude and latitude are required", logId });
        }

        const baseUrl = app.config.tilesApi.baseUrl;
        const url = `${baseUrl}/api/timeseries/landsat/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            const logId = await logger.error('Admin - Error fetching timeseries', {
                module: 'timeseries',
                function: request.route.path.includes('landsat') ? 'getTimeSeriesLandsatNdviByLonLatAdmin' : 'getTimeSeriesSentinelNdviByLonLatAdmin',
                metadata: { error: error.message, lon, lat },
                req: request
            });
            response.status(500).send({ error: "Failed to fetch timeseries data", logId });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLatAdmin = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            const logId = await logger.error('Admin - lon lat not found', {
                module: 'timeseries',
                function: 'getTimeSeriesLandsatNdviByLonLatAdmin',
                metadata: { lon, lat },
                req: request
            });
            return response.status(400).send({ error: "Longitude and latitude are required", logId });
        }

        const baseUrl = app.config.tilesApi.baseUrl;
        const url = `${baseUrl}/api/timeseries/nddi/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            const logId = await logger.error('Admin - Error fetching timeseries', {
                module: 'timeseries',
                function: request.route.path.includes('landsat') ? 'getTimeSeriesLandsatNdviByLonLatAdmin' : 'getTimeSeriesSentinelNdviByLonLatAdmin',
                metadata: { error: error.message, lon, lat },
                req: request
            });
            response.status(500).send({ error: "Failed to fetch timeseries data", logId });
        }
    };

    return Timeseries;

}
