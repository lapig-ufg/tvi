const https = require('https');

module.exports = function(app) {
    const sentinelCapabilities = {};

    const get = (url) => {
        return new Promise((resolve, reject) => {
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    };

    const getSentinelCapabilities = async () => {
        try {
            console.log('Fetching Sentinel capabilities from LAPIG API...');
            
            // Buscar capabilities do Sentinel através da API do LAPIG
            const response = await get('https://tiles.lapig.iesa.ufg.br/api/capabilities');
            
            console.log(`Total collections found: ${response.collections ? response.collections.length : 0}`);
            
            if (response.collections) {
                console.log('Available collections:', response.collections.map(c => c.name));
            }
            
            // Filtrar apenas coleções relacionadas ao Sentinel (S2)
            const sentinelCollections = response.collections ? response.collections.filter(collection => 
                collection.name && (
                    collection.name.toLowerCase().includes('sentinel') ||
                    collection.name.toLowerCase().includes('s2')
                )
            ) : [];
            
            console.log(`Sentinel collections found: ${sentinelCollections.length}`);
            if (sentinelCollections.length > 0) {
                console.log('Sentinel collections:', sentinelCollections.map(c => c.name));
            }
            
            return sentinelCollections;
        } catch (error) {
            console.error("Error fetching Sentinel capabilities: ", error);
            throw error;
        }
    };

    sentinelCapabilities.getCapabilities = async (request, response) => {
        try {
            console.log('Admin Sentinel Capabilities endpoint called');
            const result = await getSentinelCapabilities();
            
            // Se não encontrar coleções Sentinel, retornar array vazio com log
            if (!result || result.length === 0) {
                console.warn('No Sentinel collections found, returning empty array');
                return response.send([]);
            }
            
            console.log(`Sending ${result.length} Sentinel capabilities`);
            response.send(result);
        } catch (error) {
            console.error("Sentinel Capabilities - GET: ", error);
            response.status(500).send({ 
                error: 'Não é possível encontrar os registros das capabilities do Sentinel',
                details: error.message 
            });
        }
    };

    return sentinelCapabilities;
};