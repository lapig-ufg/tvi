const axios = require("axios");
const https = require("https");

module.exports = function (app) {

    const collections = app.repository.tSCollections;
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
            console.error("lon lat not found")
            response.end()
        }
        if(collections[campaign]){
            collections[campaign].find(filter, {"_id": 0, "geom": 0}).toArray((err, ts) => {
                if (err) {
                    console.error(err)
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
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            console.error("lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        const url = `https://tiles.lapig.iesa.ufg.br/api/timeseries/landsat/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            console.error("Error fetching timeseries:", error.message);
            response.status(500).send({ error: "Failed to fetch timeseries data" });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLat = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            console.error("lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        const url = `https://tiles.lapig.iesa.ufg.br/api/timeseries/nddi/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            console.error("Error fetching timeseries:", error.message);
            response.status(500).send({ error: "Failed to fetch timeseries data" });
        }
    };

    // ===== MÉTODOS ADMIN (sem dependência de sessão) =====
    
    Timeseries.getTimeSeriesLandsatNdviByLonLatAdmin = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        const url = `https://tiles.lapig.iesa.ufg.br/api/timeseries/landsat/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            console.error("Admin - Error fetching timeseries:", error.message);
            response.status(500).send({ error: "Failed to fetch timeseries data" });
        }
    };

    Timeseries.getTimeSeriesLandsatNDDIByLonLatAdmin = async function (request, response) {
        const { lon, lat } = request.query;

        if (!lon || !lat) {
            console.error("Admin - lon lat not found");
            return response.status(400).send({ error: "Longitude and latitude are required" });
        }

        const url = `https://tiles.lapig.iesa.ufg.br/api/timeseries/nddi/${lat}/${lon}`;

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Node.js",
                },
                httpsAgent: agent,
            });

            response.status(200).send(res.data);
        } catch (error) {
            console.error("Admin - Error fetching timeseries:", error.message);
            response.status(500).send({ error: "Failed to fetch timeseries data" });
        }
    };

    return Timeseries;

}
