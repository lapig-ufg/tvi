'use strict';
function invalid(message) {
    return Object.assign(new Error(message), { code: 'BDC_INVALID_REFERENCE' });
}
async function validate(collection, campaign, point, references) {
    if (campaign.imagerySource !== 'bdc') {
        if (references !== undefined && (!Array.isArray(references) || references.length)) {
            throw invalid('Referências BDC não pertencem a esta campanha.');
        }
        return undefined;
    }
    if (!Array.isArray(references) || !references.length || references.length > 400) {
        throw invalid('Informe as referências BDC utilizadas na inspeção.');
    }
    if (references.some(ref => !ref || typeof ref.selectionId !== 'string' || !/^[a-f0-9]{64}$/.test(ref.selectionId))) {
        throw invalid('Referência BDC inválida.');
    }
    const rows = await collection.find({ _id: { $in: [...new Set(references.map(ref => ref.selectionId))] },
        campaignId: campaign._id, pointId: point._id }, { state: 1, year: 1, period: 1, revision: 1, profiles: 1, kind: 1,
        'result.complete': 1, 'result.best_local_id': 1, 'result.rows.id': 1, 'result.rows.profiles': 1, 'result.rows.eligible': 1 }).toArray();
    const byId = new Map(rows.map(row => [row._id, row]));
    const seen = new Set();
    return references.map(ref => {
        const selection = byId.get(ref.selectionId);
        if (!selection || selection.kind === 'preview' || !['ready', 'no_image'].includes(selection.state)
            || !selection.result || selection.result.complete !== true) throw invalid('Referência BDC indisponível para este ponto.');
        const row = (selection.result.rows || []).find(value => value.id === selection.result.best_local_id && value.eligible);
        const allowed = (selection.profiles || []).filter(profile => selection.state === 'no_image' || row && (row.profiles || []).includes(profile));
        const viewed = ref.profilesViewed === undefined ? [ref.profile] : ref.profilesViewed;
        if (selection.year !== ref.year || selection.period !== ref.period || selection.revision !== ref.revision
            || !allowed.includes(ref.profile) || !Array.isArray(viewed) || !viewed.length || viewed.length > 32
            || !viewed.includes(ref.profile) || viewed.some(profile => !allowed.includes(profile))) {
            throw invalid('Referência BDC incompatível com a imagem apresentada.');
        }
        const key = selection.year + ':' + selection.period;
        if (seen.has(key)) throw invalid('Período BDC duplicado na inspeção.');
        seen.add(key);
        const result = { selectionId: selection._id, year: selection.year, period: selection.period,
            revision: selection.revision, profile: ref.profile };
        if (ref.profilesViewed !== undefined) result.profilesViewed = [...new Set(viewed)];
        return result;
    });
}
module.exports = { validate };
