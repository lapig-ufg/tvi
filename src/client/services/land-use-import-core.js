/**
 * LandUseImportCore: núcleo puro da importação das classes de uso da terra
 * de outra campanha no cadastro (sem Angular).
 *
 * UMD mínimo como sample-marker-core.js: no browser registra
 * window.LandUseImportCore; em Node exporta via module.exports. ES5 por
 * compatibilidade com o restante do client (AngularJS 1.5.8).
 */
(function (global) {
    'use strict';

    var LandUseImportCore = {

        // Campanhas de origem devolvidas por GET /api/campaigns/search com
        // withLandUse=true, sem a campanha em edição.
        sources: function (results, currentCampaignId) {
            if (!Array.isArray(results)) {
                return [];
            }
            return results.filter(function (result) {
                return result && result.id !== currentCampaignId && Array.isArray(result.landUse) && result.landUse.length > 0;
            }).map(function (result) {
                return { id: result.id, count: result.landUse.length, landUse: result.landUse };
            });
        },

        // A lista importada substitui a atual sem nenhuma alteração de ordem
        // ou grafia; a classe padrão da primeira caixa só sobrevive se
        // existir na nova lista.
        importLandUse: function (sourceLandUse, currentDefaultLandUse) {
            var landUse = Array.isArray(sourceLandUse) ? sourceLandUse.slice() : [];
            var keepDefault = typeof currentDefaultLandUse === 'string' && landUse.indexOf(currentDefaultLandUse) !== -1;
            return { landUse: landUse, defaultLandUse: keepDefault ? currentDefaultLandUse : '' };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LandUseImportCore;
    }
    if (global) {
        global.LandUseImportCore = LandUseImportCore;
    }
})(typeof window !== 'undefined' ? window : null);
