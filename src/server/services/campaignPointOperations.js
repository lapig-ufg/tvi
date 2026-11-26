'use strict';
const crypto = require('crypto');
const { ObjectID } = require('mongodb');
const { parseInput } = require('./pointMutationInput');

const COLLECTION = 'campaign_point_operations';
const LEASE_MS = 120000;
const PREVIEW_MS = 15 * 60 * 1000;
const SNAPSHOT_FIELDS = ['campaign', 'index', 'lon', 'lat', 'userName', 'userNameCount', 'inspection',
    'classConsolidated', 'classConsolidatedOriginal', 'archivedAt', 'archivedReason', 'properties',
    'doubt', 'pointEdited', 'biome', 'uf', 'county', 'countyCode', 'path', 'row', 'waybackImages', 'mode'];
const INDEXES = [
    { key: { campaignId: 1, createdAt: -1 }, name: 'campaign_created' },
    { key: { status: 1, leaseUntil: 1, createdAt: 1 }, name: 'worker_queue' }
];

function error(message, statusCode = 409) {
    return Object.assign(new Error(message), { statusCode, publicMessage: message });
}
function canonical(value) {
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value.toHexString === 'function') return value.toHexString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => {
        out[key] = canonical(value[key]); return out;
    }, {});
    return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function snapshot(point) {
    const result = {};
    Object.keys(point).forEach(key => {
        if (!['underInspection', 'pointMutationLock'].includes(key)) result[key] = point[key];
    });
    return result;
}
function matched(result) { return result && (result.matchedCount !== undefined ? result.matchedCount : result.result && result.result.n); }
function id() { return crypto.randomBytes(16).toString('hex'); }
function equalField(query, source, field) { query[field] = source[field] === undefined ? { $exists: false } : { $eq: source[field] }; }
function normalizeProperty(properties, names) {
    const keys = Object.keys(properties || {});
    for (const name of names) {
        const key = keys.find(value => value.toLowerCase() === name);
        if (key !== undefined && properties[key] !== null && properties[key] !== '') return properties[key];
    }
    return null;
}
function present(job, detailed = true) {
    if (!job) return null;
    const outcomes = job.outcomes || [];
    const result = {
        id: job._id, campaignId: job.campaignId, kind: job.kind, status: job.status,
        createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: job.expiresAt,
        total: job.rows.length, inspections: job.inspections || 0, issues: (job.issues || []).map(issue => ({ row: issue.row, reason: issue.reason || issue.message })),
        canApply: job.status === 'preview' && job.canApply && job.expiresAt > new Date(),
        processed: job.cursor || 0, added: outcomes.filter(row => row.status === 'added').length,
        deleted: outcomes.filter(row => row.status === 'deleted').length,
        skipped: outcomes.filter(row => row.status === 'skipped').length,
        error: job.publicError || null, reason: job.reason || null,
        resumable: job.status === 'failed',
        outcomes: outcomes.slice(0, 50).map(row => ({ id: row.id, status: row.status, reason: row.reason || null })),
        outcomeCount: outcomes.length
    };
    if (detailed) {
        result.rows = job.rows.slice(0, 50).map(row => ({ id: row.pointId || row.entry.id || null,
            lon: row.lon, lat: row.lat, inspections: row.inspections || 0, issue: row.issue || null }));
    }
    return result;
}

function create(db) {
    const jobs = db.collection(COLLECTION);
    const points = db.collection('points');
    const campaigns = db.collection('campaign');
    const blocks = db.collection('tvi_blocos');
    const audits = db.collection('points_audit');
    const presence = db.collection('status');
    const selections = db.collection('campaignImageSelections');
    const offlineJobs = db.collection('offline_cache_jobs');
    const offlineItems = db.collection('offline_cache_items');

    async function campaign(campaignId) {
        if (typeof campaignId !== 'string' || !campaignId.length || campaignId.length > 200) throw error('Campanha inválida.', 400);
        const value = await campaigns.findOne({ _id: campaignId });
        if (!value) throw error('Campanha não encontrada.', 404);
        return value;
    }
    async function ownedJob(campaignId, actor, operationId) {
        if (!/^[a-f0-9]{32}$/.test(operationId || '')) throw error('Operação não encontrada.', 404);
        const value = await jobs.findOne({ _id: operationId, campaignId, actor });
        if (!value) throw error('Operação não encontrada.', 404);
        return value;
    }
    async function preview(campaignId, actor, body) {
        const currentCampaign = await campaign(campaignId);
        if (!actor || typeof actor !== 'string') throw error('Identificação do administrador ausente.', 401);
        const entries = await parseInput(body);
        if (body.kind === 'add' && body.format !== 'geojson') throw error('A inclusão exige um arquivo GeoJSON.', 400);
        const rows = [];
        const foundIds = new Set();
        for (const entry of entries) {
            let candidates;
            if (body.format === 'geojson') candidates = await points.find({ campaign: campaignId, lon: entry.lon, lat: entry.lat }).limit(2).toArray();
            else candidates = await points.find({ campaign: campaignId, _id: entry.id }).limit(2).toArray();
            const row = { entry, lon: entry.lon, lat: entry.lat };
            if (body.kind === 'add') {
                if (candidates.length) row.issue = 'As coordenadas já existem na campanha.';
            } else if (candidates.length !== 1) {
                row.issue = candidates.length ? 'As coordenadas correspondem a mais de um ponto.' : 'Ponto não encontrado na campanha.';
            } else {
                const point = candidates[0];
                row.pointId = point._id;
                row.lon = point.lon;
                row.lat = point.lat;
                row.fingerprint = digest(snapshot(point));
                row.inspections = Array.isArray(point.inspection) ? point.inspection.length : 0;
                if (foundIds.has(String(point._id))) row.issue = 'O ponto foi selecionado mais de uma vez.';
                foundIds.add(String(point._id));
                if (await presence.findOne({ campaign: campaignId, atualPoint: point._id, status: 'Online' }, { _id: 1 })) row.issue = 'O ponto está aberto em uma sessão de inspeção.';
                if (point.underInspection > 0 || point.pointMutationLock !== undefined) row.issue = 'O ponto está reservado ou bloqueado.';
                if (await blocks.findOne({ campaignId, pointIds: point._id, status: 'assigned' }, { _id: 1 })) row.issue = 'O ponto pertence a um bloco atribuído.';
            }
            rows.push(row);
        }
        const issues = rows.map((row, index) => row.issue ? { row: index + 1, message: row.issue } : null).filter(Boolean);
        if (currentCampaign.pointOperationId || currentCampaign.pointImportLock) issues.unshift({ message: 'Há outra operação de pontos em andamento.' });
        const now = new Date();
        const job = { _id: id(), campaignId, actor, kind: body.kind, format: body.format, rows,
            issues, canApply: issues.length === 0, inspections: rows.reduce((sum, row) => sum + (row.inspections || 0), 0),
            campaignFingerprint: digest({ numInspec: currentCampaign.numInspec, imageType: currentCampaign.imageType }),
            status: 'preview', cursor: 0, outcomes: [], createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + PREVIEW_MS) };
        await jobs.insertOne(job);
        return present(job);
    }
    function validateConfirmation(campaignId, body) {
        if (!body || body.confirmation !== campaignId || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) {
            throw error('Confirme o identificador da campanha e informe um motivo com 10 a 2000 caracteres.', 400);
        }
    }
    async function completeConfirmation(job) {
        const currentCampaign = await campaign(job.campaignId);
        if (job.campaignFingerprint !== digest({ numInspec: currentCampaign.numInspec, imageType: currentCampaign.imageType })) {
            await jobs.updateOne({ _id: job._id, status: 'confirming' }, { $set: {
                status: 'failed', updatedAt: new Date(), publicError: 'A configuração da campanha mudou. Gere outra prévia.'
            } });
            throw error('A configuração da campanha mudou. Gere outra prévia.');
        }
        const lockQuery = { _id: job.campaignId, pointImportLock: { $exists: false },
            $or: [{ pointOperationId: { $exists: false } }, { pointOperationId: job._id }] };
        equalField(lockQuery, currentCampaign, 'numInspec');
        equalField(lockQuery, currentCampaign, 'imageType');
        const lock = await campaigns.updateOne(lockQuery,
        { $set: { pointOperationId: job._id } });
        if (matched(lock) !== 1) {
            await jobs.updateOne({ _id: job._id, status: 'confirming' }, { $set: {
                status: 'failed', updatedAt: new Date(), publicError: 'Outra operação está alterando os pontos desta campanha.'
            } });
            throw error('Outra operação está alterando os pontos desta campanha.');
        }
        await jobs.updateOne({ _id: job._id, status: 'confirming' },
            { $set: { status: 'queued', updatedAt: new Date(), publicError: null },
                $unset: { leaseToken: '', leaseUntil: '' } });
        const current = await jobs.findOne({ _id: job._id });
        if (current && current.status === 'completed') await campaigns.updateOne({ _id: job.campaignId, pointOperationId: job._id },
            { $unset: { pointOperationId: '', pointOperationRange: '' } });
        return current;
    }
    async function queue(campaignId, actor, operationId, body, resume) {
        validateConfirmation(campaignId, body);
        const job = await ownedJob(campaignId, actor, operationId);
        if (!resume && ['queued', 'running', 'completed'].includes(job.status)) return present(job);
        if (job.status === 'confirming') return present(await completeConfirmation(job));
        if (resume ? job.status !== 'failed' : job.status !== 'preview' || !job.canApply || job.expiresAt <= new Date()) {
            throw error(resume ? 'A operação não está disponível para retomada.' : 'A prévia expirou ou contém impedimentos.');
        }
        const currentCampaign = await campaign(campaignId);
        if (!resume && job.campaignFingerprint !== digest({ numInspec: currentCampaign.numInspec, imageType: currentCampaign.imageType })) {
            throw error('A configuração da campanha mudou. Gere outra prévia.');
        }
        const filter = { _id: operationId, status: resume ? 'failed' : 'preview' };
        if (!resume) filter.expiresAt = { $gt: new Date() };
        const transition = await jobs.updateOne(filter, { $set: { status: 'confirming',
            reason: body.reason.trim(), confirmedAt: new Date(), updatedAt: new Date() } });
        if (matched(transition) !== 1) {
            const updated = await ownedJob(campaignId, actor, operationId);
            if (updated.status === 'confirming') return present(await completeConfirmation(updated));
            if (!['queued', 'running', 'completed'].includes(updated.status)) throw error('A operação mudou durante a confirmação.');
            return present(updated);
        }
        return present(await completeConfirmation(Object.assign(job, { status: 'confirming' })));
    }
    async function renew(job, token) {
        const now = new Date();
        const result = await jobs.updateOne({ _id: job._id, status: 'running', leaseToken: token, leaseUntil: { $gt: now } },
            { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now } });
        if (matched(result) !== 1) throw Object.assign(error('A execução perdeu a reserva de processamento.'), { leaseLost: true });
        if (!await campaigns.findOne({ _id: job.campaignId, pointOperationId: job._id }, { _id: 1 })) {
            throw error('A reserva da campanha não pertence a esta operação.');
        }
    }
    async function save(job, token, fields) {
        const result = await jobs.updateOne({ _id: job._id, status: 'running', leaseToken: token, cursor: job.cursor, leaseUntil: { $gt: new Date() } }, { $set: Object.assign({ updatedAt: new Date() }, fields) });
        if (matched(result) !== 1) throw Object.assign(error('A execução perdeu a reserva de processamento.'), { leaseLost: true });
        Object.assign(job, fields);
    }
    async function invalidateOffline(job) {
        await offlineJobs.updateOne({ _id: job.campaignId }, { $set: { status: 'stale', updated_at: new Date(), lease_until: new Date() },
            $unset: { lease_token: '', progress_summary: '' } });
    }
    async function allocate(job, token) {
        if (job.range) return;
        await renew(job, token);
        let current = await campaign(job.campaignId);
        let range = current.pointOperationRange;
        if (!range || range.id !== job._id) {
            const last = await points.find({ campaign: job.campaignId }).sort({ index: -1 }).limit(1).toArray();
            const lastBlock = await blocks.find({ campaignId: job.campaignId }).sort({ blockIndex: -1 }).limit(1).toArray();
            const firstBlock = await blocks.findOne({ campaignId: job.campaignId });
            const maxIndex = last.length ? Number(last[0].index) : 0;
            const sequence = Number(current.pointSequence || 0);
            const rounds = Number(current.numInspec || 1);
            if (!Number.isSafeInteger(maxIndex) || !Number.isSafeInteger(sequence) || maxIndex < 0 || sequence < 0
                || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100) throw error('Os índices ou o número de inspeções da campanha são inválidos.');
            const start = Math.max(maxIndex, sequence) + 1;
            const end = start + job.rows.length - 1;
            if (!Number.isSafeInteger(end)) throw error('O limite de índices da campanha foi atingido.');
            range = { id: job._id, start, end, blocksEnabled: !!firstBlock, rounds,
                blockStart: lastBlock.length ? Number(lastBlock[0].blockIndex) + 1 : 1,
                blockSize: firstBlock ? Math.max(1, Math.min(1000, Number(firstBlock.size) || 5)) : 5,
                timeoutMinutes: firstBlock ? Number(firstBlock.timeoutMinutes) || 480 : 480 };
            if (!Number.isSafeInteger(range.blockStart) || !Number.isSafeInteger(range.blockSize)) throw error('Os índices dos blocos da campanha são inválidos.');
            const query = { _id: job.campaignId, pointOperationId: job._id };
            equalField(query, current, 'pointSequence');
            equalField(query, current, 'pointOperationRange');
            const result = await campaigns.updateOne(query, { $set: { pointSequence: end, pointOperationRange: range } });
            if (matched(result) !== 1) {
                current = await campaign(job.campaignId);
                if (!current.pointOperationRange || current.pointOperationRange.id !== job._id) throw error('A reserva de índices mudou durante a execução.');
                range = current.pointOperationRange;
            }
        }
        await save(job, token, { range });
    }
    async function addPoint(job, row, index, token) {
        await renew(job, token);
        const pointIndex = job.range.start + index;
        const pointId = pointIndex + '_' + job.campaignId;
        const existing = await points.findOne({ _id: pointId });
        if (existing) {
            if (existing.pointMutationLock === 'removed:' + job._id && existing.campaign === undefined) {
                return { id: pointId, status: 'skipped', reason: 'As coordenadas já existem na campanha.' };
            }
            if (existing.createdByOperation !== job._id || existing.campaign !== job.campaignId
                || existing.lon !== row.lon || existing.lat !== row.lat) throw error('O identificador reservado já está em uso.');
            if (await points.findOne({ campaign: job.campaignId, lon: row.lon, lat: row.lat, _id: { $ne: pointId } }, { _id: 1 })) {
                throw error('Uma inclusão concorrente deixou coordenadas duplicadas. O ponto permanece bloqueado.');
            }
            return { id: pointId, status: 'added' };
        }
        if (await points.findOne({ campaign: job.campaignId, lon: row.lon, lat: row.lat }, { _id: 1 })) {
            try {
                await points.insertOne({ _id: pointId, pointMutationLock: 'removed:' + job._id, pointRemovedAt: new Date() });
            } catch (failure) {
                if (failure.code !== 11000) throw failure;
                const marker = await points.findOne({ _id: pointId });
                if (!marker || marker.campaign !== undefined || marker.pointMutationLock !== 'removed:' + job._id) {
                    throw error('Uma inclusão concorrente deixou coordenadas duplicadas. O ponto permanece bloqueado.');
                }
            }
            return { id: pointId, status: 'skipped', reason: 'As coordenadas já existem na campanha.' };
        }
        const properties = row.entry.properties || {};
        const point = { _id: pointId, campaign: job.campaignId, index: pointIndex, lon: row.lon, lat: row.lat,
            userName: [], inspection: [], underInspection: 0, userNameCount: 0,
            properties, dateImport: new Date(), cached: false, enhance_in_cache: 1,
            biome: normalizeProperty(properties, ['biome', 'bioma']), uf: normalizeProperty(properties, ['uf', 'estado', 'state']),
            county: normalizeProperty(properties, ['county', 'municipio', 'município']),
            countyCode: normalizeProperty(properties, ['countycode', 'cod_municipio', 'codigo_municipio']),
            path: normalizeProperty(properties, ['path']), row: normalizeProperty(properties, ['row']),
            pointMutationLock: job._id, createdByOperation: job._id };
        try { await points.insertOne(point); }
        catch (failure) {
            if (failure.code !== 11000) throw failure;
            const duplicate = await points.findOne({ _id: pointId, campaign: job.campaignId, createdByOperation: job._id });
            if (!duplicate || duplicate.lon !== row.lon || duplicate.lat !== row.lat) throw error('O identificador reservado já está em uso.');
        }
        return { id: pointId, status: 'added' };
    }
    async function lockBlocks(job, pointId) {
        const relevant = await blocks.find({ campaignId: job.campaignId, pointIds: pointId }).toArray();
        if (relevant.some(block => block.status === 'assigned')) return false;
        for (const block of relevant) {
            const query = { _id: block._id, campaignId: job.campaignId, status: { $ne: 'assigned' },
                $or: [{ pointMutationLock: { $exists: false } }, { pointMutationLock: job._id }] };
            equalField(query, block, 'pointIds');
            equalField(query, block, 'currentPointOffset');
            equalField(query, block, 'status');
            const result = await blocks.updateOne(query, { $set: { pointMutationLock: job._id } });
            if (matched(result) !== 1) return false;
        }
        return !(await blocks.findOne({ campaignId: job.campaignId, pointIds: pointId,
            $or: [{ status: 'assigned' }, { pointMutationLock: { $ne: job._id } }] }, { _id: 1 }));
    }
    async function cleanupDeleted(job, pointId, token) {
        await renew(job, token);
        const relevant = await blocks.find({ campaignId: job.campaignId, pointIds: pointId }).toArray();
        for (const block of relevant) {
            if (block.pointMutationLock !== job._id || block.status === 'assigned') throw error('Um bloco mudou durante a remoção.');
            const prior = block.pointIds || [];
            const remaining = prior.filter(value => String(value) !== String(pointId));
            const offset = Math.max(0, Math.min(prior.length, Number(block.currentPointOffset) || 0));
            const nextOffset = prior.slice(0, offset).filter(value => String(value) !== String(pointId)).length;
            const query = { _id: block._id, campaignId: job.campaignId, pointMutationLock: job._id,
                status: { $ne: 'assigned' }, pointIds: { $eq: prior } };
            equalField(query, block, 'currentPointOffset');
            if (!remaining.length) {
                if (matched(await blocks.replaceOne(query, { _id: block._id,
                    pointMutationLock: 'removed:' + job._id, pointRemovedAt: new Date() })) !== 1) throw error('Um bloco mudou durante a remoção.');
            } else {
                const change = { pointIds: remaining, size: remaining.length, currentPointOffset: nextOffset };
                if (nextOffset >= remaining.length && block.status === 'available') change.status = 'completed';
                if (matched(await blocks.updateOne(query, { $set: change })) !== 1) throw error('Um bloco mudou durante a remoção.');
            }
        }
        await selections.deleteMany({ campaignId: job.campaignId, pointId });
        await offlineItems.deleteMany({ point_ref: pointId });
    }
    async function deletePoint(job, row, token) {
        await renew(job, token);
        const pointId = row.pointId;
        const auditId = 'point-operation:' + job._id + ':' + digest(pointId);
        const previousAudit = await audits.findOne({ _id: auditId });
        let point = await points.findOne({ _id: pointId, campaign: job.campaignId });
        if (!point) {
            if (!previousAudit) return { id: pointId, status: 'skipped', reason: 'O ponto não existe mais na campanha.' };
            await cleanupDeleted(job, pointId, token);
            await audits.updateOne({ _id: auditId }, { $set: { deletionCompletedAt: new Date() } });
            return { id: pointId, status: 'deleted' };
        }
        if (digest(snapshot(point)) !== row.fingerprint) return { id: pointId, status: 'skipped', reason: 'O ponto mudou após a prévia.' };
        if (await presence.findOne({ campaign: job.campaignId, atualPoint: pointId, status: 'Online' }, { _id: 1 })) {
            return { id: pointId, status: 'skipped', reason: 'O ponto está aberto em uma sessão de inspeção.' };
        }
        if (point.underInspection > 0 || point.pointMutationLock !== undefined && point.pointMutationLock !== job._id) {
            return { id: pointId, status: 'skipped', reason: 'O ponto está reservado ou bloqueado.' };
        }
        const filter = { _id: pointId, campaign: job.campaignId, $and: [
            { $or: [{ underInspection: { $lte: 0 } }, { underInspection: { $exists: false } }] },
            { $or: [{ pointMutationLock: { $exists: false } }, { pointMutationLock: job._id }] }
        ] };
        Array.from(new Set(SNAPSHOT_FIELDS.concat(Object.keys(snapshot(point))))).forEach(field => equalField(filter, point, field));
        if (matched(await points.updateOne(filter, { $set: { pointMutationLock: job._id } })) !== 1) {
            return { id: pointId, status: 'skipped', reason: 'O ponto mudou ou foi reservado durante a execução.' };
        }
        if (!await lockBlocks(job, pointId)) {
            await points.updateOne({ _id: pointId, campaign: job.campaignId, pointMutationLock: job._id }, { $unset: { pointMutationLock: '' } });
            return { id: pointId, status: 'skipped', reason: 'O ponto pertence a um bloco atribuído ou alterado.' };
        }
        point = await points.findOne({ _id: pointId, campaign: job.campaignId, pointMutationLock: job._id });
        if (!point || digest(snapshot(point)) !== row.fingerprint || point.underInspection > 0) throw error('O ponto mudou após a reserva para remoção.');
        if (Number.isSafeInteger(point.index) && point.index >= 0) {
            const preserved = await campaigns.updateOne({ _id: job.campaignId, pointOperationId: job._id },
                { $max: { pointSequence: point.index } });
            if (matched(preserved) !== 1) throw error('A reserva da campanha mudou durante a remoção.');
        }
        await audits.updateOne({ _id: auditId }, { $setOnInsert: {
            _id: auditId, ts: new Date(), pointId, campaignId: job.campaignId, operation: 'delete_point',
            operationId: job._id, actor: { username: job.actor, role: 'superAdmin' }, reason: job.reason,
            before: point, after: null
        } }, { upsert: true });
        await renew(job, token);
        const deletionFilter = { _id: pointId, campaign: job.campaignId, pointMutationLock: job._id,
            $or: [{ underInspection: { $lte: 0 } }, { underInspection: { $exists: false } }] };
        Array.from(new Set(SNAPSHOT_FIELDS.concat(Object.keys(snapshot(point)))))
            .forEach(field => equalField(deletionFilter, point, field));
        const deletion = await points.replaceOne(deletionFilter,
            { _id: pointId, pointMutationLock: 'removed:' + job._id, pointRemovedAt: new Date() });
        if (matched(deletion) !== 1) {
            if (await points.findOne({ _id: pointId, campaign: job.campaignId })) throw error('O ponto não pôde ser removido.');
        }
        await cleanupDeleted(job, pointId, token);
        await audits.updateOne({ _id: auditId }, { $set: { deletionCompletedAt: new Date() } });
        return { id: pointId, status: 'deleted' };
    }
    async function buildNewBlocks(job, token, limit) {
        if (!job.range.blocksEnabled) return true;
        const inserted = await points.find({ campaign: job.campaignId, createdByOperation: job._id }, { _id: 1, index: 1 }).sort({ index: 1 }).toArray();
        const chunks = Math.ceil(inserted.length / job.range.blockSize);
        const total = chunks * job.range.rounds;
        let cursor = job.blockCursor || 0;
        for (let count = 0; cursor < total && count < limit; cursor++, count++) {
            await renew(job, token);
            const chunkIndex = Math.floor(cursor / job.range.rounds);
            const round = cursor % job.range.rounds + 1;
            const chunk = inserted.slice(chunkIndex * job.range.blockSize, (chunkIndex + 1) * job.range.blockSize);
            const blockId = new ObjectID(digest(['point-operation', job._id, cursor]).slice(0, 24));
            const block = { _id: blockId, campaignId: job.campaignId, blockIndex: job.range.blockStart + chunkIndex,
                inspectionRound: round, pointIds: chunk.map(point => point._id), size: chunk.length,
                pointIndexStart: chunk[0].index, pointIndexEnd: chunk[chunk.length - 1].index,
                status: 'available', currentPointOffset: 0, assignedTo: null, assignedAt: null,
                timeoutMinutes: job.range.timeoutMinutes, createdAt: new Date(), createdByOperation: job._id,
                pointMutationLock: job._id };
            const existing = await blocks.findOne({ _id: blockId });
            if (existing && (existing.createdByOperation !== job._id || existing.campaignId !== job.campaignId
                || digest(existing.pointIds) !== digest(block.pointIds))) throw error('Um bloco reservado apresenta conteúdo divergente.');
            await blocks.updateOne({ _id: blockId, createdByOperation: job._id }, { $setOnInsert: block }, { upsert: true });
            await save(job, token, { blockCursor: cursor + 1 });
        }
        return cursor >= total;
    }
    async function finish(job, token) {
        await renew(job, token);
        if (job.kind === 'add') {
            const fields = Array.from(new Set(job.rows.filter((row, index) => (job.outcomes[index] || {}).status === 'added')
                .reduce((all, row) => all.concat(Object.keys(row.entry.properties || {})), [])));
            if (fields.length) await campaigns.updateOne({ _id: job.campaignId, pointOperationId: job._id }, { $addToSet: { properties: { $each: fields } } });
        }
        await invalidateOffline(job);
        await renew(job, token);
        await points.updateMany({ campaign: job.campaignId, pointMutationLock: job._id }, { $unset: { pointMutationLock: '' } });
        await blocks.updateMany({ campaignId: job.campaignId, pointMutationLock: job._id }, { $unset: { pointMutationLock: '' } });
        await save(job, token, { status: 'completed', completedAt: new Date(), publicError: null });
        await campaigns.updateOne({ _id: job.campaignId, pointOperationId: job._id }, { $unset: { pointOperationId: '', pointOperationRange: '' } });
    }
    async function processNext(limit = 20) {
        limit = Math.max(1, Math.min(20, Number(limit) || 20));
        const confirming = await jobs.findOne({ status: 'confirming' });
        if (confirming) await completeConfirmation(confirming);
        const now = new Date();
        const token = id();
        const claim = await jobs.findOneAndUpdate({ $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lte: now } }] },
            { $set: { status: 'running', leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now } },
            { sort: { createdAt: 1 }, returnOriginal: false });
        const job = claim && claim.value;
        if (!job) {
            const locked = await campaigns.find({ pointOperationId: { $exists: true } }, { _id: 1, pointOperationId: 1 }).limit(20).toArray();
            for (const item of locked) {
                if (await jobs.findOne({ _id: item.pointOperationId, status: 'completed' }, { _id: 1 })) {
                    await campaigns.updateOne({ _id: item._id, pointOperationId: item.pointOperationId },
                        { $unset: { pointOperationId: '', pointOperationRange: '' } });
                }
            }
            return null;
        }
        try {
            await renew(job, token);
            await invalidateOffline(job);
            if (job.kind === 'add') await allocate(job, token);
            for (let count = 0; job.cursor < job.rows.length && count < limit; count++) {
                const cursor = job.cursor;
                const row = job.rows[cursor];
                const outcome = job.kind === 'add' ? await addPoint(job, row, cursor, token) : await deletePoint(job, row, token);
                await save(job, token, { cursor: cursor + 1, outcomes: (job.outcomes || []).concat(outcome) });
            }
            if (job.cursor === job.rows.length && (job.kind !== 'add' || await buildNewBlocks(job, token, limit))) {
                await finish(job, token);
            } else {
                await save(job, token, { status: 'queued', leaseUntil: new Date() });
            }
        } catch (failure) {
            if (!failure.leaseLost) {
                await jobs.updateOne({ _id: job._id, status: 'running', leaseToken: token }, { $set: {
                    status: 'failed', updatedAt: new Date(), leaseUntil: new Date(),
                    publicError: failure.publicMessage || 'A operação foi interrompida. Os pontos pendentes permanecem protegidos; retome após verificar a causa.'
                } });
            }
            throw failure;
        }
        return present(await jobs.findOne({ _id: job._id }));
    }
    return {
        preview, confirm: (campaignId, actor, operationId, body) => queue(campaignId, actor, operationId, body, false),
        resume: (campaignId, actor, operationId, body) => queue(campaignId, actor, operationId, body, true),
        get: async (campaignId, actor, operationId) => present(await ownedJob(campaignId, actor, operationId)),
        list: async (campaignId, actor) => { await campaign(campaignId); return { operations: (await jobs.find({ campaignId, actor, status: { $ne: 'preview' } }).sort({ createdAt: -1 }).limit(20).toArray()).map(job => present(job, false)) }; },
        processNext
    };
}
module.exports = function (app) {
    function service() { return create(app.repository.db); }
    const result = {};
    ['preview', 'confirm', 'resume', 'get', 'list', 'processNext'].forEach(name => { result[name] = (...args) => service()[name](...args); });
    return result;
};
module.exports.create = create;
module.exports.COLLECTION = COLLECTION;
module.exports.INDEXES = INDEXES;
module.exports.digest = digest;
module.exports.snapshot = snapshot;
module.exports.present = present;
