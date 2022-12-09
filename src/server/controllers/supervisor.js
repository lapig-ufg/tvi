const csv = require('fast-csv');
const proj4 = require('proj4');
const {exec} = require("child_process");

module.exports = function (app) {

    var Points = {};
    var pointsCollection = app.repository.collections.points;
    var mosaics = app.repository.collections.mosaics;
    var infoCampaign = app.repository.collections.campaign;
    const config = app.config;

    var getImageDates = function (path, row, callback) {
        var filterMosaic = {'dates.path': path, 'dates.row': row};
        var projMosaic = {dates: {$elemMatch: {path: path, row: row}}};

        mosaics.find(filterMosaic, projMosaic).toArray(function (err, docs) {
            var result = {}

            docs.forEach(function (doc) {
                if (doc.dates && doc.dates[0]) {
                    result[doc._id] = doc.dates[0]['date']
                }
            })

            callback(result)
        })
    }

    Points.csv = function (request, response) {
        var campaign = request.session.user.campaign;

        infoCampaign.find({'_id': campaign._id}).forEach(function (data) {
            var initialYear = data.initialYear;
            var finalYear = data.finalYear;

            pointsCollection.find({"campaign": campaign._id}).sort({'index': 1}).toArray(function (err, points) {
                var csvResult = [];
                var objColNames = {};

                points.forEach(function (point) {
                    for (var i = 0; i < point.userName.length; i++) {
                        point.inspection[i].form.forEach(function (inspec) {
                            for (var year = initialYear; year <= finalYear; year++) {
                                var colName = year + "_" + point.userName[i];

                                if (!objColNames[colName])
                                    objColNames[colName] = ''
                            }
                        })
                    }
                });

                points.forEach(function (point) {
                    var csvLines = {
                        'index': point.index,
                        'lon': point.lon,
                        'lat': point.lat
                    }

                    for (var colNames in objColNames) {
                        csvLines[colNames] = '-';
                    }

                    var count = 0;
                    for (var i = 0; i < point.userName.length; i++) {
                        point.inspection[i].form.forEach(function (inspec) {
                            for (var year = inspec.initialYear; year <= inspec.finalYear; year++) {
                                for (var col in csvLines) {
                                    if (col == year + "_" + point.userName[i]) {
                                        csvLines[col] = inspec.landUse

                                        if (inspec.hasOwnProperty('pixelBorder')) {
                                            csvLines['borda_' + year] = inspec.pixelBorder
                                        }

                                        if (!csvLines['consolidated_' + year]) {
                                            if (point.classConsolidated) {
                                                csvLines['consolidated_' + year] = point.classConsolidated[count]
                                            } else {
                                                csvLines['consolidated_' + year] = '-'
                                            }
                                            count++;
                                        }
                                    }
                                }
                            }
                        })
                    }

                    if (point.pointEdited === true) {
                        csvLines['pointEdited'] = true
                    } else {
                        csvLines['pointEdited'] = '-'
                    }

                    csvResult.push(csvLines)
                })

                response.set('Content-Type', 'text/csv');
                response.set('Content-Disposition', 'attachment;filename=' + campaign._id + '.csv');

                const csvStream = csv.format({
                    headers: true,
                    delimiter: ';'
                });
                for (const i in csvResult) {
                    csvStream.write(csvResult[i])
                }
                csvStream.end();

                csvStream.pipe(response).on('end', () => response.end());
            })
        });
    }

    getWindow = function (point) {
        var buffer = 4000
        var coordinates = proj4('EPSG:4326', 'EPSG:900913', [point.lon, point.lat])

        var ulx = coordinates[0] - buffer
        var uly = coordinates[1] + buffer
        var lrx = coordinates[0] + buffer
        var lry = coordinates[1] - buffer

        var ul = proj4('EPSG:900913', 'EPSG:4326', [ulx, uly])
        var lr = proj4('EPSG:900913', 'EPSG:4326', [lrx, lry])

        return [[ul[1], ul[0]], [lr[1], lr[0]]]
    }

    creatPoint = function (point, callback) {
        var years = [];
        var yearlyInspections = [];

        if (point) {
            for (var i = 0; i < point.userName.length; i++) {
                var userName = point.userName[i];
                var inspections = point.inspection[i];

                var yearlyInspection = {
                    userName: userName,
                    landUse: []
                }
                inspections.form.forEach(function (i) {
                    for (var year = i.initialYear; year <= i.finalYear; year++) {
                        yearlyInspection.landUse.push(`${i.landUse} ${i.pixelBorder ? ' - BORDA' : ''}`);
                    }
                });

                yearlyInspections.push(yearlyInspection)
            }

            if (point.inspection[0]) {
                point.inspection[0].form.forEach(function (i) {
                    for (var year = i.initialYear; year <= i.finalYear; year++) {
                        years.push(year);
                    }
                });
            }
        } else {
            point = {};
        }

        point.inspection = yearlyInspections;
        point.years = years;

        getImageDates(point.path, point.row, function (dates) {
            point.dates = dates

            var result = {
                "point": point
            }

            return callback(result);
        });
    }

    Points.getPoint = function (request, response) {
        var campaign = request.session.user.campaign;
        var index = parseInt(request.param("index"));
        var landUse = request.param("landUse");
        var userName = request.param("userName");
        var biome = request.param("biome");
        var uf = request.param("uf");
        var timePoint = request.param("timeInspection");
        var agreementPoint = request.param("agreementPoint");

        var filter = {
            "campaign": campaign._id
        };

        if (userName) {
            filter["userName"] = userName;
        }

        if (landUse) {
            filter["inspection.form.landUse"] = landUse;
        }

        if (uf) {
            filter["uf"] = uf;
        }

        if (biome) {
            filter["biome"] = biome;
        }

        if (timePoint) {
            var pipeline = [
                {"$match": filter},
                {"$project": {mean: {"$avg": "$inspection.counter"}}},
                {"$sort": {mean: -1}},
                {"$skip": index - 1},
                {"$limit": 1}
            ]
        }

        if (agreementPoint) {
            if (userName || !landUse) {
                var pipeline = [
                    {$match: filter},
                    {
                        $project: {
                            consolidated: {
                                $size: {
                                    $ifNull: [
                                        {
                                            $filter: {
                                                input: "$classConsolidated",
                                                as: "consolidated",
                                                cond: {
                                                    $and: [
                                                        {$eq: ['$$consolidated', 'Não consolidado']}
                                                    ]
                                                }
                                            }
                                        },
                                        []
                                    ]
                                }
                            }
                        }
                    },
                    {$sort: {'consolidated': -1}},
                    {$skip: index - 1}
                ]
            } else {
                var pipeline = [
                    {$match: filter},
                    {
                        $project: {
                            consolidated: {
                                $size: {
                                    $ifNull: [
                                        {
                                            $filter: {
                                                input: "$classConsolidated",
                                                as: "consolidated",
                                                cond: {
                                                    $and: [
                                                        {$eq: ['$$consolidated', landUse]}
                                                    ]
                                                }
                                            }
                                        },
                                        []
                                    ]
                                }
                            }
                        }
                    },
                    {$sort: {'consolidated': -1}},
                    {$skip: index - 1}
                ]
            }
        }

        if (pipeline == undefined) {
            var pipeline = [
                {"$match": filter},
                {"$project": {index: 1, mean: {"$avg": "$inspection.counter"}}},
                {"$sort": {index: 1}},
                {"$skip": index - 1},
                {"$limit": 1}
            ]
        }

        var objPoints = {};

        pointsCollection.aggregate(pipeline, function (err, aggregateElem) {
            aggregateElem = aggregateElem[0]

            pointsCollection.findOne({'_id': aggregateElem._id}, function (err, newPoint) {
                point = newPoint;
                var pointTimeList = [];
                var pointTimeTotal = 0;

                newPoint.inspection.forEach(function (timeInspectionUser) {
                    pointTimeList.push(timeInspectionUser.counter)
                    pointTimeTotal += timeInspectionUser.counter;
                })

                pointTimeTotal = pointTimeTotal / newPoint.userName.length;

                var map = function () {
                    for (var i = 0; i < this.userName.length; i++) {
                        emit(this.userName[i], this.inspection[i].counter)
                    }
                }

                var reduce = function (keyName, values) {
                    return Array.sum(values) / values.length;
                }

                pointsCollection.mapReduce(map, reduce, {
                    out: {inline: 1},
                    query: {'campaign': filter.campaign}
                }, function (err, mapReducePoint) {
                    var nameList = [];
                    var meanPointList = [];
                    var meanPointTotal = 0;

                    newPoint.userName.forEach(function (nameUser) {
                        mapReducePoint.forEach(function (user) {
                            if (nameUser == user._id) {
                                nameList.push(user._id)
                                meanPointList.push(user.value)
                                meanPointTotal += user.value;
                            }
                        })
                    })

                    point.bounds = getWindow(point)

                    point.dataPointTime = [];

                    for (var i = 0; i < newPoint.userName.length; i++) {
                        point.dataPointTime.push({
                            'name': nameList[i],
                            'totalPointTime': pointTimeList[i],
                            'meanPointTime': meanPointList[i]
                        })
                    }

                    point.dataPointTime.push({
                        'name': 'Tempo médio',
                        'totalPointTime': pointTimeTotal,
                        'meanPointTime': meanPointTotal
                    })

                    point.timePoints = point.timePoint;
                    point.originalIndex = point.index;
                    point.index = index;

                    creatPoint(point, function (result) {
                        pointsCollection.count(filter, function (err, count) {

                            result.totalPoints = count
                            response.send(result)
                            response.end()
                        })
                    })
                })
            })
        });
    }

    Points.updatedClassConsolidated = function (request, response) {
        var classArray = request.param("class");
        var pointId = request.param("_id")

        pointsCollection.update({'_id': pointId}, {$set: {'classConsolidated': classArray, 'pointEdited': true}})

        response.end()
    }

    Points.landUseFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        //var landUse = request.param("landUse");
        var userName = request.param("userName");
        var biome = request.param("biome");
        var uf = request.param("uf");

        var filter = {
            "campaign": campaign._id
        }

        /*if(landUse) {
            filter["inspection.form.landUse"] = landUse;
        }*/

        if (userName) {
            filter["userName"] = userName;
        }

        if (biome) {
            filter["biome"] = biome;
        }

        if (uf) {
            filter["uf"] = uf;
        }
        pointsCollection.distinct('inspection.form.landUse', filter, function (err, landUses) {
            response.send(landUses);
            response.end();
        });
    }

    Points.usersFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var landUse = request.param("landUse");
        //var userName = request.param("userName");
        var biome = request.param("biome");
        var uf = request.param("uf");

        var filter = {
            "campaign": campaign._id
        }

        if (landUse) {
            filter["inspection.form.landUse"] = landUse;
        }

        /*if(userName) {
            filter["userName"] = userName;
        }*/

        if (biome) {
            filter["biome"] = biome;
        }

        if (uf) {
            filter["uf"] = uf;
        }
        pointsCollection.distinct('userName', filter, function (err, docs) {
            response.send(docs);
            response.end();
        });

    }

    Points.biomeFilter = function (request, response) {
        var result = [];
        var campaign = request.session.user.campaign;
        var landUse = request.param("landUse");
        var userName = request.param("userName");
        //var biome = request.param("biome");
        var uf = request.param("uf");

        var filter = {
            "campaign": campaign._id
        }

        if (landUse) {
            filter["inspection.form.landUse"] = landUse;
        }

        if (userName) {
            filter["userName"] = userName;
        }

        /*if(biome) {
            filter["biome"] = biome;
        }*/

        if (uf) {
            filter["uf"] = uf;
        }
        pointsCollection.distinct('biome', filter, function (err, docs) {

            result = docs.filter(function (element) {
                return element != null;
            })

            response.send(result);
            response.end();
        });
    }

    Points.ufFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var landUse = request.param("landUse");
        var userName = request.param("userName");
        var biome = request.param("biome");
        //var uf = request.param("uf");

        var filter = {
            "campaign": campaign._id
        };

        if (landUse) {
            filter["inspection.form.landUse"] = landUse;
        }

        if (userName) {
            filter["userName"] = userName;
        }

        if (biome) {
            filter["biome"] = biome;
        }

        /*if(uf) {
            filter["uf"] = uf;
        }*/

        pointsCollection.distinct('uf', filter, function (err, docs) {

            result = docs.filter(function (element) {
                return element != null;
            })

            response.send(result);
            response.end();
        });

    }

    Points.correctCampaign = async (request, response) => {
        const campaign = request.session.user.campaign;
        if (campaign) {
            const points = await pointsCollection.find({ 'campaign': campaign._id }).toArray();
            const numInspections = campaign.numInspec;
            const msgs = [];
            for (const [idx, point] of points.entries() ){
                if(point.inspection.length !== numInspections) {
                    if(point.inspection.length > numInspections) {
                        const numExceededInspection = point.inspection.length - numInspections
                        const inspection = point.inspection.slice(0, -1*numExceededInspection)
                        const userName = point.userName.slice(0, -1*numExceededInspection)

                        point.inspection = inspection
                        point.userName = userName
                    }

                    point.underInspection = point.inspection.length
                    const result = await pointsCollection.update({ _id: point._id }, { $set: point} )
                    msgs.push(' Point '+ point._id +' final number of inspections ' + point.underInspection)
                }
            }
            msgs.join("\n")
            response.status(200).send(msgs);
            response.end();
        } else {
            response.status(400).send('Parameter campaign not found');
            response.end();
        }
    }

    Points.getBorda = async (request, response) => {
        const campaign = request.session.user.campaign;
        if (campaign) {
            const nInspections = campaign.numInspec
            const initialYear = campaign.initialYear
            const finalYear =campaign.finalYear

            const colNames = ["id","lat","lon"]

            for(let i=0; i < nInspections; i++) {

                colNames.push('user_' + (i+1))
                colNames.push('time_' + (i+1))

                for(let y=initialYear; y <= finalYear; y++) {
                    colNames.push('class_' + y + "_" + (i+1))
                    colNames.push('border_' + y + "_" + (i+1))
                }
            }

            for(let y = initialYear; y <= finalYear; y++) {
                colNames.push('class_' + y + "_f")
            }

            colNames.push('edited')

            response.set('Content-Type', 'text/csv');
            response.set('Content-Disposition', 'attachment;filename=' + campaign._id + '_borda.csv');

            const csvStream = csv.format({
                headers: colNames,
                delimiter: ';'
            });

            const points = await pointsCollection.find({ 'campaign': campaign._id }).toArray()

            points.forEach(point => {
                const result = [ point._id, point.lon, point.lat ]
                for(let i=0; i < nInspections; i++) {

                    var inspection = point.inspection[i]

                    if (point.userName[i]) {
                        result.push(point.userName[i].toLowerCase())
                        result.push(inspection.counter)

                        for(var j=0; j < inspection.form.length; j++) {
                            var form = inspection.form[j]

                            for(var y=form.initialYear; y <= form.finalYear; y++) {
                                result.push(form.landUse)
                                result.push(form.pixelBorder)
                            }
                        }
                    }

                }

                const consolidated = point.classConsolidated

                if (consolidated) {
                    for(let i=0; i < consolidated.length; i++) {
                        result.push(consolidated[i])
                    }

                    result.push(point.pointEdited)
                }
                csvStream.write(result)
            })
            csvStream.end();

            csvStream.pipe(response).on('end', () => response.end());
        } else {
            response.status(400).send('Parameter campaign not found');
            response.end();
        }
    }

    return Points;
};
