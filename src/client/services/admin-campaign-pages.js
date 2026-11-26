'use strict';

Application.run(function(AdminPages, $http, sampleMarkerService) {
    function saved(response) {
        if (!response.data || !response.data.success) {
            throw new Error(response.data && response.data.error || 'Não foi possível salvar a campanha.');
        }
        return response.data;
    }

    function list() {
        return '/admin/campaigns';
    }

    function campaignState(scope) {
        return scope.campaign;
    }

    function fileState(file) {
        return file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null;
    }

    function directPending(scope) {
        return !!(scope.submitting || scope.isProcessing || scope.removalLoading || scope.applying ||
            scope.recovering || (scope.uploadProgress && scope.uploadProgress.isUploading));
    }

    AdminPages.register('campaign-create', {
        title: 'Criar campanha',
        editable: true,
        editState: campaignState,
        pending: directPending,
        templateUrl: 'views/campaign-form-modal.tpl.html',
        controller: 'CampaignFormModalController',
        parent: list,
        load: function() {
            return {
                isNew: true,
                campaign: {
                    landUse: [], initialYear: 1985, finalYear: 2024, numInspec: 3,
                    showTimeseries: true, autoLoadTimeseries: true, showPointInfo: true,
                    useDynamicMaps: false, imageType: 'landsat', zoomLevel: 13,
                    sampleMarker: sampleMarkerService.core.defaults()
                }
            };
        },
        save: function(campaign) {
            return $http.post('/api/campaigns', campaign).then(saved);
        }
    });

    function campaignUrl(params) {
        if (typeof params.campaignId !== 'string' || !params.campaignId.trim()) {
            throw new Error('Informe a campanha.');
        }
        return '/api/campaigns/' + encodeURIComponent(params.campaignId);
    }

    function loadCampaign(params) {
        return $http.get(campaignUrl(params)).then(function(response) {
            if (!response.data || response.data._id !== params.campaignId) {
                throw new Error('Campanha não encontrada.');
            }
            return { campaign: response.data, campaignId: params.campaignId };
        });
    }

    AdminPages.register('campaign-point-mutations', {
        title: 'Gerenciar pontos da campanha',
        templateUrl: 'views/campaign-point-mutations.tpl.html',
        controller: 'CampaignPointMutationsController',
        editable: true,
        editState: function(scope) {
            return scope.unsentChanges ? { input: scope.input, approval: scope.approval } : null;
        },
        pending: function(scope) { return !!scope.applying; },
        parent: function(params) { return '/admin/campaigns/manage/' + encodeURIComponent(params.campaignId); },
        load: function(params) {
            return loadCampaign(params).then(function(locals) {
                locals.mutationAction = params.action === 'delete' ? 'delete' : 'add';
                locals.pointId = locals.mutationAction === 'delete' && typeof params.pointId === 'string' ? params.pointId : '';
                return locals;
            });
        }
    });

    AdminPages.register('campaign-offline', {
        title: 'Cache offline da campanha',
        templateUrl: 'views/campaign-offline-page.tpl.html',
        controller: function($scope, campaign, campaignId) {
            $scope.campaign = campaign;
            $scope.campaignId = campaignId;
        },
        parent: list,
        load: loadCampaign
    });

    AdminPages.register('campaign-edit', {
        title: 'Editar campanha',
        editable: true,
        editState: campaignState,
        pending: directPending,
        templateUrl: 'views/campaign-form-modal.tpl.html',
        controller: 'CampaignFormModalController',
        parent: list,
        load: function(params) {
            return loadCampaign(params).then(function(locals) {
                locals.isNew = false;
                return locals;
            });
        },
        save: function(campaign, locals, params) {
            var payload = angular.copy(campaign);
            ['pointOperationId', 'pointImportLock', 'pointOperationRange', 'pointSequence'].forEach(function(key) {
                delete payload[key];
            });
            return $http.put(campaignUrl(params), payload).then(saved);
        }
    });

    [
        ['campaign-upload', 'Importar pontos', 'geojson-upload-modal', 'AdminGeoJSONUploadModalController'],
        ['campaign-import', 'Importar classificações', 'import-classifications-modal', 'ImportClassificationsModalController'],
        ['campaign-points', 'Pontos da campanha', 'campaign-points-modal', 'AdminCampaignPointsModalController'],
        ['campaign-excess', 'Inspeções excedentes', 'admin-excess-inspections-modal', 'AdminExcessInspectionsModalController'],
        ['campaign-zombies', 'Recuperação de pontos', 'admin-zombies-modal', 'AdminZombiesModalController']
    ].forEach(function(page) {
        AdminPages.register(page[0], {
            title: page[1], templateUrl: 'views/' + page[2] + '.tpl.html',
            controller: page[3], parent: list, load: loadCampaign,
            className: { 'campaign-points': 'points-modal-wide', 'campaign-excess': 'excess-modal', 'campaign-zombies': 'zombies-modal' }[page[0]],
            editable: page[0] === 'campaign-upload' || page[0] === 'campaign-import',
            pending: directPending,
            editState: function(scope) {
                if (page[0] === 'campaign-upload') {
                    return scope.uploadProgress && scope.uploadProgress.success ? null : fileState(scope.file);
                }
                if (page[0] === 'campaign-import') {
                    return scope.success
                        ? { mode: 'file', distance: 50, file: null }
                        : { mode: scope.importMode, distance: scope.maxDistance, file: fileState(scope.selectedFile) };
                }
                return null;
            }
        });
    });

    function loadPoint(params) {
        if (typeof params.pointId !== 'string' || !params.pointId.trim()) {
            throw new Error('Informe o ponto.');
        }
        return loadCampaign(params).then(function(locals) {
            // A listagem interpreta pointId como expressão regular; o acesso direto exige igualdade literal.
            var exactId = '^' + params.pointId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
            return $http.get(campaignUrl(params) + '/points', {
                params: { pointId: exactId, includeInspections: true, page: 1, limit: 1 }
            }).then(function(response) {
                var point = response.data && response.data.points && response.data.points[0];
                if (!point || point._id !== params.pointId || point.campaign !== params.campaignId) {
                    throw new Error('Ponto não encontrado nesta campanha.');
                }
                locals.point = point;
                locals.mode = 'admin';
                return locals;
            });
        });
    }

    [
        ['point-details', 'Detalhes do ponto', 'point-details-modal', 'PointDetailsModalController'],
        ['point-inspections', 'Inspeções do ponto', 'point-inspections-edit-modal', 'PointInspectionsEditModalController'],
        ['point-doubt', 'Dúvida do ponto', 'doubt-resolve-modal', 'AdminDoubtResolveModalController']
    ].forEach(function(page) {
        AdminPages.register(page[0], {
            title: page[1], templateUrl: 'views/' + page[2] + '.tpl.html',
            controller: page[3], load: loadPoint,
            className: page[0] === 'point-details' ? 'point-details-modal' : '',
            editable: page[0] === 'point-inspections' || page[0] === 'point-doubt',
            pending: directPending,
            editState: function(scope) {
                if (page[0] === 'point-inspections') {
                    return (scope.inspections || []).map(function(inspection) {
                        return { user: inspection.user, date: inspection.dateInput, time: inspection.time, form: inspection.form };
                    });
                }
                if (page[0] === 'point-doubt') return { comment: scope.newComment, transition: scope.transition };
                return null;
            },
            parent: function(params) {
                return '/admin/page/campaign-points?campaignId=' + encodeURIComponent(params.campaignId);
            }
        });
    });
});
