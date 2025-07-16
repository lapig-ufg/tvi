const fs = require('fs');
const path = require('path');
const async = require('async');

module.exports = function(app) {
    const config = app.config;
    const campaignCollection = app.repository.collections.campaign;
    const pointsCollection = app.repository.collections.points;
    
    const CampaignCrudEnhanced = {};

    // Função auxiliar para descobrir propriedades disponíveis nos pontos
    CampaignCrudEnhanced.discoverPointProperties = async (campaignId) => {
        try {
            // Buscar uma amostra de pontos para descobrir propriedades
            const samplePoints = await pointsCollection
                .find({ campaign: campaignId })
                .limit(100)
                .toArray();
            
            if (samplePoints.length === 0) {
                return {
                    standardFields: [],
                    customProperties: []
                };
            }
            
            // Campos padrão que sempre existem
            const standardFields = [
                'lon', 'lat', 'campaign', 'userName', 'inspection',
                'biome', 'uf', 'county', 'countyCode', 'path', 'row',
                'mode', 'consolidated', 'index'
            ];
            
            // Descobrir propriedades customizadas
            const customPropertiesSet = new Set();
            const propertyTypes = {};
            const propertyExamples = {};
            
            samplePoints.forEach(point => {
                // Verificar propriedades no nível raiz
                Object.keys(point).forEach(key => {
                    if (!standardFields.includes(key) && !key.startsWith('_')) {
                        customPropertiesSet.add(key);
                        if (!propertyExamples[key] && point[key] !== null && point[key] !== undefined) {
                            propertyExamples[key] = point[key];
                            propertyTypes[key] = typeof point[key];
                        }
                    }
                });
                
                // Verificar propriedades dentro do objeto properties
                if (point.properties && typeof point.properties === 'object') {
                    Object.keys(point.properties).forEach(key => {
                        const fullKey = `properties.${key}`;
                        customPropertiesSet.add(fullKey);
                        if (!propertyExamples[fullKey] && point.properties[key] !== null && point.properties[key] !== undefined) {
                            propertyExamples[fullKey] = point.properties[key];
                            propertyTypes[fullKey] = typeof point.properties[key];
                        }
                    });
                }
            });
            
            // Montar resposta estruturada
            const customProperties = Array.from(customPropertiesSet).map(prop => ({
                name: prop,
                type: propertyTypes[prop] || 'unknown',
                example: propertyExamples[prop],
                isNested: prop.includes('.')
            }));
            
            return {
                standardFields: standardFields.filter(field => 
                    samplePoints.some(point => point[field] !== undefined)
                ),
                customProperties: customProperties
            };
        } catch (error) {
            console.error('Error discovering point properties:', error);
            throw error;
        }
    };

    // Obter dados detalhados e estatísticas de uma campanha com inferência de propriedades
    CampaignCrudEnhanced.getDetailsEnhanced = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Descobrir propriedades disponíveis
            const availableProperties = await CampaignCrudEnhanced.discoverPointProperties(campaignId);
            
            // Determinar qual campo usar para classificação (mode, classe, landuse, etc.)
            let classificationField = null;
            const possibleClassFields = ['mode', 'classe', 'landuse', 'land_use', 'uso_solo', 'class', 'categoria'];
            
            // Primeiro verificar campos padrão
            for (const field of possibleClassFields) {
                if (availableProperties.standardFields.includes(field)) {
                    classificationField = field;
                    break;
                }
            }
            
            // Se não encontrou, verificar propriedades customizadas
            if (!classificationField) {
                for (const field of possibleClassFields) {
                    const propField = `properties.${field}`;
                    if (availableProperties.customProperties.some(p => p.name === propField)) {
                        classificationField = propField;
                        break;
                    }
                }
            }
            
            // Se ainda não encontrou, usar o primeiro campo de texto das propriedades customizadas
            if (!classificationField && availableProperties.customProperties.length > 0) {
                const textProperty = availableProperties.customProperties.find(p => p.type === 'string');
                if (textProperty) {
                    classificationField = textProperty.name;
                }
            }
            
            // Executar todas as queries em paralelo
            const [
                totalPoints, 
                completedResult, 
                userStats, 
                classStats, 
                stateStats, 
                biomeStats, 
                progressTimeline, 
                pendingByMunicipality,
                propertyDistributions
            ] = await Promise.all([
                // Total de pontos
                pointsCollection.count({ campaign: campaign._id }),
                
                // Pontos completos
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $match: { userNameCount: { $gte: campaign.numInspec } } },
                    { $count: "total" }
                ], { allowDiskUse: true }).toArray(),
                
                // Estatísticas por usuário
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
                
                // Estatísticas por classe (usando campo dinâmico)
                classificationField ? pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        classification: classificationField.includes('.') 
                            ? { $getField: { 
                                field: classificationField.split('.')[1], 
                                input: `$${classificationField.split('.')[0]}` 
                              }}
                            : `$${classificationField}`,
                        userNameCount: { $size: { $ifNull: ["$userName", []] } }
                    }},
                    { $match: { userNameCount: { $gte: campaign.numInspec } } },
                    { $group: {
                        _id: "$classification",
                        count: { $sum: 1 }
                    }},
                    { $sort: { count: -1 } }
                ], { allowDiskUse: true }).toArray() : Promise.resolve([]),
                
                // Estatísticas por estado
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        uf: 1,
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
                
                // Estatísticas por bioma
                pointsCollection.aggregate([
                    { $match: { campaign: campaign._id } },
                    { $project: {
                        biome: 1,
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
                
                // Progresso ao longo do tempo
                (async () => {
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    
                    return pointsCollection.aggregate([
                        { $match: { 
                            campaign: campaign._id,
                            "inspection.counter": { $gte: campaign.numInspec },
                            "inspection.date": { $gte: thirtyDaysAgo }
                        }},
                        { $unwind: "$inspection" },
                        { $match: {
                            "inspection.counter": { $gte: campaign.numInspec },
                            "inspection.date": { $gte: thirtyDaysAgo }
                        }},
                        { $group: {
                            _id: {
                                $dateToString: { format: "%Y-%m-%d", date: "$inspection.date" }
                            },
                            count: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ], { allowDiskUse: true }).toArray();
                })(),
                
                // Pontos pendentes por município
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
                
                // Distribuições de propriedades customizadas (top 3)
                CampaignCrudEnhanced.getPropertyDistributions(
                    campaignId, 
                    availableProperties.customProperties.slice(0, 3),
                    campaign.numInspec
                )
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
                        fieldUsed: classificationField
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
                    customPropertyDistributions: propertyDistributions
                },
                availableProperties: availableProperties,
                metadata: {
                    classificationField: classificationField,
                    hasCustomProperties: availableProperties.customProperties.length > 0
                }
            };
            
            res.json(details);
        } catch (error) {
            console.error('Error getting enhanced campaign details:', error);
            res.status(500).json({ error: 'Failed to get campaign details' });
        }
    };

    // Obter distribuições de propriedades customizadas
    CampaignCrudEnhanced.getPropertyDistributions = async (campaignId, properties, numInspec) => {
        const distributions = {};
        
        for (const prop of properties) {
            try {
                let aggregationPipeline;
                
                if (prop.isNested) {
                    const [parent, child] = prop.name.split('.');
                    aggregationPipeline = [
                        { $match: { campaign: campaignId } },
                        { $project: {
                            value: `$${parent}.${child}`,
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
                        { $limit: 10 }
                    ];
                } else {
                    aggregationPipeline = [
                        { $match: { campaign: campaignId } },
                        { $project: {
                            value: `$${prop.name}`,
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
                        { $limit: 10 }
                    ];
                }
                
                const result = await pointsCollection.aggregate(aggregationPipeline, { allowDiskUse: true }).toArray();
                
                distributions[prop.name] = {
                    property: prop.name,
                    type: prop.type,
                    distribution: result
                };
            } catch (err) {
                console.error(`Error getting distribution for property ${prop.name}:`, err);
                distributions[prop.name] = {
                    property: prop.name,
                    type: prop.type,
                    distribution: [],
                    error: err.message
                };
            }
        }
        
        return distributions;
    };

    // Endpoint para descobrir propriedades disponíveis
    CampaignCrudEnhanced.getAvailableProperties = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const properties = await CampaignCrudEnhanced.discoverPointProperties(campaignId);
            res.json(properties);
        } catch (error) {
            console.error('Error getting available properties:', error);
            res.status(500).json({ error: 'Failed to get available properties' });
        }
    };

    return CampaignCrudEnhanced;
};