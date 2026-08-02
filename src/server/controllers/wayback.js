/**
 * Controller do módulo Esri Wayback.
 *
 * Job de pré-computação: para cada ponto da campanha, consulta o Wayback
 * (dedupe via tilemap + metadados por release) e persiste waybackImages[] no
 * documento do ponto. Idempotente (pula pontos com waybackSyncedAt, salvo
 * force) e retomável; progresso e lock na coleção waybackSync (1 doc por
 * campanha). Nada aqui roda para campanhas de outros imageType.
 */
module.exports = function (app) {

    const Wayback = {};
    const logger = app.services.logger;
    const waybackService = app.services.waybackService;

    // Paralelismo de pontos do job, configurável por ambiente. O trabalho é
    // I/O puro contra a Esri; com METADATA_CONCURRENCY, o teto de requisições
    // em voo é SYNC_CONCURRENCY × METADATA_CONCURRENCY (padrão 20 × 5 = 100),
    // dentro do que o retry/backoff do waybackService absorve em throttling.
    const envConcurrency = parseInt(process.env.WAYBACK_SYNC_CONCURRENCY, 10);
    const SYNC_CONCURRENCY = envConcurrency > 0 ? envConcurrency : 20;
    // Consultas de metadados das releases de UM ponto, em paralelo entre si
    // (são independentes; a ordem final vem do sort por data de exibição).
    const METADATA_CONCURRENCY = 5;
    const MAX_ERRORS_LISTED = 50;

    const cols = function () { return app.repository.collections; };

    function displayDate(img) { return img.captureDate || img.releaseDate; }

    async function mapWithConcurrency(items, limit, fn) {
        const queue = items.slice();
        const workers = [];
        for (let w = 0; w < Math.min(limit, queue.length); w++) {
            workers.push((async function () {
                while (queue.length) {
                    const item = queue.shift();
                    await fn(item);
                }
            })());
        }
        await Promise.all(workers);
    }

    async function syncOnePoint(point) {
        const local = await waybackService.getLocalChanges(point.lon, point.lat);
        const images = new Array(local.length);
        await mapWithConcurrency(
            local.map(function (rel, idx) { return { rel: rel, idx: idx }; }),
            METADATA_CONCURRENCY,
            async function (item) {
                const meta = await waybackService.getMetadata(item.rel, point.lon, point.lat);
                images[item.idx] = {
                    releaseNum: item.rel.releaseNum,
                    releaseDate: item.rel.releaseDate,
                    captureDate: meta.captureDate,
                    source: meta.source,
                    resolution: meta.resolution
                };
            }
        );
        images.sort(function (a, b) { return displayDate(a).localeCompare(displayDate(b)); });
        // Escrita única e atômica por ponto: nunca persiste estado parcial.
        await cols().points.updateOne(
            { _id: point._id },
            { $set: { waybackImages: images, waybackSyncedAt: new Date() } }
        );
    }

    Wayback.runSyncJob = async function (campaignId, options) {
        const force = !!(options && options.force);
        const syncCol = cols().waybackSync;

        // Lock: só um sync por campanha. No driver 2.x o upsert concorrente
        // com filtro por status lança 11000 — tratado como "já em execução".
        // processed/errors são zerados aqui: são contadores de UMA execução
        // (essencial para o force, que reabre uma campanha já 'completed').
        try {
            const lock = await syncCol.findOneAndUpdate(
                { _id: campaignId, status: { $ne: 'running' } },
                { $set: { status: 'running', startedAt: new Date(), finishedAt: null, processed: 0, errors: [] } },
                { upsert: true, returnOriginal: false }
            );
            if (!lock || !lock.value) return { alreadyRunning: true };
        } catch (err) {
            if (err.code === 11000) return { alreadyRunning: true };
            throw err;
        }

        const filter = { campaign: campaignId, archivedAt: { $exists: false } };
        if (!force) filter.waybackSyncedAt = { $exists: false };
        const points = await cols().points.find(filter).toArray();
        await syncCol.updateOne({ _id: campaignId }, { $set: { total: points.length } });

        let processed = 0;
        let failed = [];

        // Progresso gravado com operadores comutativos ($inc/$push), não $set de
        // valor calculado: sob concorrência (SYNC_CONCURRENCY > 1) a ordem de
        // chegada dos updateOne no Mongo não é garantida seguir a ordem de
        // conclusão dos pontos, então um $set{processed} mais antigo podia
        // sobrescrever um mais novo e o contador regredir. $inc/$push são
        // aplicados atomicamente pelo Mongo independente da ordem de chegada.
        const processPass = async function (list, collectFailures) {
            await mapWithConcurrency(list, SYNC_CONCURRENCY, async function (point) {
                try {
                    await syncOnePoint(point);
                    processed++;
                    await syncCol.updateOne({ _id: campaignId }, { $inc: { processed: 1 } });
                } catch (err) {
                    const failure = { pointId: point._id, error: err.message };
                    collectFailures.push(failure);
                    await syncCol.updateOne({ _id: campaignId }, {
                        $push: { errors: { $each: [failure], $slice: MAX_ERRORS_LISTED } }
                    });
                }
            });
        };

        await processPass(points, failed);

        // Uma passada de retry sobre as falhas (transientes de rede).
        if (failed.length) {
            const retryIds = failed.map(function (f) { return f.pointId; });
            const retryPoints = points.filter(function (p) { return retryIds.indexOf(p._id) !== -1; });
            failed = [];
            await processPass(retryPoints, failed);
        }

        await syncCol.updateOne({ _id: campaignId }, {
            $set: {
                status: failed.length ? 'completed_with_errors' : 'completed',
                finishedAt: new Date(),
                total: points.length, processed: processed,
                errors: failed.slice(0, MAX_ERRORS_LISTED)
            }
        });

        await logger.info('Wayback sync concluído', {
            module: 'wayback', function: 'runSyncJob',
            metadata: { campaignId, total: points.length, processed, failedCount: failed.length }
        });

        return { total: points.length, processed: processed, failed: failed };
    };

    Wayback.triggerSyncIfWayback = async function (campaignId) {
        try {
            const campaign = await cols().campaign.findOne({ _id: campaignId });
            if (!campaign || campaign.imageType !== 'wayback') return;
            Wayback.runSyncJob(campaignId, {}).catch(async function (err) {
                await logger.error('Wayback sync automático falhou', {
                    module: 'wayback', function: 'triggerSyncIfWayback',
                    metadata: { campaignId, error: err.message }
                });
            });
        } catch (err) {
            await logger.error('Wayback triggerSyncIfWayback falhou', {
                module: 'wayback', function: 'triggerSyncIfWayback',
                metadata: { campaignId, error: err.message }
            });
        }
    };

    Wayback.startSync = async function (request, response) {
        const campaignId = request.params.campaignId;
        // Valida a campanha antes de disparar: sem isso, um campaignId errado (ou
        // uma campanha de outro imageType) gravaria waybackImages em milhares de
        // pontos legados e disparava dezenas de milhares de requisições à Esri.
        const campaign = await cols().campaign.findOne({ _id: campaignId });
        if (!campaign) {
            return response.status(404).json({ error: 'Campanha não encontrada.' });
        }
        if (campaign.imageType !== 'wayback') {
            return response.status(400).json({ error: 'Campanha não é do tipo wayback.' });
        }

        const force = request.query.force === '1' || request.query.force === 'true';
        Wayback.runSyncJob(campaignId, { force: force }).catch(async function (err) {
            await logger.error('Wayback sync manual falhou', {
                module: 'wayback', function: 'startSync',
                metadata: { campaignId, error: err.message }
            });
        });
        response.json({ started: true, campaignId: campaignId, force: force });
    };

    Wayback.status = async function (request, response) {
        const doc = await cols().waybackSync.findOne({ _id: request.params.campaignId });
        if (!doc) return response.status(404).json({ error: 'Nenhum sync registrado para esta campanha.' });
        response.json(doc);
    };

    Wayback.releases = async function (request, response) {
        try {
            const releases = await waybackService.getReleases();
            response.json(releases.map(function (r) {
                return { releaseNum: r.releaseNum, releaseDate: r.releaseDate, itemURL: r.itemURL };
            }));
        } catch (err) {
            const errorCode = await logger.error('Wayback: falha ao obter catálogo de releases', {
                module: 'wayback', function: 'releases', metadata: { error: err.message }
            });
            response.status(502).json({ error: 'Catálogo Wayback indisponível.', errorCode });
        }
    };

    return Wayback;
};
