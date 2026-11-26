'use strict';

const crypto = require('crypto');

function failure(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function withLock(collection, campaignId, callback) {
    if (typeof campaignId !== 'string' || !campaignId.trim() || /[\u0000-\u001f\u007f]/.test(campaignId)) {
        throw failure(400, 'O identificador da campanha é inválido.');
    }
    if (!await collection.findOne({ _id: campaignId })) {
        throw failure(404, 'Campanha não encontrada.');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const acquired = await collection.findOneAndUpdate(
        { _id: campaignId, pointOperationId: { $exists: false }, pointImportLock: { $exists: false } },
        { $set: { pointImportLock: token } },
        { returnOriginal: false }
    );
    if (!acquired || !acquired.value) {
        throw failure(409, 'Há uma operação de pontos em andamento nesta campanha.');
    }
    try {
        return await callback(acquired.value);
    } finally {
        await collection.updateOne({ _id: campaignId, pointImportLock: token }, { $unset: { pointImportLock: '' } });
    }
}

module.exports = { withLock };
