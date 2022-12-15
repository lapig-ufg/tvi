const fs = require("fs");
const async = require("async");
const mongodb = require('mongodb');
const exec = require('child_process').exec;
const util = require('util')

/**
 * Args
 * geojsonFile - path
 * campaign - identification of campaign
 */

const geojsonFile = process.argv[2];
const campaign = process.argv[3];

const collectionPointsName = "points";
const dbUrl = 'mongodb://127.0.0.1:27019/tvi';

let campaignCollection = null;
let pointsCollection = null;

const checkError = function (error) {
    if (error) {
        console.error(error);
        process.exit();
    }
}

const getInspections = function (geojsonDataStr) {
    const geojsonData = JSON.parse(geojsonDataStr)

    let points = []
    for (let i = 0; i < geojsonData.features.length; i++) {
        const pointProperties = geojsonData.features[i].properties;
        let inspections = [];
        Object.keys(pointProperties).forEach(function (key) {
            if (key.includes('_1')) {
                inspections.push({
                    "user": 'insp1',
                    "year": parseInt(key.replace('_1', '')),
                    "class": pointProperties[key]
                })
            }
            if (key.includes('_1')) {
                inspections.push({
                    "user": 'insp2',
                    "year": parseInt(key.replace('_2', '')),
                    "class": pointProperties[key]
                })
            }
        });

        inspections.forEach((item, idx) => {
            if (!item.class) {
                delete inspections[idx]
            }
        })

        points.push(
            {
                "lon": geojsonData.features[i].geometry.coordinates[0],
                "lat": geojsonData.features[i].geometry.coordinates[1],
                "inspections": inspections
            }
        );
    }
    return points;
}

const getDB = function (dbUrl, callback) {
    const MongoClient = mongodb.MongoClient;
    MongoClient.connect(dbUrl, function (err, db) {
        if (err)
            return console.dir(err);
        callback(db);
    });
}

const classConsolidate = (pointDb, campaign, pointsCollection, db, next) => {
    try {
        let landUseInspections = {}
        let classConsolidated = []

        if(pointDb.inspection.length > 0){
            for (let i in pointDb.inspection) {
                const inspection = pointDb.inspection[i]
                for (let j in inspection.form) {
                    const form = inspection.form[j]
                    for (let year = form.initialYear; year <= form.finalYear; year++) {

                        if (!landUseInspections[year])
                            landUseInspections[year] = [];

                        landUseInspections[year].push(form.landUse)
                    }

                }
            }

            for (let year = campaign.initialYear; year <= campaign.finalYear; year++) {
                let landUseCount = {};
                let flagConsolid = false;

                for (let i = 0; i < landUseInspections[year].length; i++) {
                    let landUse = landUseInspections[year][i]

                    if (!landUseCount[landUse])
                        landUseCount[landUse] = 0

                    landUseCount[landUse]++
                }

                const numElemObj = Object.keys(landUseCount).length;
                let countNumElem = 0;

                for (let landUse in landUseCount) {
                    countNumElem++

                    if (landUseCount[landUse] > campaign.numInspec / 2 && flagConsolid === false) {
                        flagConsolid = true;
                        classConsolidated.push(landUse)

                    } else if (numElemObj === countNumElem && flagConsolid === false) {
                        flagConsolid = true;
                        classConsolidated.push("Não consolidado")
                    }
                }
            }

            pointsCollection.update({'_id': pointDb._id}, {'$set': {"classConsolidated": classConsolidated}}, (err, pto) => {
                if (err) {
                    console.error(`[ERROR] point ${pointDb.lon},${pointDb.lat} class not consolidated. ${pto}`);
                    db.close();
                } else {
                    console.log(`[SUCCESS] point ${pointDb.lon},${pointDb.lat} class consolidated. ${pto}`);
                    next();
                }
            });
        } else {
            console.log(`[WARN] point ${pointDb.lon},${pointDb.lat} inspections not found.}`);
            next();
        }
    } catch (e) {
        console.log(`[ERROR] point:  ${util.inspect(pointDb, { showHidden: false, depth: 2, colors: false, breakLength: Number.POSITIVE_INFINITY })}`);
        console.error(e);
        db.close();
    }
}


fs.readFile(geojsonFile, 'utf-8', function (error, geojsonDataStr) {
    checkError(error);
    getDB(dbUrl, (db) => {
        db.collection('campaign', (err, campaignCollection) => {
            db.collection('points', (err, pointsCollection) => {
                const insertInspections = (point, next) => {

                    let inspectionInsp1 = {
                        "counter": 0,
                        "form": point.inspections.filter(insp => insp.user === 'insp1').map((item) => {
                            return {
                                "initialYear": item.year,
                                "finalYear": item.year,
                                "landUse": item.class
                            }
                        }),
                        "fillDate": new Date()
                    };

                    let inspectionInsp2 = {
                        "counter": 0,
                        "form": point.inspections.filter(insp => insp.user === 'insp2').map((item) => {
                            return {
                                "initialYear": item.year,
                                "finalYear": item.year,
                                "landUse": item.class
                            }
                        }),
                        "fillDate": new Date()
                    };

                    const bulkOperations = []

                    if(inspectionInsp1.form.length > 0){
                        bulkOperations.push({
                            updateOne: {
                                filter: {'campaign': campaign, 'lon': point.lon, lat: point.lat},
                                update: {
                                    '$push': {
                                        "inspection": inspectionInsp1,
                                        "userName": 'insp1',
                                    }
                                }
                            }
                        })
                    }

                    if(inspectionInsp2.form.length > 0){
                        bulkOperations.push({
                            updateOne: {
                                filter: {'campaign': campaign, 'lon': point.lon, lat: point.lat},
                                update: {
                                    '$push': {
                                        "inspection": inspectionInsp2,
                                        "userName": 'insp2',
                                    }
                                }
                            }
                        })
                    }

                    if(bulkOperations.length > 0){
                        pointsCollection.bulkWrite(bulkOperations, async (err, pto) => {
                            if (err) {
                                console.log("[ERROR] " + JSON.stringify(pto) + " not updated.");
                                db.close();
                            } else {
                                console.log(`[SUCCESS] point ${point.lon},${point.lat} updated.`);
                                const _campaign = await campaignCollection.findOne({"_id": campaign})
                                const _point = await pointsCollection.findOne({
                                    'campaign': campaign,
                                    'lon': point.lon,
                                    lat: point.lat
                                })
                                classConsolidate(_point, _campaign, pointsCollection, db, next)
                            }
                        });
                    } else {
                        console.log(`[WARN] point ${point.lon},${point.lat} inspections not found.}`);
                        next();
                    }
                }
                const onComplete = function () {
                    db.close();
                };
                async.eachSeries(getInspections(geojsonDataStr), insertInspections, onComplete);
            });
        });
    });
});
