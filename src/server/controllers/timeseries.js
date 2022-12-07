module.exports = function (app) {

    const collections = app.repository.tSCollections;
    let Timeseries = {};

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
            console.error("Campaign not found")
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
            console.error("Campaign not found")
            response.end()
        }
    }

    return Timeseries;

}
