const fs = require('fs');
const path = require('path');
const async = require('async');
const exec = require('child_process').exec;

module.exports = function(app) {
    const config = app.config;
    const campaignCollection = app.repository.collections.campaign;
    const pointsCollection = app.repository.collections.points;
    
    // Try to load PropertyAnalyzer with error handling
    let PropertyAnalyzer;
    try {
        PropertyAnalyzer = require('./propertyAnalyzer')(app);
    } catch (error) {
        console.error('Failed to load PropertyAnalyzer module:', error);
        // Create a fallback PropertyAnalyzer
        PropertyAnalyzer = {
            analyzeProperties: async (pointsCollection, campaignId, numInspec) => {
                console.warn('PropertyAnalyzer not available, using fallback');
                return {
                    relevantProperties: [],
                    categoricalProperties: [],
                    numericProperties: [],
                    temporalProperties: [],
                    geographicProperties: [],
                    allProperties: []
                };
            }
        };
    }
    
    // Configuração do multer para upload (versão antiga 0.1.8)

    const CampaignCrud = {};

    // Autenticação de super-admin
    CampaignCrud.adminLogin = async (req, res) => {
        try {
            const { username, password } = req.body;
            
            if (!username || !password) {
                return res.status(400).json({ error: 'Username and password are required' });
            }
            
            // Verificar se o usuário existe na coleção users
            const usersCollection = app.repository.collections.users;
            const user = await usersCollection.findOne({ 
                username: username,
                role: 'super-admin'
            });
            
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            // Verificação simples de senha (em produção usar hash)
            if (user.password !== password) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            // Criar sessão separada para admin
            if (!req.session.admin) {
                req.session.admin = {};
            }
            req.session.admin.superAdmin = {
                id: user._id,
                username: user.username
            };
            
            res.json({ 
                success: true, 
                user: { 
                    id: user._id, 
                    username: user.username 
                } 
            });
        } catch (error) {
            console.error('Error in admin login:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    CampaignCrud.adminLogout = (req, res) => {
        if (req.session && req.session.admin) {
            delete req.session.admin;
        }
        // Garantir que a sessão seja salva sem destruir outras partes
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session after admin logout:', err);
            }
            res.json({ success: true });
        });
    };

    CampaignCrud.checkAdminAuth = (req, res) => {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            res.json({ 
                authenticated: true, 
                user: req.session.admin.superAdmin 
            });
        } else {
            res.json({ authenticated: false });
        }
    };

    // Listar todas as campanhas com paginação, filtros e ordenação
    CampaignCrud.list = async (req, res) => {
        try {
            // Parâmetros de paginação
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;
            
            // Construir filtros
            let query = {};
            
            // Filtro por ID da campanha
            if (req.query.campaignId && req.query.campaignId.trim()) {
                query._id = { $regex: req.query.campaignId.trim(), $options: 'i' };
            }
            
            // Filtros por anos
            if (req.query.initialYear) {
                query.initialYear = parseInt(req.query.initialYear);
            }
            if (req.query.finalYear) {
                query.finalYear = parseInt(req.query.finalYear);
            }
            
            // Filtro por número de inspeções
            if (req.query.numInspec) {
                query.numInspec = parseInt(req.query.numInspec);
            }
            
            // Filtro por tipo de imagem
            if (req.query.imageType) {
                query.imageType = req.query.imageType;
            }
            
            // Filtros por configurações booleanas
            if (req.query.showTimeseries !== undefined) {
                query.showTimeseries = req.query.showTimeseries === 'true';
            }
            if (req.query.showPointInfo !== undefined) {
                query.showPointInfo = req.query.showPointInfo === 'true';
            }
            if (req.query.useDynamicMaps !== undefined) {
                query.useDynamicMaps = req.query.useDynamicMaps === 'true';
            }
            
            // Definir ordenação
            let sortBy = { _id: -1 }; // Default: mais recente primeiro
            if (req.query.sortBy) {
                switch (req.query.sortBy) {
                    case 'campaignId':
                        sortBy = { _id: 1 };
                        break;
                    case 'initialYear':
                        sortBy = { initialYear: -1 };
                        break;
                    case 'finalYear':
                        sortBy = { finalYear: -1 };
                        break;
                    case 'totalPoints':
                        // Este será aplicado após calcular estatísticas
                        break;
                    case 'progress':
                        // Este será aplicado após calcular estatísticas
                        break;
                    default:
                        sortBy = { _id: -1 };
                }
            }
            
            // Campaign list query and sort logged for debugging
            
            // Contar total de campanhas com filtros
            const totalCampaigns = await campaignCollection.count(query);
            
            // Buscar campanhas com paginação e filtros
            let campaigns = await campaignCollection.find(query)
                .sort(sortBy)
                .skip(skip)
                .limit(limit)
                .toArray();
            
            // Buscar estatísticas de pontos em paralelo usando aggregation pipeline otimizado
            const campaignIds = campaigns.map(c => c._id);
            
            if (campaignIds.length > 0) {
                // Criar um mapa de numInspec para cada campanha
                const numInspecMap = {};
                campaigns.forEach(c => {
                    numInspecMap[c._id] = c.numInspec || 3;
                });
                
                // Pipeline otimizado para contar total e completos de uma vez
                const statsResult = await pointsCollection.aggregate([
                    { $match: { campaign: { $in: campaignIds } } },
                    { 
                        $project: {
                            campaign: 1,
                            userNameCount: { $size: { $ifNull: ["$userName", []] } }
                        }
                    },
                    { 
                        $group: {
                            _id: "$campaign",
                            totalPoints: { $sum: 1 },
                            userNameCounts: { $push: "$userNameCount" }
                        }
                    }
                ], { allowDiskUse: true }).toArray();
                
                // Processar resultados e calcular pontos completos
                const statsMap = {};
                statsResult.forEach(stat => {
                    const numInspec = numInspecMap[stat._id] || 3;
                    const completedPoints = stat.userNameCounts.filter(count => count >= numInspec).length;
                    statsMap[stat._id] = {
                        totalPoints: stat.totalPoints,
                        completedPoints: completedPoints
                    };
                });
                
                // Adicionar estatísticas às campanhas
                for (let campaign of campaigns) {
                    const stats = statsMap[campaign._id] || { totalPoints: 0, completedPoints: 0 };
                    campaign.totalPoints = stats.totalPoints;
                    campaign.completedPoints = stats.completedPoints;
                    campaign.progress = stats.totalPoints > 0 ? (stats.completedPoints / stats.totalPoints * 100).toFixed(2) : 0;
                }
                
                // Aplicar filtros pós-processamento (que dependem de estatísticas calculadas)
                let filteredCampaigns = campaigns;
                
                // Filtro por status de progresso
                if (req.query.progressStatus) {
                    filteredCampaigns = campaigns.filter(campaign => {
                        const progress = parseFloat(campaign.progress);
                        switch (req.query.progressStatus) {
                            case 'empty':
                                return progress === 0;
                            case 'started':
                                return progress > 0 && progress < 100;
                            case 'completed':
                                return progress === 100;
                            default:
                                return true;
                        }
                    });
                }
                
                // Aplicar ordenação pós-processamento se necessário
                if (req.query.sortBy === 'totalPoints') {
                    filteredCampaigns.sort((a, b) => b.totalPoints - a.totalPoints);
                } else if (req.query.sortBy === 'progress') {
                    filteredCampaigns.sort((a, b) => parseFloat(b.progress) - parseFloat(a.progress));
                }
                
                // Se aplicamos filtros pós-processamento, precisamos recalcular paginação
                if (req.query.progressStatus || req.query.sortBy === 'totalPoints' || req.query.sortBy === 'progress') {
                    const totalFiltered = filteredCampaigns.length;
                    const startIndex = skip;
                    const endIndex = startIndex + limit;
                    filteredCampaigns = filteredCampaigns.slice(startIndex, endIndex);
                    
                    // Atualizar estatísticas de paginação
                    const totalPages = Math.ceil(totalFiltered / limit);
                    
                    // Resposta paginada com filtros pós-processamento
                    return res.json({
                        campaigns: filteredCampaigns,
                        pagination: {
                            currentPage: page,
                            totalPages: totalPages,
                            totalCampaigns: totalFiltered,
                            limit,
                            hasNext: page < totalPages,
                            hasPrev: page > 1
                        }
                    });
                }
                
                campaigns = filteredCampaigns;
            } else {
                // Se não há campanhas, definir valores padrão
                for (let campaign of campaigns) {
                    campaign.totalPoints = 0;
                    campaign.completedPoints = 0;
                    campaign.progress = 0;
                }
            }
            
            // Resposta paginada
            res.json({
                campaigns,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalCampaigns / limit),
                    totalCampaigns,
                    limit,
                    hasNext: page < Math.ceil(totalCampaigns / limit),
                    hasPrev: page > 1
                }
            });
        } catch (error) {
            console.error('Error listing campaigns:', error);
            res.status(500).json({ error: 'Failed to list campaigns' });
        }
    };

    // Obter uma campanha específica
    CampaignCrud.get = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Contar pontos
            const totalPoints = await pointsCollection.count({ campaign: campaign._id });
            
            // Contar pontos completos usando aggregation
            const completedResult = await pointsCollection.aggregate([
                { $match: { campaign: campaign._id } },
                { $project: { 
                    isCompleted: { $gte: [{ $size: "$userName" }, campaign.numInspec] }
                }},
                { $match: { isCompleted: true } },
                { $count: "total" }
            ]).toArray();
            
            const completedPoints = completedResult.length > 0 ? completedResult[0].total : 0;
            
            campaign.totalPoints = totalPoints;
            campaign.completedPoints = completedPoints;
            campaign.progress = totalPoints > 0 ? (completedPoints / totalPoints * 100).toFixed(2) : 0;
            
            res.json(campaign);
        } catch (error) {
            console.error('Error getting campaign:', error);
            res.status(500).json({ error: 'Failed to get campaign' });
        }
    };

    // Função auxiliar para descobrir qual campo usar para classificação
    CampaignCrud.inferClassificationField = async (campaignId) => {
        try {
            // Buscar uma amostra de pontos
            const samplePoints = await pointsCollection
                .find({ campaign: campaignId })
                .limit(50)
                .toArray();
            
            if (samplePoints.length === 0) return null;
            
            // Verificar primeiro o campo classConsolidated (campo padrão do sistema)
            const hasClassConsolidated = samplePoints.some(point => 
                point.classConsolidated !== undefined && 
                point.classConsolidated !== null &&
                Array.isArray(point.classConsolidated) &&
                point.classConsolidated.length > 0
            );
            if (hasClassConsolidated) return 'classConsolidated';
            
            // Lista de possíveis campos de classificação
            const possibleFields = ['mode', 'classe', 'class', 'landuse', 'land_use', 'uso_solo', 'categoria', 'tipo'];
            
            // Verificar campos no nível raiz
            for (const field of possibleFields) {
                const hasField = samplePoints.some(point => point[field] !== undefined && point[field] !== null);
                if (hasField) return field;
            }
            
            // Verificar campos dentro de properties
            for (const field of possibleFields) {
                const hasField = samplePoints.some(point => 
                    point.properties && 
                    point.properties[field] !== undefined && 
                    point.properties[field] !== null
                );
                if (hasField) return `properties.${field}`;
            }
            
            // Se não encontrou nenhum campo conhecido, verificar qualquer string em properties
            const firstPointWithProperties = samplePoints.find(p => p.properties && Object.keys(p.properties).length > 0);
            if (firstPointWithProperties && firstPointWithProperties.properties) {
                const stringField = Object.keys(firstPointWithProperties.properties).find(key => 
                    typeof firstPointWithProperties.properties[key] === 'string'
                );
                if (stringField) return `properties.${stringField}`;
            }
            
            return null;
        } catch (error) {
            console.error('Error inferring classification field:', error);
            return null;
        }
    };

    // Obter dados detalhados e estatísticas de uma campanha
    CampaignCrud.getDetails = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Descobrir qual campo usar para classificação
            const classificationField = await CampaignCrud.inferClassificationField(campaignId);
            
            // Analisar propriedades disponíveis
            const propertyAnalysis = await PropertyAnalyzer.analyzeProperties(
                pointsCollection, 
                campaignId, 
                campaign.numInspec
            );
            
            // Executar todas as queries em paralelo para melhor performance
            const [totalPoints, completedResult, userStats, classStats, stateStats, biomeStats, progressTimeline, pendingByMunicipality, meanTimeStats] = await Promise.all([
                // Total de pontos
                pointsCollection.count({ campaign: campaign._id }),
                
                // Pontos completos - otimizado
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $match: { userNameCount: { $gte: campaign.numInspec } } },
                    { $count: "total" }
                ], { allowDiskUse: true }).toArray(),
                
                // Estatísticas por usuário - limitado ao top 50
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: { userName: 1 } },
                    { $unwind: "$userName" },
                    { $group: {
                        _id: "$userName",
                        inspections: { $sum: 1 }
                    }},
                    { $sort: { inspections: -1 } },
                    { $limit: 50 }
                ], { allowDiskUse: true }).toArray(),
                
                // Estatísticas por classe de uso - usando campo dinâmico
                classificationField ? (async () => {
                    let pipeline = [
                        { $match: { campaign: campaign._id } },
                        { $project: {
                            classificationField: classificationField.includes('.') 
                                ? `$${classificationField.replace('.', '.')}`
                                : `$${classificationField}`,
                            userNameCount: { $size: { $ifNull: ["$userName", []] } }
                        }},
                        { $match: { 
                            userNameCount: { $gte: campaign.numInspec },
                            classificationField: { $exists: true, $ne: null }
                        }}
                    ];
                    
                    // Special handling for classConsolidated array field
                    if (classificationField === 'classConsolidated') {
                        pipeline.push(
                            { $unwind: "$classificationField" },
                            { $group: {
                                _id: "$classificationField",
                                count: { $sum: 1 }
                            }}
                        );
                    } else {
                        pipeline.push(
                            { $group: {
                                _id: "$classificationField",
                                count: { $sum: 1 }
                            }}
                        );
                    }
                    
                    pipeline.push({ $sort: { count: -1 } });
                    
                    return pointsCollection.aggregate(pipeline, { allowDiskUse: true }).toArray();
                })() : Promise.resolve([]),
                
                // Estatísticas por estado - otimizado
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        uf: {
                            $cond: {
                                if: { $or: [
                                    { $eq: ["$uf", null] },
                                    { $eq: ["$uf", ""] },
                                    { $not: ["$uf"] }
                                ]},
                                then: "Não informado",
                                else: "$uf"
                            }
                        },
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $group: {
                        _id: "$uf",
                        total: { $sum: 1 },
                        completed: { 
                            $sum: { 
                                $cond: [{ $gte: ["$userNameCount", campaign.numInspec] }, 1, 0]
                            }
                        }
                    }},
                    { $sort: { total: -1 } }
                ], { allowDiskUse: true }).toArray(),
                
                // Estatísticas por bioma - otimizado
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        biome: {
                            $cond: {
                                if: { $or: [
                                    { $eq: ["$biome", null] },
                                    { $eq: ["$biome", ""] },
                                    { $not: ["$biome"] }
                                ]},
                                then: "Não informado",
                                else: "$biome"
                            }
                        },
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $group: {
                        _id: "$biome",
                        total: { $sum: 1 },
                        completed: { 
                            $sum: { 
                                $cond: [{ $gte: ["$userNameCount", campaign.numInspec] }, 1, 0]
                            }
                        }
                    }},
                    { $sort: { total: -1 } }
                ], { allowDiskUse: true }).toArray(),
                
                // Progresso ao longo do tempo (últimos 30 dias) - simplificado
                (async () => {
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    
                    return pointsCollection.aggregate([
                        { $match: { 
                            campaign: campaign._id,
                            "inspection.fillDate": { $gte: thirtyDaysAgo }
                        }},
                        { $unwind: "$inspection" },
                        { $match: {
                            "inspection.counter": { $gte: campaign.numInspec },
                            "inspection.fillDate": { $gte: thirtyDaysAgo }
                        }},
                        { $group: {
                            _id: {
                                $dateToString: { format: "%Y-%m-%d", date: "$inspection.fillDate" }
                            },
                            count: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ], { allowDiskUse: true }).toArray();
                })(),
                
                // Pontos pendentes por município - otimizado
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        county: 1,
                        uf: 1,
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $match: { userNameCount: { $lt: campaign.numInspec } } },
                    { $group: {
                        _id: {
                            municipality: "$county",
                            state: "$uf"
                        },
                        count: { $sum: 1 }
                    }},
                    { $sort: { count: -1 } },
                    { $limit: 20 }
                ], { allowDiskUse: true }).toArray(),
                
                // Média de tempo por inspeção - adaptado do dashboard
                (async () => {
                    const points = await pointsCollection.find({ campaign: campaign._id }).toArray();
                    const listInsp = {};
                    
                    points.forEach(point => {
                        if (point.userName && point.inspection) {
                            for (let i = 0; i < point.userName.length; i++) {
                                const userName = point.userName[i];
                                const inspection = point.inspection[i];
                                
                                if (!listInsp[userName]) {
                                    listInsp[userName] = { sum: 0, count: 0 };
                                }
                                
                                if (inspection && inspection.counter) {
                                    listInsp[userName].sum += inspection.counter;
                                    listInsp[userName].count += 1;
                                }
                            }
                        }
                    });
                    
                    // Calcular média para cada usuário
                    for (const key in listInsp) {
                        listInsp[key].avg = listInsp[key].count > 0 ? 
                            (listInsp[key].sum / listInsp[key].count).toFixed(0) : 0;
                    }
                    
                    return listInsp;
                })()
            ]);
            
            const completedPoints = completedResult.length > 0 ? completedResult[0].total : 0;
            
            // Montar resposta detalhada
            const details = {
                campaign: {
                    ...campaign,
                    totalPoints,
                    completedPoints,
                    pendingPoints: totalPoints - completedPoints,
                    progress: totalPoints > 0 ? (completedPoints / totalPoints * 100).toFixed(2) : 0
                },
                statistics: {
                    users: {
                        total: userStats.length,
                        topInspectors: userStats.slice(0, 10),
                        data: userStats
                    },
                    classes: {
                        total: classStats.length,
                        distribution: classStats,
                        fieldUsed: classificationField,
                        noDataMessage: !classificationField ? 'Nenhum campo de classificação encontrado' : null
                    },
                    states: {
                        total: stateStats.length,
                        data: stateStats
                    },
                    biomes: {
                        total: biomeStats.length,
                        data: biomeStats
                    },
                    timeline: progressTimeline,
                    pendingByMunicipality,
                    meanTime: meanTimeStats
                },
                propertyAnalysis: propertyAnalysis,
                visualizationRecommendations: propertyAnalysis.visualizationRecommendations || []
            };
            
            res.json(details);
        } catch (error) {
            console.error('Error getting campaign details:', error);
            res.status(500).json({ error: 'Failed to get campaign details' });
        }
    };

    // Criar nova campanha
    CampaignCrud.create = async (req, res) => {
        try {
            const campaignData = req.body;
            
            // Verificar se a campanha já existe
            const existing = await campaignCollection.findOne({ _id: campaignData._id });
            if (existing) {
                return res.status(400).json({ error: 'Campaign ID already exists' });
            }
            
            // Adicionar configurações padrão se não fornecidas
            const campaign = {
                _id: campaignData._id,
                initialYear: parseInt(campaignData.initialYear) || 1985,
                finalYear: parseInt(campaignData.finalYear) || 2024,
                password: campaignData.password || null,
                landUse: campaignData.landUse || [],
                numInspec: parseInt(campaignData.numInspec) || 3,
                // Novas propriedades
                showTimeseries: campaignData.showTimeseries !== false,
                showPointInfo: campaignData.showPointInfo !== false,
                visParam: campaignData.visParam || null,
                useDynamicMaps: campaignData.useDynamicMaps || false,
                imageType: campaignData.imageType || 'landsat',
                geojsonFile: campaignData.geojsonFile || null,
                properties: campaignData.properties || [],
                createdAt: new Date()
            };
            
            await campaignCollection.insertOne(campaign);
            res.json({ success: true, campaign: campaign });
        } catch (error) {
            console.error('Error creating campaign:', error);
            res.status(500).json({ error: 'Failed to create campaign' });
        }
    };

    // Atualizar campanha
    CampaignCrud.update = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const updateData = req.body;
            
            // Remover _id do objeto de atualização
            delete updateData._id;
            
            // Converter tipos numéricos
            if (updateData.initialYear) updateData.initialYear = parseInt(updateData.initialYear);
            if (updateData.finalYear) updateData.finalYear = parseInt(updateData.finalYear);
            if (updateData.numInspec) updateData.numInspec = parseInt(updateData.numInspec);
            
            // Atualizar configurações booleanas
            if (updateData.hasOwnProperty('showTimeseries')) {
                updateData.showTimeseries = updateData.showTimeseries === true;
            }
            if (updateData.hasOwnProperty('showPointInfo')) {
                updateData.showPointInfo = updateData.showPointInfo === true;
            }
            
            updateData.updatedAt = new Date();
            
            const result = await campaignCollection.updateOne(
                { _id: campaignId },
                { $set: updateData }
            );
            
            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            res.json({ success: true, message: 'Campaign updated successfully' });
        } catch (error) {
            console.error('Error updating campaign:', error);
            res.status(500).json({ error: 'Failed to update campaign' });
        }
    };

    // Deletar campanha
    CampaignCrud.delete = async (req, res) => {
        try {
            const campaignId = req.params.id;
            
            // Verificar se existem pontos associados
            const pointsCount = await pointsCollection.count({ campaign: campaignId });
            if (pointsCount > 0) {
                return res.status(400).json({ 
                    error: 'Cannot delete campaign with associated points',
                    pointsCount: pointsCount 
                });
            }
            
            const result = await campaignCollection.deleteOne({ _id: campaignId });
            
            if (result.deletedCount === 0) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            res.json({ success: true, message: 'Campaign deleted successfully' });
        } catch (error) {
            console.error('Error deleting campaign:', error);
            res.status(500).json({ error: 'Failed to delete campaign' });
        }
    };

    // Upload de GeoJSON com processamento direto (sem salvar arquivo)
    CampaignCrud.uploadGeoJSON = async (req, res) => {
        const startTime = new Date();
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Enhanced logging function
        const logError = (level, message, error = null, context = {}) => {
            const logData = {
                timestamp: new Date().toISOString(),
                requestId: requestId,
                level: level,
                message: message,
                context: context,
                sessionId: req.sessionID,
                ip: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                error: error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                    code: error.code
                } : null
            };
            
            console.error(`[${level}] GeoJSON Upload:`, JSON.stringify(logData, null, 2));
        };
        
        try {
            logError('INFO', 'GeoJSON upload request started', null, {
                hasBody: !!req.body,
                bodyKeys: req.body ? Object.keys(req.body) : [],
                contentLength: req.get('Content-Length'),
                contentType: req.get('Content-Type')
            });
            
            // Enhanced validation with detailed error reporting
            const campaignId = req.body && req.body.campaignId;
            const geojsonContent = req.body && req.body.geojsonContent;
            const filename = (req.body && req.body.filename) || 'campaign-upload.geojson';
            
            // Validate request structure
            if (!req.body) {
                logError('ERROR', 'Request body is missing or empty', null, {
                    headers: req.headers,
                    method: req.method,
                    url: req.url
                });
                return res.status(400).json({ 
                    error: 'Dados inválidos na requisição',
                    details: 'Request body is missing or empty',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (!campaignId || typeof campaignId !== 'string') {
                logError('ERROR', 'Campaign ID validation failed', null, {
                    campaignId: campaignId,
                    campaignIdType: typeof campaignId,
                    bodyKeys: Object.keys(req.body)
                });
                return res.status(400).json({ 
                    error: 'Dados inválidos na requisição',
                    details: 'Campaign ID is required and must be a string',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (!geojsonContent || typeof geojsonContent !== 'string') {
                logError('ERROR', 'GeoJSON content validation failed', null, {
                    hasContent: !!geojsonContent,
                    contentType: typeof geojsonContent,
                    contentLength: geojsonContent ? geojsonContent.length : 0
                });
                return res.status(400).json({ 
                    error: 'Dados inválidos na requisição',
                    details: 'GeoJSON content is required and must be a string',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Verify campaign exists with detailed error handling
            let campaign;
            try {
                campaign = await campaignCollection.findOne({ _id: campaignId });
            } catch (dbError) {
                logError('ERROR', 'Database error while fetching campaign', dbError, {
                    campaignId: campaignId,
                    collection: 'campaigns'
                });
                return res.status(500).json({ 
                    error: 'Erro interno do servidor',
                    details: 'Database error while fetching campaign',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (!campaign) {
                logError('ERROR', 'Campaign not found', null, {
                    campaignId: campaignId,
                    searchAttempted: true
                });
                return res.status(404).json({ 
                    error: 'Campanha não encontrada',
                    details: `Campaign with ID '${campaignId}' was not found`,
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Enhanced GeoJSON parsing with detailed error context
            let geojsonData;
            try {
                geojsonData = JSON.parse(geojsonContent);
            } catch (parseError) {
                logError('ERROR', 'GeoJSON parsing failed', parseError, {
                    contentLength: geojsonContent.length,
                    contentPreview: geojsonContent.substring(0, 200),
                    filename: filename
                });
                return res.status(400).json({ 
                    error: 'Formato GeoJSON inválido',
                    details: `JSON parsing failed: ${parseError.message}`,
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Validate GeoJSON structure
            if (!geojsonData || typeof geojsonData !== 'object') {
                logError('ERROR', 'Invalid GeoJSON structure - not an object', null, {
                    dataType: typeof geojsonData,
                    isNull: geojsonData === null,
                    filename: filename
                });
                return res.status(400).json({ 
                    error: 'Estrutura GeoJSON inválida',
                    details: 'GeoJSON must be a valid object',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (!geojsonData.features || !Array.isArray(geojsonData.features)) {
                logError('ERROR', 'Invalid GeoJSON structure - missing features array', null, {
                    hasFeatures: !!geojsonData.features,
                    featuresType: typeof geojsonData.features,
                    isArray: Array.isArray(geojsonData.features),
                    geojsonKeys: Object.keys(geojsonData),
                    filename: filename
                });
                return res.status(400).json({ 
                    error: 'Estrutura GeoJSON inválida',
                    details: 'GeoJSON must contain a features array',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (geojsonData.features.length === 0) {
                logError('ERROR', 'Empty GeoJSON features array', null, {
                    featuresLength: geojsonData.features.length,
                    filename: filename
                });
                return res.status(400).json({ 
                    error: 'Nenhuma feature encontrada',
                    details: 'GeoJSON features array is empty',
                    requestId: requestId,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Get session information
            const sessionId = req.sessionID;
            const userId = (req.session && req.session.admin && req.session.admin.superAdmin && req.session.admin.superAdmin.id) || 'anonymous';
            
            logError('INFO', 'Starting GeoJSON processing', null, {
                campaignId: campaignId,
                filename: filename,
                featuresCount: geojsonData.features.length,
                userId: userId,
                processingMethod: 'direct'
            });
            
            // Process GeoJSON with enhanced error handling
            const result = await CampaignCrud.processGeoJSONDirect(campaignId, geojsonData, filename, app.io, sessionId, userId, requestId);
            
            const processingTime = new Date() - startTime;
            logError('INFO', 'GeoJSON processing completed successfully', null, {
                processingTimeMs: processingTime,
                result: result,
                featuresProcessed: result.processedCount,
                featuresInserted: result.insertedCount,
                errors: result.errorCount
            });
            
            // Add request tracking to response
            res.json({
                ...result,
                requestId: requestId,
                processingTime: processingTime,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            const processingTime = new Date() - startTime;
            logError('ERROR', 'Unexpected error during GeoJSON upload', error, {
                processingTimeMs: processingTime,
                requestBody: req.body ? {
                    hasCampaignId: !!req.body.campaignId,
                    hasGeojsonContent: !!req.body.geojsonContent,
                    hasFilename: !!req.body.filename,
                    contentLength: req.body.geojsonContent ? req.body.geojsonContent.length : 0
                } : null
            });
            
            res.status(500).json({ 
                error: 'Erro interno do servidor',
                details: `Unexpected error: ${error.message}`,
                requestId: requestId,
                timestamp: new Date().toISOString(),
                processingTime: processingTime
            });
        }
    };
    
    // Processamento direto do GeoJSON sem salvar arquivo
    CampaignCrud.processGeoJSONDirect = async (campaignId, geojsonData, filename, io, sessionId, userId, requestId = null) => {
        const totalFeatures = geojsonData.features.length;
        let processedCount = 0;
        let insertedCount = 0;
        let errorCount = 0;
        const startTime = new Date();
        
        // Processamento direto iniciado
        
        // Função para emitir eventos para o socket correto
        const emitToUser = (event, data) => {
            if (io) {
                // Emitir para todos os sockets da sala geojson-upload
                io.to('geojson-upload').emit(event, {
                    ...data,
                    sessionId: sessionId,
                    userId: userId
                });
                
                // Evento emitido
            }
        };
        
        // Emitir evento de início
        emitToUser('upload-started', {
            campaignId: campaignId,
            totalFeatures: totalFeatures,
            filename: filename,
            timestamp: startTime.toISOString()
        });
        
        try {
            // Extrair propriedades únicas de todas as features
            const allProperties = new Set();
            geojsonData.features.forEach(feature => {
                Object.keys(feature.properties || {}).forEach(key => {
                    allProperties.add(key);
                });
            });
            
            // Atualizar a campanha apenas com as propriedades (sem o arquivo)
            await campaignCollection.updateOne(
                { _id: campaignId },
                { 
                    $set: { 
                        properties: Array.from(allProperties)
                    } 
                }
            );
            
            // Buscar o último índice inserido para esta campanha
            let lastPoint = await pointsCollection.findOne(
                { campaign: campaignId },
                { sort: { index: -1 }, projection: { index: 1 } }
            );
            
            let counter = lastPoint ? lastPoint.index + 1 : 1;
            // Iniciando contador de pontos
            
            // Processar os pontos em lotes menores para melhor responsividade
            const batchSize = 50; // Reduzir tamanho do lote para foreground
            
            for (let i = 0; i < geojsonData.features.length; i += batchSize) {
                const batch = geojsonData.features.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(geojsonData.features.length / batchSize);
                
                // Processando lote
                
                // Emitir progresso do batch
                emitToUser('batch-processing', {
                    campaignId: campaignId,
                    batchNumber: batchNumber,
                    totalBatches: totalBatches,
                    batchSize: batch.length,
                    processedCount: processedCount,
                    insertedCount: insertedCount,
                    progress: Math.round((processedCount / totalFeatures) * 100)
                });
                
                const batchPoints = [];
                
                for (const feature of batch) {
                    try {
                        processedCount++;
                        
                        if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length < 2) {
                            errorCount++;
                            emitToUser('feature-error', {
                                campaignId: campaignId,
                                featureIndex: processedCount - 1,
                                error: 'Invalid geometry coordinates'
                            });
                            continue;
                        }
                        
                        const coordinate = {
                            X: feature.geometry.coordinates[0],
                            Y: feature.geometry.coordinates[1]
                        };
                        
                        // Validar coordenadas
                        if (isNaN(coordinate.X) || isNaN(coordinate.Y)) {
                            errorCount++;
                            emitToUser('feature-error', {
                                campaignId: campaignId,
                                featureIndex: processedCount - 1,
                                error: 'Invalid coordinate values'
                            });
                            continue;
                        }
                        
                        const point = {
                            _id: counter + '_' + campaignId,
                            campaign: campaignId,
                            lon: coordinate.X,
                            lat: coordinate.Y,
                            dateImport: new Date(),
                            biome: (feature.properties && feature.properties.biome) || null,
                            uf: (feature.properties && feature.properties.uf) || null,
                            county: (feature.properties && feature.properties.county) || null,
                            countyCode: (feature.properties && feature.properties.countyCode) || null,
                            path: (feature.properties && feature.properties.path) || null,
                            row: (feature.properties && feature.properties.row) || null,
                            userName: [],
                            inspection: [],
                            underInspection: 0,
                            index: counter++,
                            cached: false,
                            enhance_in_cache: 1,
                            // Armazenar todas as propriedades do GeoJSON
                            properties: feature.properties || {}
                        };
                        
                        batchPoints.push(point);
                        
                        // Emitir progresso de feature individual mais frequentemente
                        if (processedCount % 25 === 0) {
                            emitToUser('features-processed', {
                                campaignId: campaignId,
                                processedCount: processedCount,
                                insertedCount: insertedCount,
                                totalFeatures: totalFeatures,
                                progress: Math.round((processedCount / totalFeatures) * 100)
                            });
                        }
                        
                    } catch (featureError) {
                        errorCount++;
                        console.error('Error processing feature:', featureError);
                        emitToUser('feature-error', {
                            campaignId: campaignId,
                            featureIndex: processedCount - 1,
                            error: featureError.message
                        });
                    }
                }
                
                // Inserir batch no banco
                if (batchPoints.length > 0) {
                    try {
                        const insertResult = await pointsCollection.insertMany(batchPoints, { ordered: false });
                        const insertedInBatch = insertResult.insertedCount || batchPoints.length;
                        insertedCount += insertedInBatch;
                        
                        // Lote inserido
                        
                        emitToUser('batch-completed', {
                            campaignId: campaignId,
                            batchNumber: batchNumber,
                            totalBatches: totalBatches,
                            batchPointsInserted: insertedInBatch,
                            processedCount: processedCount,
                            insertedCount: insertedCount,
                            errorCount: errorCount,
                            progress: Math.round((processedCount / totalFeatures) * 100)
                        });
                        
                    } catch (insertError) {
                        console.error('Error inserting batch:', insertError);
                        
                        // Verificar se é erro de chave duplicada
                        if (insertError.code === 11000) {
                            // Erro de chave duplicada detectado
                            
                            // Tentar inserir pontos individualmente, pulando duplicados
                            let individualErrors = 0;
                            let individualSuccess = 0;
                            
                            for (const point of batchPoints) {
                                try {
                                    await pointsCollection.insertOne(point);
                                    individualSuccess++;
                                } catch (individualError) {
                                    if (individualError.code === 11000) {
                                        // Ponto duplicado pulado
                                        individualErrors++;
                                    } else {
                                        throw individualError;
                                    }
                                }
                            }
                            
                            insertedCount += individualSuccess;
                            errorCount += individualErrors;
                            
                            emitToUser('batch-warning', {
                                campaignId: campaignId,
                                batchNumber: batchNumber,
                                warning: `Lote ${batchNumber} parcialmente inserido: ${individualSuccess} pontos inseridos, ${individualErrors} pontos duplicados pulados`,
                                duplicatesSkipped: individualErrors,
                                pointsInserted: individualSuccess,
                                insertedCount: insertedCount,
                                errorCount: errorCount
                            });
                        } else {
                            // Outro tipo de erro
                            errorCount += batchPoints.length;
                            
                            emitToUser('batch-error', {
                                campaignId: campaignId,
                                batchNumber: batchNumber,
                                error: insertError.message,
                                errorCode: insertError.code,
                                pointsAffected: batchPoints.length,
                                errorCount: errorCount
                            });
                        }
                    }
                }
                
                // Emitir progresso final do lote
                emitToUser('features-processed', {
                    campaignId: campaignId,
                    processedCount: processedCount,
                    insertedCount: insertedCount,
                    totalFeatures: totalFeatures,
                    progress: Math.round((processedCount / totalFeatures) * 100)
                });
                
                // Pequena pausa entre batches para não bloquear o event loop
                await new Promise(resolve => setImmediate(resolve));
            }
            
            const endTime = new Date();
            const duration = endTime - startTime;
            
            const result = {
                success: true,
                message: 'Upload processado com sucesso',
                campaignId: campaignId,
                totalFeatures: totalFeatures,
                processedCount: processedCount,
                insertedCount: insertedCount,
                errorCount: errorCount,
                filename: filename,
                properties: Array.from(allProperties),
                duration: duration,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString()
            };
            
            // Emitir evento de conclusão
            emitToUser('upload-completed', result);
            
            // GeoJSON processamento direto concluído
            
            return result;
            
        } catch (error) {
            console.error('Error in direct GeoJSON processing:', error);
            
            const errorResult = {
                success: false,
                error: error.message,
                campaignId: campaignId,
                processedCount: processedCount,
                insertedCount: insertedCount,
                errorCount: errorCount
            };
            
            emitToUser('upload-failed', errorResult);
            
            throw error;
        }
    };
    
    // Processamento em foreground do GeoJSON com progresso em tempo real
    CampaignCrud.processGeoJSONForeground = async (campaignId, geojsonData, filename, io, sessionId, userId) => {
        const totalFeatures = geojsonData.features.length;
        let processedCount = 0;
        let insertedCount = 0;
        let errorCount = 0;
        const startTime = new Date();
        
        // Processamento foreground iniciado
        
        // Função para emitir eventos para o socket correto
        const emitToUser = (event, data) => {
            if (io) {
                // Emitir para todos os sockets da sala geojson-upload
                io.to('geojson-upload').emit(event, {
                    ...data,
                    sessionId: sessionId,
                    userId: userId
                });
                
                // Evento emitido
            }
        };
        
        // Emitir evento de início
        emitToUser('upload-started', {
            campaignId: campaignId,
            totalFeatures: totalFeatures,
            filename: filename,
            timestamp: startTime.toISOString()
        });
        
        try {
            // Salvar arquivo
            const uploadsDir = path.join(__dirname, '../../uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const savedFilename = 'campaign-' + uniqueSuffix + '.geojson';
            const filePath = path.join(uploadsDir, savedFilename);
            
            fs.writeFileSync(filePath, JSON.stringify(geojsonData, null, 2));
            
            // Extrair propriedades únicas de todas as features
            const allProperties = new Set();
            geojsonData.features.forEach(feature => {
                Object.keys(feature.properties || {}).forEach(key => {
                    allProperties.add(key);
                });
            });
            
            // Atualizar a campanha com as propriedades e arquivo
            await campaignCollection.updateOne(
                { _id: campaignId },
                { 
                    $set: { 
                        geojsonFile: savedFilename,
                        properties: Array.from(allProperties)
                    } 
                }
            );
            
            // Buscar o último índice inserido para esta campanha
            let lastPoint = await pointsCollection.findOne(
                { campaign: campaignId },
                { sort: { index: -1 }, projection: { index: 1 } }
            );
            
            let counter = lastPoint ? lastPoint.index + 1 : 1;
            // Iniciando contador de pontos
            
            // Processar os pontos em lotes menores para melhor responsividade
            const batchSize = 50; // Reduzir tamanho do lote para foreground
            
            for (let i = 0; i < geojsonData.features.length; i += batchSize) {
                const batch = geojsonData.features.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(geojsonData.features.length / batchSize);
                
                // Processando lote
                
                // Emitir progresso do batch
                emitToUser('batch-processing', {
                    campaignId: campaignId,
                    batchNumber: batchNumber,
                    totalBatches: totalBatches,
                    batchSize: batch.length,
                    processedCount: processedCount,
                    insertedCount: insertedCount,
                    progress: Math.round((processedCount / totalFeatures) * 100)
                });
                
                const batchPoints = [];
                
                for (const feature of batch) {
                    try {
                        processedCount++;
                        
                        if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length < 2) {
                            errorCount++;
                            emitToUser('feature-error', {
                                campaignId: campaignId,
                                featureIndex: processedCount - 1,
                                error: 'Invalid geometry coordinates'
                            });
                            continue;
                        }
                        
                        const coordinate = {
                            X: feature.geometry.coordinates[0],
                            Y: feature.geometry.coordinates[1]
                        };
                        
                        // Validar coordenadas
                        if (isNaN(coordinate.X) || isNaN(coordinate.Y)) {
                            errorCount++;
                            emitToUser('feature-error', {
                                campaignId: campaignId,
                                featureIndex: processedCount - 1,
                                error: 'Invalid coordinate values'
                            });
                            continue;
                        }
                        
                        const point = {
                            _id: counter + '_' + campaignId,
                            campaign: campaignId,
                            lon: coordinate.X,
                            lat: coordinate.Y,
                            dateImport: new Date(),
                            biome: (feature.properties && feature.properties.biome) || null,
                            uf: (feature.properties && feature.properties.uf) || null,
                            county: (feature.properties && feature.properties.county) || null,
                            countyCode: (feature.properties && feature.properties.countyCode) || null,
                            path: (feature.properties && feature.properties.path) || null,
                            row: (feature.properties && feature.properties.row) || null,
                            userName: [],
                            inspection: [],
                            underInspection: 0,
                            index: counter++,
                            cached: false,
                            enhance_in_cache: 1,
                            // Armazenar todas as propriedades do GeoJSON
                            properties: feature.properties || {}
                        };
                        
                        batchPoints.push(point);
                        
                        // Emitir progresso de feature individual mais frequentemente
                        if (processedCount % 25 === 0) {
                            emitToUser('features-processed', {
                                campaignId: campaignId,
                                processedCount: processedCount,
                                insertedCount: insertedCount,
                                totalFeatures: totalFeatures,
                                progress: Math.round((processedCount / totalFeatures) * 100)
                            });
                        }
                        
                    } catch (featureError) {
                        errorCount++;
                        console.error('Error processing feature:', featureError);
                        emitToUser('feature-error', {
                            campaignId: campaignId,
                            featureIndex: processedCount - 1,
                            error: featureError.message
                        });
                    }
                }
                
                // Inserir batch no banco
                if (batchPoints.length > 0) {
                    try {
                        const insertResult = await pointsCollection.insertMany(batchPoints, { ordered: false });
                        const insertedInBatch = insertResult.insertedCount || batchPoints.length;
                        insertedCount += insertedInBatch;
                        
                        // Lote inserido
                        
                        emitToUser('batch-completed', {
                            campaignId: campaignId,
                            batchNumber: batchNumber,
                            totalBatches: totalBatches,
                            batchPointsInserted: insertedInBatch,
                            processedCount: processedCount,
                            insertedCount: insertedCount,
                            errorCount: errorCount,
                            progress: Math.round((processedCount / totalFeatures) * 100)
                        });
                        
                    } catch (insertError) {
                        console.error('Error inserting batch:', insertError);
                        
                        // Verificar se é erro de chave duplicada
                        if (insertError.code === 11000) {
                            // Erro de chave duplicada detectado
                            
                            // Tentar inserir pontos individualmente, pulando duplicados
                            let individualErrors = 0;
                            let individualSuccess = 0;
                            
                            for (const point of batchPoints) {
                                try {
                                    await pointsCollection.insertOne(point);
                                    individualSuccess++;
                                } catch (individualError) {
                                    if (individualError.code === 11000) {
                                        // Ponto duplicado pulado
                                        individualErrors++;
                                    } else {
                                        throw individualError;
                                    }
                                }
                            }
                            
                            insertedCount += individualSuccess;
                            errorCount += individualErrors;
                            
                            emitToUser('batch-warning', {
                                campaignId: campaignId,
                                batchNumber: batchNumber,
                                warning: `Lote ${batchNumber} parcialmente inserido: ${individualSuccess} pontos inseridos, ${individualErrors} pontos duplicados pulados`,
                                duplicatesSkipped: individualErrors,
                                pointsInserted: individualSuccess,
                                insertedCount: insertedCount,
                                errorCount: errorCount
                            });
                        } else {
                            // Outro tipo de erro
                            errorCount += batchPoints.length;
                            
                            emitToUser('batch-error', {
                                campaignId: campaignId,
                                batchNumber: batchNumber,
                                error: insertError.message,
                                errorCode: insertError.code,
                                pointsAffected: batchPoints.length,
                                errorCount: errorCount
                            });
                        }
                    }
                }
                
                // Emitir progresso final do lote
                emitToUser('features-processed', {
                    campaignId: campaignId,
                    processedCount: processedCount,
                    insertedCount: insertedCount,
                    totalFeatures: totalFeatures,
                    progress: Math.round((processedCount / totalFeatures) * 100)
                });
                
                // Pequena pausa entre batches para não bloquear o event loop
                await new Promise(resolve => setImmediate(resolve));
            }
            
            const endTime = new Date();
            const duration = endTime - startTime;
            
            const result = {
                success: true,
                message: 'Upload processado com sucesso',
                campaignId: campaignId,
                totalFeatures: totalFeatures,
                processedCount: processedCount,
                insertedCount: insertedCount,
                errorCount: errorCount,
                filename: savedFilename,
                properties: Array.from(allProperties),
                duration: duration,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString()
            };
            
            // Emitir evento de conclusão
            emitToUser('upload-completed', result);
            
            // GeoJSON upload foreground completed
            
            return result;
            
        } catch (error) {
            console.error('Error in foreground GeoJSON processing:', error);
            
            const errorResult = {
                success: false,
                error: error.message,
                campaignId: campaignId,
                processedCount: processedCount,
                insertedCount: insertedCount,
                errorCount: errorCount
            };
            
            emitToUser('upload-failed', errorResult);
            
            throw error;
        }
    };
    
    // Processamento em background do GeoJSON
    CampaignCrud.processGeoJSONBackground = async (campaignId, geojsonData, filename, io, sessionId, userId) => {
        const totalFeatures = geojsonData.features.length;
        let processedCount = 0;
        let errorCount = 0;
        const startTime = new Date();
        
        // Processamento iniciado
        
        // Função para emitir eventos para o socket correto
        const emitToUser = (event, data) => {
            if (io) {
                // Emitir para todos os sockets da sala geojson-upload
                io.to('geojson-upload').emit(event, {
                    ...data,
                    sessionId: sessionId,
                    userId: userId
                });
                
                // Também emitir para a sessão específica
                io.to(sessionId).emit(event, {
                    ...data,
                    sessionId: sessionId,
                    userId: userId
                });
                
                // Evento emitido
            }
        };
        
        // Emitir evento de início
        emitToUser('upload-started', {
            campaignId: campaignId,
            totalFeatures: totalFeatures,
            filename: filename,
            timestamp: startTime.toISOString()
        });
        
        try {
            // Salvar arquivo
            const uploadsDir = path.join(__dirname, '../../uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const savedFilename = 'campaign-' + uniqueSuffix + '.geojson';
            const filePath = path.join(uploadsDir, savedFilename);
            
            fs.writeFileSync(filePath, JSON.stringify(geojsonData, null, 2));
            
            // Extrair propriedades únicas de todas as features
            const allProperties = new Set();
            geojsonData.features.forEach(feature => {
                Object.keys(feature.properties || {}).forEach(key => {
                    allProperties.add(key);
                });
            });
            
            // Atualizar a campanha com as propriedades e arquivo
            await campaignCollection.updateOne(
                { _id: campaignId },
                { 
                    $set: { 
                        geojsonFile: savedFilename,
                        properties: Array.from(allProperties)
                    } 
                }
            );
            
            // Buscar o último índice inserido para esta campanha
            let lastPoint = await pointsCollection.findOne(
                { campaign: campaignId },
                { sort: { index: -1 }, projection: { index: 1 } }
            );
            
            let counter = lastPoint ? lastPoint.index + 1 : 1;
            // Iniciando contador de pontos
            
            // Processar os pontos em lotes
            const points = [];
            const batchSize = 100; // Processar em lotes de 100
            
            for (let i = 0; i < geojsonData.features.length; i += batchSize) {
                const batch = geojsonData.features.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(geojsonData.features.length / batchSize);
                
                // Emitir progresso do batch
                if (io) {
                    io.to('geojson-upload').emit('batch-processing', {
                        campaignId: campaignId,
                        batchNumber: batchNumber,
                        totalBatches: totalBatches,
                        batchSize: batch.length,
                        processedCount: processedCount,
                        progress: Math.round((processedCount / totalFeatures) * 100)
                    });
                }
                
                const batchPoints = [];
                
                for (const feature of batch) {
                    try {
                        if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length < 2) {
                            errorCount++;
                            if (io) {
                                io.to('geojson-upload').emit('feature-error', {
                                    campaignId: campaignId,
                                    featureIndex: i + batch.indexOf(feature),
                                    error: 'Invalid geometry coordinates'
                                });
                            }
                            continue;
                        }
                        
                        const coordinate = {
                            X: feature.geometry.coordinates[0],
                            Y: feature.geometry.coordinates[1]
                        };
                        
                        // Validar coordenadas
                        if (isNaN(coordinate.X) || isNaN(coordinate.Y)) {
                            errorCount++;
                            if (io) {
                                io.to('geojson-upload').emit('feature-error', {
                                    campaignId: campaignId,
                                    featureIndex: i + batch.indexOf(feature),
                                    error: 'Invalid coordinate values'
                                });
                            }
                            continue;
                        }
                        
                        const point = {
                            _id: counter + '_' + campaignId,
                            campaign: campaignId,
                            lon: coordinate.X,
                            lat: coordinate.Y,
                            dateImport: new Date(),
                            biome: (feature.properties && feature.properties.biome) || null,
                            uf: (feature.properties && feature.properties.uf) || null,
                            county: (feature.properties && feature.properties.county) || null,
                            countyCode: (feature.properties && feature.properties.countyCode) || null,
                            path: (feature.properties && feature.properties.path) || null,
                            row: (feature.properties && feature.properties.row) || null,
                            userName: [],
                            inspection: [],
                            underInspection: 0,
                            index: counter++,
                            cached: false,
                            enhance_in_cache: 1,
                            // Armazenar todas as propriedades do GeoJSON
                            properties: feature.properties || {}
                        };
                        
                        batchPoints.push(point);
                        processedCount++;
                        
                        // Emitir progresso de feature individual ocasionalmente
                        if (processedCount % 50 === 0 && io) {
                            io.to('geojson-upload').emit('features-processed', {
                                campaignId: campaignId,
                                processedCount: processedCount,
                                totalFeatures: totalFeatures,
                                progress: Math.round((processedCount / totalFeatures) * 100)
                            });
                        }
                        
                    } catch (featureError) {
                        errorCount++;
                        console.error('Error processing feature:', featureError);
                        if (io) {
                            io.to('geojson-upload').emit('feature-error', {
                                campaignId: campaignId,
                                featureIndex: i + batch.indexOf(feature),
                                error: featureError.message
                            });
                        }
                    }
                }
                
                // Inserir batch no banco
                if (batchPoints.length > 0) {
                    try {
                        await pointsCollection.insertMany(batchPoints);
                        
                        if (io) {
                            io.to('geojson-upload').emit('batch-completed', {
                                campaignId: campaignId,
                                batchNumber: batchNumber,
                                totalBatches: totalBatches,
                                batchPointsInserted: batchPoints.length,
                                processedCount: processedCount,
                                errorCount: errorCount,
                                progress: Math.round((processedCount / totalFeatures) * 100)
                            });
                        }
                    } catch (insertError) {
                        console.error('Error inserting batch:', insertError);
                        
                        // Verificar se é erro de chave duplicada
                        if (insertError.code === 11000) {
                            // Extrair IDs duplicados
                            const duplicateMatch = insertError.message.match(/dup key: { _id: "([^"]+)" }/);
                            const duplicateId = duplicateMatch ? duplicateMatch[1] : 'unknown';
                            
                            // Erro de chave duplicada detectado
                            
                            // Tentar inserir pontos individualmente, pulando duplicados
                            let individualErrors = 0;
                            let individualSuccess = 0;
                            
                            for (const point of batchPoints) {
                                try {
                                    await pointsCollection.insertOne(point);
                                    individualSuccess++;
                                } catch (individualError) {
                                    if (individualError.code === 11000) {
                                        // Ponto duplicado pulado
                                        individualErrors++;
                                    } else {
                                        throw individualError;
                                    }
                                }
                            }
                            
                            processedCount = processedCount - batchPoints.length + individualSuccess;
                            errorCount += individualErrors;
                            
                            if (io) {
                                io.to('geojson-upload').emit('batch-warning', {
                                    campaignId: campaignId,
                                    batchNumber: batchNumber,
                                    warning: `Batch parcialmente inserido: ${individualSuccess} pontos inseridos, ${individualErrors} pontos duplicados pulados`,
                                    duplicatesSkipped: individualErrors,
                                    pointsInserted: individualSuccess
                                });
                            }
                        } else {
                            // Outro tipo de erro
                            errorCount += batchPoints.length;
                            processedCount -= batchPoints.length; // Ajustar contador
                            
                            if (io) {
                                io.to('geojson-upload').emit('batch-error', {
                                    campaignId: campaignId,
                                    batchNumber: batchNumber,
                                    error: insertError.message,
                                    errorCode: insertError.code
                                });
                            }
                        }
                    }
                }
                
                // Pequena pausa entre batches para não sobrecarregar o sistema
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            const endTime = new Date();
            const duration = endTime - startTime;
            
            // Emitir evento de conclusão
            if (io) {
                io.to('geojson-upload').emit('upload-completed', {
                    campaignId: campaignId,
                    totalFeatures: totalFeatures,
                    processedCount: processedCount,
                    errorCount: errorCount,
                    filename: savedFilename,
                    properties: Array.from(allProperties),
                    duration: duration,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    success: true
                });
            }
            
            // GeoJSON upload completed
            
        } catch (error) {
            console.error('Error in background GeoJSON processing:', error);
            
            if (io) {
                io.to('geojson-upload').emit('upload-failed', {
                    campaignId: campaignId,
                    error: error.message,
                    processedCount: processedCount,
                    errorCount: errorCount
                });
            }
        }
    };


    // Listar pontos de uma campanha
    CampaignCrud.listPoints = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const limit = parseInt(req.query.limit) || 100;
            const skip = parseInt(req.query.skip) || 0;
            const search = req.query.search;
            
            // Construir query base
            let query = { campaign: campaignId };
            
            // Adicionar filtro de busca se fornecido
            if (search && search.trim()) {
                const searchTrim = search.trim();
                // Buscar por ID que contenha o termo de busca
                query._id = { $regex: searchTrim, $options: 'i' };
            }
            
            const points = await pointsCollection
                .find(query)
                .limit(limit)
                .skip(skip)
                .sort({ index: 1 })
                .toArray();
                
            const total = await pointsCollection.count(query);
            
            res.json({
                points: points,
                total: total,
                limit: limit,
                skip: skip,
                search: search || null
            });
        } catch (error) {
            console.error('Error listing points:', error);
            res.status(500).json({ error: 'Failed to list points' });
        }
    };

    // Deletar pontos de uma campanha
    CampaignCrud.deletePoints = async (req, res) => {
        try {
            const campaignId = req.params.id;
            
            const result = await pointsCollection.deleteMany({ campaign: campaignId });
            
            res.json({ 
                success: true, 
                message: `Deleted ${result.deletedCount} points` 
            });
        } catch (error) {
            console.error('Error deleting points:', error);
            res.status(500).json({ error: 'Failed to delete points' });
        }
    };

    // Obter propriedades disponíveis nos pontos de uma campanha
    CampaignCrud.getAvailableProperties = async (req, res) => {
        try {
            const campaignId = req.params.id;
            
            // Verificar se a campanha existe
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Usar o PropertyAnalyzer para analisar as propriedades
            const propertyAnalysis = await PropertyAnalyzer.analyzeProperties(
                pointsCollection, 
                campaignId, 
                campaign.numInspec
            );
            
            res.json(propertyAnalysis);
            
        } catch (error) {
            console.error('Error getting available properties:', error);
            res.status(500).json({ error: 'Failed to get available properties' });
        }
    };

    // Agregar dados de uma propriedade específica
    CampaignCrud.aggregatePropertyData = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const propertyName = req.query.property;
            const aggregationType = req.query.type || 'distribution';
            
            if (!propertyName) {
                return res.status(400).json({ error: 'Property name is required' });
            }
            
            // Verificar se a campanha existe
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            let result;
            
            switch (aggregationType) {
                case 'distribution':
                    // Agregação para propriedades categóricas
                    result = await aggregateCategoricalProperty(pointsCollection, campaignId, propertyName, campaign.numInspec);
                    break;
                    
                case 'histogram':
                    // Agregação para propriedades numéricas
                    result = await aggregateNumericProperty(pointsCollection, campaignId, propertyName, campaign.numInspec);
                    break;
                    
                case 'temporal':
                    // Agregação temporal
                    result = await aggregateTemporalProperty(pointsCollection, campaignId, propertyName, campaign.numInspec);
                    break;
                    
                case 'cross':
                    // Agregação cruzada de duas propriedades
                    const property2 = req.query.property2;
                    if (!property2) {
                        return res.status(400).json({ error: 'Second property name is required for cross analysis' });
                    }
                    result = await aggregateCrossProperties(pointsCollection, campaignId, propertyName, property2, campaign.numInspec);
                    break;
                    
                default:
                    return res.status(400).json({ error: 'Invalid aggregation type' });
            }
            
            res.json(result);
            
        } catch (error) {
            console.error('Error aggregating property data:', error);
            res.status(500).json({ error: 'Failed to aggregate property data' });
        }
    };
    
    // Funções auxiliares de agregação
    async function aggregateCategoricalProperty(collection, campaignId, propertyName, numInspec) {
        const fieldPath = propertyName.includes('.') ? `$${propertyName}` : `$${propertyName}`;
        
        // Check if the field is an array
        const sampleDoc = await collection.findOne({ campaign: campaignId });
        const fieldValue = propertyName.includes('.') 
            ? propertyName.split('.').reduce((obj, key) => obj && obj[key], sampleDoc)
            : sampleDoc && sampleDoc[propertyName];
        
        const isArray = Array.isArray(fieldValue);
        
        let pipeline;
        
        if (isArray) {
            // If field is array, unwind it first to count individual values
            pipeline = [
                { $match: { campaign: campaignId } },
                { $project: {
                    value: fieldPath,
                    userNameCount: { $size: { $ifNull: ["$userName", []] } }
                }},
                { $match: { 
                    userNameCount: { $gte: numInspec },
                    value: { $exists: true, $ne: null }
                }},
                { $unwind: "$value" },
                { $group: {
                    _id: "$value",
                    count: { $sum: 1 }
                }},
                { $sort: { count: -1 } },
                { $limit: 20 }
            ];
        } else {
            // Regular categorical aggregation
            pipeline = [
                { $match: { campaign: campaignId } },
                { $project: {
                    value: fieldPath,
                    userNameCount: { $size: { $ifNull: ["$userName", []] } }
                }},
                { $match: { 
                    userNameCount: { $gte: numInspec },
                    value: { $exists: true, $ne: null }
                }},
                { $group: {
                    _id: "$value",
                    count: { $sum: 1 }
                }},
                { $sort: { count: -1 } },
                { $limit: 20 }
            ];
        }
        
        const results = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
        
        return {
            type: 'categorical',
            property: propertyName,
            data: results.map(r => ({
                label: String(r._id),
                value: r.count
            })),
            total: results.reduce((sum, r) => sum + r.count, 0)
        };
    }
    
    async function aggregateNumericProperty(collection, campaignId, propertyName, numInspec) {
        const fieldPath = propertyName.includes('.') ? `$${propertyName}` : `$${propertyName}`;
        
        // Primeiro, obter estatísticas básicas
        const statsPipeline = [
            { $match: { campaign: campaignId } },
            { $project: {
                value: fieldPath,
                userNameCount: { $size: { $ifNull: ["$userName", []] } }
            }},
            { $match: { 
                userNameCount: { $gte: numInspec },
                value: { $exists: true, $ne: null, $type: "number" }
            }},
            { $group: {
                _id: null,
                min: { $min: "$value" },
                max: { $max: "$value" },
                avg: { $avg: "$value" },
                count: { $sum: 1 },
                values: { $push: "$value" }
            }}
        ];
        
        const statsResult = await collection.aggregate(statsPipeline, { allowDiskUse: true }).toArray();
        
        if (statsResult.length === 0) {
            return {
                type: 'numeric',
                property: propertyName,
                data: [],
                statistics: null
            };
        }
        
        const stats = statsResult[0];
        
        // Criar bins para histograma
        const binCount = Math.min(20, Math.ceil(Math.sqrt(stats.count)));
        const binSize = (stats.max - stats.min) / binCount;
        
        const histogramPipeline = [
            { $match: { campaign: campaignId } },
            { $project: {
                value: fieldPath,
                userNameCount: { $size: { $ifNull: ["$userName", []] } }
            }},
            { $match: { 
                userNameCount: { $gte: numInspec },
                value: { $exists: true, $ne: null, $type: "number" }
            }},
            { $bucket: {
                groupBy: "$value",
                boundaries: Array.from({length: binCount + 1}, (_, i) => stats.min + (i * binSize)),
                default: "other",
                output: {
                    count: { $sum: 1 }
                }
            }}
        ];
        
        const histogram = await collection.aggregate(histogramPipeline, { allowDiskUse: true }).toArray();
        
        return {
            type: 'numeric',
            property: propertyName,
            data: histogram.map(h => ({
                range: [h._id, h._id + binSize],
                count: h.count
            })),
            statistics: {
                min: stats.min,
                max: stats.max,
                mean: stats.avg,
                count: stats.count
            }
        };
    }
    
    async function aggregateTemporalProperty(collection, campaignId, propertyName, numInspec) {
        const fieldPath = propertyName.includes('.') ? `$${propertyName}` : `$${propertyName}`;
        
        const pipeline = [
            { $match: { campaign: campaignId } },
            { $project: {
                dateValue: {
                    $cond: {
                        if: { $isArray: fieldPath },
                        then: { $arrayElemAt: [fieldPath, 0] },
                        else: fieldPath
                    }
                },
                userNameCount: { $size: { $ifNull: ["$userName", []] } }
            }},
            { $match: { 
                userNameCount: { $gte: numInspec },
                dateValue: { $exists: true, $ne: null }
            }},
            { $project: {
                dateValue: 1,
                // Try to convert to date if it's a string
                date: {
                    $cond: {
                        if: { $eq: [{ $type: "$dateValue" }, "string"] },
                        then: { $dateFromString: { 
                            dateString: "$dateValue",
                            format: "%Y-%m-%dT%H:%M:%S.%L%z",
                            onError: { $dateFromString: { 
                                dateString: "$dateValue",
                                onError: null 
                            }}
                        }},
                        else: {
                            $cond: {
                                if: { $eq: [{ $type: "$dateValue" }, "date"] },
                                then: "$dateValue",
                                else: {
                                    $cond: {
                                        if: { $eq: [{ $type: "$dateValue" }, "object"] },
                                        then: {
                                            $convert: {
                                                input: "$dateValue",
                                                to: "date",
                                                onError: null
                                            }
                                        },
                                        else: null
                                    }
                                }
                            }
                        }
                    }
                }
            }},
            { $match: { date: { $ne: null } } },
            { $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$date" }
                },
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ];
        
        const results = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
        
        return {
            type: 'temporal',
            property: propertyName,
            data: results.map(r => ({
                date: r._id,
                value: r.count
            }))
        };
    }
    
    async function aggregateCrossProperties(collection, campaignId, property1, property2, numInspec) {
        const field1Path = property1.includes('.') ? `$${property1}` : `$${property1}`;
        const field2Path = property2.includes('.') ? `$${property2}` : `$${property2}`;
        
        const pipeline = [
            { $match: { campaign: campaignId } },
            { $project: {
                prop1: field1Path,
                prop2: field2Path,
                userNameCount: { $size: { $ifNull: ["$userName", []] } }
            }},
            { $match: { 
                userNameCount: { $gte: numInspec },
                prop1: { $exists: true, $ne: null },
                prop2: { $exists: true, $ne: null }
            }},
            { $group: {
                _id: {
                    prop1: "$prop1",
                    prop2: "$prop2"
                },
                count: { $sum: 1 }
            }},
            { $sort: { count: -1 } },
            { $limit: 100 }
        ];
        
        const results = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
        
        // Organizar dados para heatmap
        const heatmapData = {};
        const prop1Values = new Set();
        const prop2Values = new Set();
        
        results.forEach(r => {
            prop1Values.add(r._id.prop1);
            prop2Values.add(r._id.prop2);
            if (!heatmapData[r._id.prop1]) {
                heatmapData[r._id.prop1] = {};
            }
            heatmapData[r._id.prop1][r._id.prop2] = r.count;
        });
        
        return {
            type: 'cross',
            property1: property1,
            property2: property2,
            data: {
                x: Array.from(prop2Values),
                y: Array.from(prop1Values),
                z: Array.from(prop1Values).map(p1 => 
                    Array.from(prop2Values).map(p2 => 
                        heatmapData[p1] && heatmapData[p1][p2] || 0
                    )
                )
            }
        };
    }

    return CampaignCrud;
};
