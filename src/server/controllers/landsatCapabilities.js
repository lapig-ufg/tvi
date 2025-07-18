const https = require('https');

module.exports = function(app) {
    const landsatCapabilities = {};

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

    const getLandsatCapabilities = async () => {
        try {
            console.log('Fetching Landsat capabilities from LAPIG API...');
            
            // Buscar capabilities do Landsat através da API do LAPIG
            const response = await get('https://tiles.lapig.iesa.ufg.br/api/capabilities');
            
            console.log(`Total collections found: ${response.collections ? response.collections.length : 0}`);
            
            if (response.collections) {
                console.log('Available collections:', response.collections.map(c => c.name));
            }
            
            // Filtrar apenas coleções relacionadas ao Landsat
            const landsatCollections = response.collections ? response.collections.filter(collection => 
                collection.name && (
                    collection.name.toLowerCase().includes('landsat') ||
                    collection.name.toLowerCase().includes('l8') ||
                    collection.name.toLowerCase().includes('l7') ||
                    collection.name.toLowerCase().includes('l5')
                )
            ) : [];
            
            console.log(`Landsat collections found: ${landsatCollections.length}`);
            if (landsatCollections.length > 0) {
                console.log('Landsat collections:', landsatCollections.map(c => c.name));
            }
            
            return landsatCollections;
        } catch (error) {
            console.error("Error fetching Landsat capabilities: ", error);
            throw error;
        }
    };

    landsatCapabilities.getCapabilities = async (request, response) => {
        try {
            console.log('Admin Landsat Capabilities endpoint called');
            const result = await getLandsatCapabilities();
            
            // Se não encontrar coleções Landsat, retornar array vazio com log
            if (!result || result.length === 0) {
                console.warn('No Landsat collections found, returning empty array');
                return response.send([]);
            }
            
            console.log(`Sending ${result.length} Landsat capabilities`);
            response.send(result);
        } catch (error) {
            console.error("Landsat Capabilities - GET: ", error);
            response.status(500).send({ 
                error: 'Não é possível encontrar os registros das capabilities do Landsat',
                details: error.message 
            });
        }
    };

    return landsatCapabilities;
};