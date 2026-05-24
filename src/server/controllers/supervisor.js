const csv = require('fast-csv');
const proj4 = require('proj4');
const {exec} = require("child_process");
const supervisorFilters = require('../util/supervisorFilters');

const {
    BIOME_PROPERTY_KEYS,
    UF_PROPERTY_KEYS,
    buildResolvedFieldExpression,
    biomeOrClause,
    ufOrClause,
    resolveFilterFlags
} = supervisorFilters;

module.exports = function (app) {
    // Usar o logger do app
    const logger = app.services.logger;

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

    Points.csv = async function (request, response) {
        try {
            var campaign = request.session.user.campaign;

            if (!campaign || !campaign._id) {
                const errorCode = await logger.warn('CSV export attempted without valid campaign', {
                    req: request,
                    module: 'supervisor',
                    function: 'csv',
                    metadata: { hasCampaign: !!campaign }
                });
                
                return response.status(400).json({ 
                    error: 'Valid campaign required',
                    errorCode
                });
            }

            await logger.info('Starting CSV export for campaign', {
                req: request,
                module: 'supervisor',
                function: 'csv',
                metadata: {
                    campaignId: campaign._id,
                    campaignName: campaign.name
                }
            });

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

                csvStream.pipe(response).on('end', async () => {
                    await logger.info('CSV export completed successfully', {
                        req: request,
                        module: 'supervisor',
                        function: 'csv',
                        metadata: {
                            campaignId: campaign._id,
                            recordCount: csvResult.length
                        }
                    });
                    response.end();
                });
            })
        });
        } catch (error) {
            const errorCode = await logger.error('Error in CSV export', {
                req: request,
                module: 'supervisor',
                function: 'csv',
                metadata: {
                    error: error.message,
                    stack: error.stack
                }
            });

            response.status(500).json({
                error: 'Error exporting CSV',
                errorCode
            });
        }
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
        var index = parseInt(request.body.index);
        var landUse = request.body.landUse;
        var userName = request.body.userName;
        var biome = request.body.biome;
        var uf = request.body.uf;
        var timePoint = request.body.timeInspection;
        var agreementPoint = request.body.agreementPoint;

        var filter = {
            "campaign": campaign._id
        };

        if (userName) {
            filter["userName"] = userName;
        }

        // Filtro composto (classe + status): ver resolveFilterFlags.
        var resolved = resolveFilterFlags(landUse, request.body.notConsolidatedOnly);
        if (resolved.landUse) {
            filter["inspection.form.landUse"] = resolved.landUse;
        }
        if (resolved.notConsolidatedOnly) {
            filter["classConsolidated"] = "Não consolidado";
        }

        // TKT-000010: aceita pontos com biome/uf legados apenas em properties.*
        // via $or. Acumula em $and quando ambos os filtros estiverem presentes
        // para não colidirem entre si.
        var fallbackClauses = [];
        if (uf) {
            fallbackClauses.push({ $or: ufOrClause(uf) });
        }
        if (biome) {
            fallbackClauses.push({ $or: biomeOrClause(biome) });
        }
        if (fallbackClauses.length === 1) {
            filter.$or = fallbackClauses[0].$or;
        } else if (fallbackClauses.length > 1) {
            filter.$and = fallbackClauses;
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
            if (userName || !resolved.landUse) {
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
                                                        {$eq: ['$$consolidated', resolved.landUse]}
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

            if(aggregateElem.length === 0){
                response.send({totalPoints: 0})
                response.end()
                return;
            }

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

                            response.send({
                                ...result,
                                totalPoints: count,
                                campaign: campaign
                            })
                            response.end()
                        })
                    })
                })
            })
        });
    }

    Points.updatedClassConsolidated = async function (request, response) {
        try {
            var classArray = request.body.class;
            var pointId = request.body._id;

            if (!pointId) {
                const errorCode = await logger.warn('Update class consolidated attempted without point ID', {
                    req: request,
                    module: 'supervisor',
                    function: 'updatedClassConsolidated',
                    metadata: { hasPointId: !!pointId }
                });

                return response.status(400).json({
                    error: 'Point ID required',
                    errorCode
                });
            }

            // TKT-000013: preservar histórico de edições para auditoria supervisor × intérprete.
            // Lê o estado atual do ponto antes de sobrescrever `classConsolidated` para
            // (a) registrar o snapshot original apenas na primeira edição e
            // (b) anexar entrada em `editHistory` a cada edição.
            var currentPoint = await new Promise(function (resolve, reject) {
                pointsCollection.findOne({ _id: pointId }, function (err, doc) {
                    if (err) { return reject(err); }
                    resolve(doc);
                });
            });

            if (!currentPoint) {
                const errorCode = await logger.warn('Update class consolidated: point not found', {
                    req: request,
                    module: 'supervisor',
                    function: 'updatedClassConsolidated',
                    metadata: { pointId: pointId }
                });
                return response.status(404).json({
                    error: 'Point not found',
                    errorCode
                });
            }

            // Identificador do editor: supervisor autenticado (session.user.name)
            // ou super-admin (session.admin.superAdmin.username). Preferimos o primeiro
            // por ser o fluxo normal da tela /supervisor; caímos para admin em ferramentas internas.
            var editedBy = null;
            if (request.session) {
                if (request.session.user && request.session.user.name) {
                    editedBy = request.session.user.name;
                } else if (request.session.admin && request.session.admin.superAdmin && request.session.admin.superAdmin.username) {
                    editedBy = request.session.admin.superAdmin.username;
                }
            }
            var editedAt = new Date();

            var previousClass = Array.isArray(currentPoint.classConsolidated)
                ? currentPoint.classConsolidated.slice()
                : [];

            var setFields = {
                classConsolidated: classArray,
                pointEdited: true,
                editedBy: editedBy,
                editedAt: editedAt
            };

            // Preserva classConsolidated original apenas na primeira edição.
            // Documentos legados sem o campo são retrocompatíveis: seguem funcionando,
            // mas perdem a referência "antes da primeira edição" (ver script de backfill).
            if (!currentPoint.classConsolidatedOriginal) {
                setFields.classConsolidatedOriginal = previousClass;
            }

            var historyEntry = {
                editedBy: editedBy,
                editedAt: editedAt,
                previousClass: previousClass,
                newClass: Array.isArray(classArray) ? classArray.slice() : []
            };

            await logger.info('Updating consolidated classification', {
                req: request,
                module: 'supervisor',
                function: 'updatedClassConsolidated',
                metadata: {
                    pointId: pointId,
                    editedBy: editedBy,
                    hadOriginalSnapshot: !!currentPoint.classConsolidatedOriginal
                }
            });

            await pointsCollection.update(
                { _id: pointId },
                {
                    $set: setFields,
                    $push: { editHistory: historyEntry }
                }
            );

            await logger.info('Consolidated classification updated successfully', {
                req: request,
                module: 'supervisor',
                function: 'updatedClassConsolidated',
                metadata: {
                    pointId: pointId,
                    editedBy: editedBy
                }
            });

            response.end();
        } catch (error) {
            const errorCode = await logger.error('Error updating consolidated classification', {
                req: request,
                module: 'supervisor',
                function: 'updatedClassConsolidated',
                metadata: {
                    error: error.message,
                    stack: error.stack,
                    pointId: request.body._id
                }
            });

            response.status(500).json({
                error: 'Error updating classification',
                errorCode
            });
        }
    }

    Points.landUseFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var userName = request.query.userName;
        var biome = request.query.biome;
        var uf = request.query.uf;
        // notConsolidatedOnly chega como string 'true' em query string.
        var notConsolidatedOnly = request.query.notConsolidatedOnly === 'true' || request.query.notConsolidatedOnly === true;

        var filter = {
            "campaign": campaign._id
        }

        if (userName) {
            filter["userName"] = userName;
        }

        if (notConsolidatedOnly) {
            filter["classConsolidated"] = "Não consolidado";
        }

        // TKT-000010: pontos legados de Mata Atlântica/Caatinga têm biome/uf
        // só em properties.* — sem o $or aqui, o distinct retornaria vazio
        // para esses biomas, removendo classes como "Pastagem Natural" da
        // dropdown. Mesmo padrão composto do getPoint.
        var fallbackClauses = [];
        if (uf) {
            fallbackClauses.push({ $or: ufOrClause(uf) });
        }
        if (biome) {
            fallbackClauses.push({ $or: biomeOrClause(biome) });
        }
        if (fallbackClauses.length === 1) {
            filter.$or = fallbackClauses[0].$or;
        } else if (fallbackClauses.length > 1) {
            filter.$and = fallbackClauses;
        }

        pointsCollection.distinct('inspection.form.landUse', filter, function (err, landUses) {
            response.send(landUses);
            response.end();
        });
    }

    Points.usersFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var landUse = request.query.landUse;
        var biome = request.query.biome;
        var uf = request.query.uf;
        var notConsolidatedOnly = request.query.notConsolidatedOnly === 'true' || request.query.notConsolidatedOnly === true;

        var filter = {
            "campaign": campaign._id
        }

        var resolved = resolveFilterFlags(landUse, notConsolidatedOnly);
        if (resolved.landUse) {
            filter["inspection.form.landUse"] = resolved.landUse;
        }
        if (resolved.notConsolidatedOnly) {
            filter["classConsolidated"] = "Não consolidado";
        }

        // TKT-000010: mesmo motivo de landUseFilter — pontos legados.
        var fallbackClauses = [];
        if (uf) {
            fallbackClauses.push({ $or: ufOrClause(uf) });
        }
        if (biome) {
            fallbackClauses.push({ $or: biomeOrClause(biome) });
        }
        if (fallbackClauses.length === 1) {
            filter.$or = fallbackClauses[0].$or;
        } else if (fallbackClauses.length > 1) {
            filter.$and = fallbackClauses;
        }

        pointsCollection.distinct('userName', filter, function (err, docs) {
            response.send(docs);
            response.end();
        });

    }

    Points.biomeFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var landUse = request.query.landUse;
        var userName = request.query.userName;
        var uf = request.query.uf;
        var notConsolidatedOnly = request.query.notConsolidatedOnly === 'true' || request.query.notConsolidatedOnly === true;

        var filter = {
            "campaign": campaign._id
        }

        var resolved = resolveFilterFlags(landUse, notConsolidatedOnly);
        if (resolved.landUse) {
            filter["inspection.form.landUse"] = resolved.landUse;
        }
        if (resolved.notConsolidatedOnly) {
            filter["classConsolidated"] = "Não consolidado";
        }

        if (userName) {
            filter["userName"] = userName;
        }

        if (uf) {
            filter.$or = ufOrClause(uf);
        }

        // TKT-000010: aggregate com fallback para properties.* quando o
        // campo top-level biome estiver ausente (pontos legados importados
        // antes da normalização na ingestão).
        var pipeline = [
            { $match: filter },
            { $project: { biomeResolved: buildResolvedFieldExpression('biome', BIOME_PROPERTY_KEYS) } },
            { $match: { biomeResolved: { $ne: null } } },
            { $group: { _id: '$biomeResolved' } }
        ];

        pointsCollection.aggregate(pipeline).toArray(function (err, docs) {
            if (err) {
                console.error('biomeFilter aggregate error:', err);
                response.status(500).send([]);
                return;
            }
            var result = (docs || [])
                .map(function (d) { return d._id; })
                .filter(function (v) { return v != null && v !== ''; });
            response.send(result);
            response.end();
        });
    }

    Points.ufFilter = function (request, response) {
        var campaign = request.session.user.campaign;
        var landUse = request.query.landUse;
        var userName = request.query.userName;
        var biome = request.query.biome;
        var notConsolidatedOnly = request.query.notConsolidatedOnly === 'true' || request.query.notConsolidatedOnly === true;

        var filter = {
            "campaign": campaign._id
        };

        var resolved = resolveFilterFlags(landUse, notConsolidatedOnly);
        if (resolved.landUse) {
            filter["inspection.form.landUse"] = resolved.landUse;
        }
        if (resolved.notConsolidatedOnly) {
            filter["classConsolidated"] = "Não consolidado";
        }

        if (userName) {
            filter["userName"] = userName;
        }

        if (biome) {
            filter.$or = biomeOrClause(biome);
        }

        /*if(uf) {
            filter["uf"] = uf;
        }*/

        // TKT-000010: aggregate com fallback para properties.* quando o
        // campo top-level uf estiver ausente.
        var pipeline = [
            { $match: filter },
            { $project: { ufResolved: buildResolvedFieldExpression('uf', UF_PROPERTY_KEYS) } },
            { $match: { ufResolved: { $ne: null } } },
            { $group: { _id: '$ufResolved' } }
        ];

        pointsCollection.aggregate(pipeline).toArray(function (err, docs) {
            if (err) {
                console.error('ufFilter aggregate error:', err);
                response.status(500).send([]);
                return;
            }
            var result = (docs || [])
                .map(function (d) { return d._id; })
                .filter(function (v) { return v != null && v !== ''; });
            response.send(result);
            response.end();
        });

    }

    // DESATIVADA em 2026-05-09 — Tier 0 do plano de defesa contra perda de inspeções.
    // Implementação anterior aplicava `slice(0, -k)` em userName/inspection quando
    // `inspection.length > numInspec`, removendo sistematicamente o trabalho do 2º
    // inspetor (Classificação Automática ocupa o slot 0, então o 2º humano é o
    // "excedente" cortado). Causou ~7k inspeções perdidas em mapbiomas_pastagem_col11.
    // Substituída por dry-run que apenas reporta a invocação, sem alterar dados.
    // Ver /tmp/tvi-investigation/DIAGNOSTICO.md §4.1 e clever-dreaming-pudding.md §0.2.
    Points.correctCampaign = async (request, response) => {
        const campaign = request.session && request.session.user && request.session.user.campaign;
        await logger.warn('correctCampaign invocado em modo dry-run (função desativada)', {
            module: 'supervisor',
            function: 'correctCampaign',
            metadata: {
                campaignId: campaign ? campaign._id : null,
                username: request.session && request.session.user && request.session.user.name,
                ip: request.ip
            }
        });
        response.status(200).json({
            dryRun: true,
            message: 'Função temporariamente desativada para evitar perda de inspeções. Contate o suporte se precisar corrigir uma campanha.'
        });
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
    // Tier 1.6 (2026-05-09) — migrada para pointsService.softWipePoint:
    // (1) snapshot do estado anterior em points_audit (antes/depois);
    // (2) marca o ponto como arquivado (archivedAt, archivedReason, archivedBy)
    //     em vez de só zerar arrays — permite restore via pointsService.restore
    //     e POST /api/admin/points/:pointId/restore.
    // A rota GET legada (/service/campaign/removeInspections) continua viva
    // pois UIs antigas dependem dela. A versão moderna (POST .../soft-wipe com
    // token + reason) está em routes/pointsAdmin.js.
    Points.removeInspections = async (request, response) => {
        const {pointId} = request.query;
        if (!pointId) {
            return response.status(404).send('O identificador: pointId não foi encontrado.');
        }
        const pointsService = app.services && app.services.pointsService;
        if (!pointsService) {
            return response.status(500).send('pointsService indisponível');
        }
        try {
            const admin = request.session && request.session.admin;
            const sessionUser = request.session && request.session.user;
            const ctx = {
                actor: {
                    username: (admin && admin.username) || (sessionUser && sessionUser.name) || 'unknown',
                    role: (admin && admin.superAdmin) ? 'superAdmin' : (sessionUser && sessionUser.role) || null,
                    sessionId: request.sessionID || null,
                    ip: request.ip || null
                },
                // GET legado não exige token nem reason; usamos um default identificável
                // para que qualquer auditoria saiba que veio do endpoint legacy.
                reason: 'legacy GET /service/campaign/removeInspections (sem token)'
            };
            const after = await pointsService.softWipePoint(pointId, ctx);
            return response.status(200).json({ success: true, pointId, archivedAt: after.archivedAt });
        } catch (err) {
            await logger.error('Erro em removeInspections', {
                module: 'supervisor',
                function: 'removeInspections',
                metadata: { error: err.message, pointId }
            });
            return response.status(500).json({ error: err.message });
        }
    }

    Points.getCampaignConfig = function(request, response) {
        var campaignId = request.session.user.campaign._id;
        
        infoCampaign.findOne({'_id': campaignId}, function(err, campaign) {
            if (err) {
                response.status(500).json({ error: 'Erro ao buscar configurações da campanha' });
                return;
            }
            
            if (campaign) {
                // Retornar apenas as configurações relevantes
                var config = {
                    showTimeseries: campaign.showTimeseries !== false,
                    showPointInfo: campaign.showPointInfo !== false,
                    useDynamicMaps: campaign.useDynamicMaps || false,
                    // TKT-000006: sinaliza ao cliente se os gráficos de série
                    // temporal devem ser carregados automaticamente após o
                    // ponto ser aberto (padrão: true, mantendo retrocompatibilidade).
                    autoLoadTimeseries: campaign.autoLoadTimeseries !== false,
                    visParam: campaign.visParam || null,
                    visParams: campaign.visParams || [],
                    defaultVisParam: campaign.defaultVisParam || null,
                    imageType: campaign.imageType || null,
                    // Incluir configurações WMS
                    wmsConfig: campaign.wmsConfig || null,
                    wmsPeriod: campaign.wmsPeriod || 'BOTH',
                    // Classes de uso da terra e classe inicial padrão
                    // (TKT-000005) — permite ao inspetor ter a primeira caixa pré-preenchida
                    landUse: Array.isArray(campaign.landUse) ? campaign.landUse : [],
                    defaultLandUse: (typeof campaign.defaultLandUse === 'string') ? campaign.defaultLandUse : ''
                };

                response.json(config);
            } else {
                response.status(404).json({ error: 'Campanha não encontrada' });
            }
        });
    }


    // ===== MÉTODOS ADMIN (sem dependência de sessão) =====
    
    Points.getCampaignConfigAdmin = function(request, response) {
        var campaignId = request.query.campaignId;
        
        if (!campaignId) {
            return response.status(400).json({ error: 'Campaign ID is required' });
        }
        
        infoCampaign.findOne({'_id': campaignId}, function(err, campaign) {
            if (err) {
                response.status(500).json({ error: 'Erro ao buscar configurações da campanha' });
                return;
            }
            
            if (campaign) {
                // Retornar apenas as configurações relevantes
                response.json({
                    _id: campaign._id,
                    name: campaign.name,
                    typesUse: campaign.typesUse,
                    initialYear: campaign.initialYear,
                    finalYear: campaign.finalYear,
                    numInspec: campaign.numInspec
                });
            } else {
                response.status(404).json({ error: 'Campanha não encontrada' });
            }
        });
    }
    
    // DESATIVADA em 2026-05-09 — Tier 0 do plano de defesa contra perda de inspeções.
    // Implementação anterior aplicava `slice(0, -k)` em userName/inspection quando
    // `inspection.length > numInspec`, removendo sistematicamente o trabalho do 2º
    // inspetor. Endpoint disparado pelo atalho F10 em /admin/temporal sem confirmação.
    // Substituída por dry-run que apenas reporta a invocação, sem alterar dados.
    // Ver /tmp/tvi-investigation/DIAGNOSTICO.md §4.1 e clever-dreaming-pudding.md §0.2.
    Points.correctCampaignAdmin = async (request, response) => {
        const campaignId = request.query.campaignId;
        if (!campaignId) {
            return response.status(400).json({ error: 'Campaign ID is required' });
        }
        await logger.warn('correctCampaignAdmin invocado em modo dry-run (função desativada)', {
            module: 'supervisor',
            function: 'correctCampaignAdmin',
            metadata: {
                campaignId: campaignId,
                ip: request.ip,
                userAgent: request.get && request.get('user-agent')
            }
        });
        response.status(200).json({
            dryRun: true,
            message: 'Função temporariamente desativada para evitar perda de inspeções. Contate o suporte se precisar corrigir uma campanha.'
        });
    }
    
    // Tier 1.6 (2026-05-09) — migrada para pointsService.softWipePoint.
    // Mesma lógica de removeInspections, exposta por rota admin separada.
    Points.removeInspectionAdmin = async (request, response) => {
        const {pointId} = request.query;
        if (!pointId) {
            return response.status(400).send('PointId não encontrado.');
        }
        const pointsService = app.services && app.services.pointsService;
        if (!pointsService) {
            return response.status(500).send('pointsService indisponível');
        }
        try {
            const admin = request.session && request.session.admin;
            const ctx = {
                actor: {
                    username: (admin && admin.username) || 'admin-unknown',
                    role: (admin && admin.superAdmin) ? 'superAdmin' : 'admin',
                    sessionId: request.sessionID || null,
                    ip: request.ip || null
                },
                reason: 'legacy admin GET /service/admin/campaign/removeInspections (sem token)'
            };
            const after = await pointsService.softWipePoint(pointId, ctx);
            return response.status(200).json({ success: true, pointId, archivedAt: after.archivedAt });
        } catch (err) {
            await logger.error('Erro em removeInspectionAdmin', {
                module: 'supervisor',
                function: 'removeInspectionAdmin',
                metadata: { error: err.message, pointId }
            });
            return response.status(500).json({ error: err.message });
        }
    }

    return Points;
};
