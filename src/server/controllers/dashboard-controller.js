module.exports = function(app) {
    const DashboardController = {};
    const logger = app.services.logger;

    /**
     * Middleware para verificar autenticação de admin
     */
    const checkAdminAuth = (req, res, next) => {
        if (!req.session || !req.session.admin || !req.session.admin.superAdmin) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access' 
            });
        }
        next();
    };

    /**
     * Obter estatísticas gerais do dashboard
     */
    DashboardController.getStats = async (req, res) => {
        try {
            const db = app.repository.db;
            
            // Estatísticas de campanhas
            const campaignsCount = await db.collection('campaign').count();
            const activeCampaignsCount = await db.collection('campaign').count({ 
                numInspec: { $gt: 0 } 
            });
            
            // Estatísticas de pontos
            const pointsCount = await db.collection('points').count();
            
            // Estatísticas de usuários
            const usersCount = await db.collection('users').count();
            const inspectorsCount = await db.collection('users').count({ 
                type: 'inspector' 
            });
            const supervisorsCount = await db.collection('users').count({ 
                type: 'supervisor' 
            });
            
            // Estatísticas de logs das últimas 24 horas
            const twentyFourHoursAgo = new Date();
            twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
            
            const recentLogsCount = await db.collection('logs').count({
                timestamp: { $gte: twentyFourHoursAgo }
            });
            
            const recentErrorsCount = await db.collection('logs').count({
                timestamp: { $gte: twentyFourHoursAgo },
                level: 'error'
            });
            
            // Status do sistema
            const systemHealth = recentErrorsCount === 0 ? 'healthy' : 
                               recentErrorsCount < 10 ? 'warning' : 'critical';
            
            res.json({
                success: true,
                data: {
                    campaigns: {
                        total: campaignsCount,
                        active: activeCampaignsCount
                    },
                    points: {
                        total: pointsCount
                    },
                    users: {
                        total: usersCount,
                        inspectors: inspectorsCount,
                        supervisors: supervisorsCount
                    },
                    logs: {
                        recent: recentLogsCount,
                        recentErrors: recentErrorsCount
                    },
                    system: {
                        health: systemHealth,
                        uptime: process.uptime()
                    }
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'dashboardController',
                function: 'getStats'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching dashboard statistics',
                errorCode
            });
        }
    };

    /**
     * Obter estatísticas de campanhas
     */
    DashboardController.getCampaignStats = async (req, res) => {
        try {
            const db = app.repository.db;
            
            // Total de campanhas
            const totalCampaigns = await db.collection('campaign').count();
            
            // Campanhas ativas (com inspeções)
            const activeCampaigns = await db.collection('campaign').count({ 
                numInspec: { $gt: 0 } 
            });
            
            // Campanhas concluídas
            const completedCampaigns = await db.collection('campaign').count({ 
                status: 'completed' 
            });
            
            // Total de inspeções
            const campaigns = await db.collection('campaign').find({}).toArray();
            const totalInspections = campaigns.reduce((sum, campaign) => {
                return sum + (campaign.numInspec || 0);
            }, 0);
            
            res.json({
                success: true,
                data: {
                    total: totalCampaigns,
                    active: activeCampaigns,
                    completed: completedCampaigns,
                    totalInspections: totalInspections
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'dashboardController',
                function: 'getCampaignStats'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching campaign statistics',
                errorCode
            });
        }
    };

    /**
     * Obter estatísticas de cache
     */
    DashboardController.getCacheStats = async (req, res) => {
        try {
            const db = app.repository.db;
            
            // Buscar configurações de cache
            const cacheConfigs = await db.collection('cacheConfig').find({}).toArray();
            
            // Contar configurações ativas
            const activeConfigs = cacheConfigs.filter(config => config.active).length;
            
            // Estatísticas gerais
            const stats = {
                totalConfigs: cacheConfigs.length,
                activeConfigs: activeConfigs,
                // Adicionar mais estatísticas conforme necessário
                lastUpdate: cacheConfigs.length > 0 ? 
                    Math.max(...cacheConfigs.map(c => new Date(c.updatedAt || c.createdAt).getTime())) : 
                    null
            };
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'dashboardController',
                function: 'getCacheStats'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching cache statistics',
                errorCode
            });
        }
    };

    return DashboardController;
};