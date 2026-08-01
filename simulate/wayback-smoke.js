/**
 * Smoke test do contrato real do Esri Wayback (rodar manualmente, com rede).
 * Valida: catálogo acessível, dedupe por tilemap e metadados num ponto do
 * Brasil (Goiânia). Uso: node simulate/wayback-smoke.js
 */
'use strict';

const { createWaybackService } = require('../src/server/services/waybackService');

const logger = {
    info: async (...a) => console.log('[info]', ...a),
    warn: async (...a) => console.warn('[warn]', ...a),
    error: async (...a) => console.error('[error]', ...a)
};

(async function main() {
    const svc = createWaybackService({ logger });

    const releases = await svc.getReleases();
    console.log('releases no catálogo:', releases.length);
    console.log('mais recente:', releases[0]);
    if (!releases.length || !releases[0].releaseDate) throw new Error('catálogo inválido');

    const lon = -49.25, lat = -16.68; // Goiânia
    const changes = await svc.getLocalChanges(lon, lat);
    console.log('releases com imagem distinta no ponto:', changes.length);
    console.log(changes.map(r => r.releaseDate).join(', '));
    if (!changes.length) throw new Error('dedupe retornou vazio para área urbana — verificar contrato tilemap');

    const meta = await svc.getMetadata(changes[0], lon, lat);
    console.log('metadados da release mais recente:', meta);

    console.log('\nSMOKE OK');
})().catch(err => { console.error('SMOKE FALHOU:', err.message); process.exit(1); });
