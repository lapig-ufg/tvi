'use strict';

Application.run(function(AdminPages, $http, $q) {
    AdminPages.register('mosaic-comparison', {
        title: 'Comparação de imagens',
        templateUrl: 'views/mosaic-dialog.tpl.html',
        controller: 'MosaicDialogController',
        parent: function(params) {
            return '/admin/temporal?campaignId=' + encodeURIComponent(params.campaignId || '') + '&pointId=' + encodeURIComponent(params.pointId || '');
        },
        load: function(params) {
            if (params.period !== 'WET' && params.period !== 'DRY') throw new Error('Período inválido.');
            if (!params.campaignId || !params.pointId) throw new Error('Informe a campanha e o ponto.');
            var year = Number(params.year);
            return $q.all([
                $http.get('/service/admin/points/' + encodeURIComponent(params.pointId)),
                $http.get('/api/campaigns/' + encodeURIComponent(params.campaignId)),
                $http.get('/service/admin/capabilities')
            ]).then(function(responses) {
                var point = responses[0].data, campaign = responses[1].data, capabilities = responses[2].data;
                if (!point || point._id !== params.pointId || point.campaign !== params.campaignId) throw new Error('Ponto não encontrado nesta campanha.');
                if (!Number.isInteger(year) || year < campaign.initialYear || year > campaign.finalYear) throw new Error('Ano fora da campanha.');
                var mosaics = capabilities.filter(function(item) {
                    return item.satellite === 'sentinel' && Array.isArray(item.year) && item.year.indexOf(year) >= 0;
                }).map(function(item) {
                    return { name: item.name, years: item.year, periods: item.period, visparams: item.visparam };
                });
                return { point: point, map: { year: year }, period: params.period, tilesCapabilities: capabilities,
                    mosaics: mosaics, config: { initialYear: campaign.initialYear, finalYear: campaign.finalYear,
                        zoomLevel: campaign.zoomLevel || 13, sampleMarker: campaign.sampleMarker } };
            });
        }
    });
});
