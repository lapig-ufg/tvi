'use strict';
function matches(doc, query) {
    return Object.keys(query).every(key => {
        const value = key.split('.').reduce((current, part) => current && current[part], doc);
        const expected = query[key];
        if (key === '$or') return expected.some(branch => matches(doc, branch));
        if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
            return Object.keys(expected).every(operator => {
                if (operator === '$in') return expected[operator].includes(value);
                if (operator === '$exists') return (value !== undefined) === expected[operator];
                if (operator === '$lte') return value <= expected[operator];
                if (operator === '$gt') return value > expected[operator];
                if (operator === '$ne') return value !== expected[operator];
                return false;
            });
        }
        return value === expected;
    });
}
function collection(initial = []) {
    const docs = new Map(initial.map(doc => [doc._id, structuredClone(doc)]));
    return {
        docs,
        find(query) { return { toArray: async () => [...docs.values()].filter(doc => matches(doc, query)).map(doc => structuredClone(doc)) }; },
        async findOne(query) { const value = [...docs.values()].find(doc => matches(doc, query)); return value ? structuredClone(value) : null; },
        async updateOne(query, update, options = {}) {
            let value = [...docs.values()].find(doc => matches(doc, query));
            if (!value && options.upsert) {
                if (docs.has(query._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
                value = structuredClone(update.$setOnInsert || { _id: query._id }); docs.set(value._id, value);
            }
            if (!value) return { matchedCount: 0, modifiedCount: 0 };
            if (update.$set) Object.assign(value, structuredClone(update.$set));
            if (update.$inc) Object.keys(update.$inc).forEach(key => { value[key] = (value[key] || 0) + update.$inc[key]; });
            if (update.$addToSet) Object.keys(update.$addToSet).forEach(key => {
                const additions = update.$addToSet[key].$each || [update.$addToSet[key]];
                value[key] = [...new Set((value[key] || []).concat(structuredClone(additions)))];
            });
            if (update.$unset) Object.keys(update.$unset).forEach(key => delete value[key]);
            return { matchedCount: 1, modifiedCount: 1 };
        }
    };
}
const campaign = { _id: 'c', imagerySource: 'bdc', initialYear: 2020, finalYear: 2021, imageType: 'landsat', numInspec: 3,
    bdcConfig: { selectionRevision: 1, collection: 'landsat-2', bufferRadiusM: 1000, selectionStrategy: 'local_cloud',
        profiles: ['natural', 'false-color'], defaultProfile: 'natural' } };
const point = { _id: 'p', campaign: 'c', lat: -3, lon: -49, userName: [], inspection: [] };
function ready(id = 'b'.repeat(64)) {
    return { id, state: 'ready', algorithm_version: 'bdc-local-quality-v1', result: { complete: true, evaluated: 1, eligible: 1,
        best_local_id: 'scene', best_global_id: 'scene', rows: [{ id: 'scene', eligible: true, datetime: '2020-08-01T12:00:00Z',
            cloud_pct: 3, unusable_pct: 5, profiles: ['natural', 'false-color'] }] } };
}
module.exports = { collection, campaign, point, ready };
