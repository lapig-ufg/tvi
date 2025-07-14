const fs = require('fs');
const path = require('path');
const async = require('async');
const exec = require('child_process').exec;

module.exports = function(app) {
    const config = app.config;
    const campaignCollection = app.repository.collections.campaign;
    const pointsCollection = app.repository.collections.points;
    
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

    // Listar todas as campanhas com paginação e ordenação decrescente
    CampaignCrud.list = async (req, res) => {
        try {
            // Parâmetros de paginação
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;
            
            // Contar total de campanhas
            const totalCampaigns = await campaignCollection.count({});
            
            // Buscar campanhas com paginação e ordenação decrescente por data de criação
            const campaigns = await campaignCollection.find({})
                .sort({ _id: -1 })  // Ordenação decrescente por _id (que representa data de criação)
                .skip(skip)
                .limit(limit)
                .toArray();
            
            // Para cada campanha, contar quantos pontos existem
            for (let campaign of campaigns) {
                const totalPoints = await pointsCollection.count({ campaign: campaign._id });
                const completedPoints = await pointsCollection.count({ 
                    campaign: campaign._id,
                    $where: `this.userName.length >= ${campaign.numInspec}`
                });
                
                campaign.totalPoints = totalPoints;
                campaign.completedPoints = completedPoints;
                campaign.progress = totalPoints > 0 ? (completedPoints / totalPoints * 100).toFixed(2) : 0;
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
            const completedPoints = await pointsCollection.count({ 
                campaign: campaign._id,
                $where: `this.userName.length >= ${campaign.numInspec}`
            });
            
            campaign.totalPoints = totalPoints;
            campaign.completedPoints = completedPoints;
            campaign.progress = totalPoints > 0 ? (completedPoints / totalPoints * 100).toFixed(2) : 0;
            
            res.json(campaign);
        } catch (error) {
            console.error('Error getting campaign:', error);
            res.status(500).json({ error: 'Failed to get campaign' });
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
                landUse: campaignData.landUse || [
                    "Pastagem Natural", 
                    "Vegetação nativa", 
                    "Pastagem Cultivada", 
                    "Não observado", 
                    "Agricultura Anual", 
                    "Em regeneração", 
                    "Agricultura Perene", 
                    "Mosaico de ocupação", 
                    "Água", 
                    "Solo Exposto", 
                    "Cana-de-açucar", 
                    "Desmatamento", 
                    "Área urbana", 
                    "Silvicultura"
                ],
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

    // Upload de GeoJSON e processamento - sem dependência de multer
    CampaignCrud.uploadGeoJSON = async (req, res) => {
        try {
            const campaignId = req.body.campaignId;
            const skipGeoprocessing = req.body.skipGeoprocessing === 'true';
            const geojsonContent = req.body.geojsonContent;
            const filename = req.body.filename || 'campaign-upload.geojson';
            
            if (!geojsonContent) {
                return res.status(400).json({ error: 'No GeoJSON content provided' });
            }
            
            // Verificar se a campanha existe
            const campaign = await campaignCollection.findOne({ _id: campaignId });
            if (!campaign) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Parse do conteúdo GeoJSON
            let geojsonData;
            try {
                geojsonData = JSON.parse(geojsonContent);
            } catch (parseError) {
                return res.status(400).json({ error: 'Invalid GeoJSON format' });
            }
            
            // Salvar arquivo se necessário
            const uploadsDir = path.join(__dirname, '../../uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const savedFilename = 'campaign-' + uniqueSuffix + '.geojson';
            const filePath = path.join(uploadsDir, savedFilename);
            
            fs.writeFileSync(filePath, geojsonContent);
            
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
            
            // Processar os pontos
            const points = [];
            let counter = 1;
            
            for (const feature of geojsonData.features) {
                const coordinate = {
                    X: feature.geometry.coordinates[0],
                    Y: feature.geometry.coordinates[1]
                };
                
                let regionInfo = {};
                let tileInfo = {};
                
                if (!skipGeoprocessing) {
                    // Obter informações de região e tile
                    regionInfo = await getInfoByRegion(coordinate);
                    tileInfo = await getInfoByTile(coordinate);
                }
                
                const point = {
                    _id: counter + '_' + campaignId,
                    campaign: campaignId,
                    lon: coordinate.X,
                    lat: coordinate.Y,
                    dateImport: new Date(),
                    biome: feature.properties.biome || regionInfo.biome || null,
                    uf: feature.properties.uf || regionInfo.uf || null,
                    county: feature.properties.county || regionInfo.county || null,
                    countyCode: feature.properties.countyCode || regionInfo.countyCode || null,
                    path: tileInfo.path || null,
                    row: tileInfo.row || null,
                    userName: [],
                    inspection: [],
                    underInspection: 0,
                    index: counter++,
                    cached: false,
                    enhance_in_cache: 1,
                    // Armazenar todas as propriedades do GeoJSON
                    properties: feature.properties || {}
                };
                
                points.push(point);
            }
            
            // Inserir pontos em lote
            if (points.length > 0) {
                await pointsCollection.insertMany(points);
            }
            
            res.json({ 
                success: true, 
                message: `Successfully imported ${points.length} points`,
                filename: savedFilename,
                properties: Array.from(allProperties)
            });
            
        } catch (error) {
            console.error('Error processing GeoJSON:', error);
            res.status(500).json({ error: 'Failed to process GeoJSON: ' + error.message });
        }
    };

    // Funções auxiliares para obter informações geoespaciais
    const getInfoByRegion = (coordinate) => {
        return new Promise((resolve, reject) => {
            const regions = "SHP/regions.shp";
            const sql = `select COD_MUNICI,BIOMA,UF,MUNICIPIO from regions where ST_INTERSECTS(Geometry,GeomFromText('POINT(${coordinate.X} ${coordinate.Y})',4326))`;
            const cmd = `ogrinfo -q -geom=no -dialect sqlite -sql "${sql}" ${regions}`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error getting region info:', error);
                    return resolve({});
                }
                
                const strs = stdout.split("\n");
                const result = {};
                
                for (const str of strs) {
                    if (str.match(/BIOMA/g)) {
                        result.biome = str.slice(18).trim();
                    } else if (str.match(/UF/g)) {
                        result.uf = str.slice(15, 18).trim();
                    } else if (str.match(/MUNICIPIO/g)) {
                        result.county = str.slice(22).trim();
                    } else if (str.match(/COD_MUNICI/g)) {
                        result.countyCode = str.slice(26, 35).trim();
                    }
                }
                
                resolve(result);
            });
        });
    };
    
    const getInfoByTile = (coordinate) => {
        return new Promise((resolve, reject) => {
            const tiles = "SHP/tiles.shp";
            const sql = `select path,row from tiles where ST_INTERSECTS(Geometry,GeomFromText('POINT(${coordinate.X} ${coordinate.Y})',4326))`;
            const cmd = `ogrinfo -q -geom=no -dialect sqlite -sql "${sql}" ${tiles}`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error getting tile info:', error);
                    return resolve({});
                }
                
                const strs = stdout.split("\n");
                const result = {};
                
                for (const str of strs) {
                    if (str.match(/row/g)) {
                        result.row = Number(str.slice(18, 21).trim());
                    } else if (str.match(/path/g)) {
                        result.path = Number(str.slice(19, 22).trim());
                    }
                }
                
                resolve(result);
            });
        });
    };

    // Listar pontos de uma campanha
    CampaignCrud.listPoints = async (req, res) => {
        try {
            const campaignId = req.params.id;
            const limit = parseInt(req.query.limit) || 100;
            const skip = parseInt(req.query.skip) || 0;
            
            const points = await pointsCollection
                .find({ campaign: campaignId })
                .limit(limit)
                .skip(skip)
                .toArray();
                
            const total = await pointsCollection.count({ campaign: campaignId });
            
            res.json({
                points: points,
                total: total,
                limit: limit,
                skip: skip
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

    return CampaignCrud;
};