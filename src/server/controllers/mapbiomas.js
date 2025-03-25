const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

module.exports = function(app) {
    const mapbiomas = {};

    mapbiomas.getNested = (obj, pathArray, defaultValue) =>{
        /**
         * Percorre o objeto 'obj' seguindo as chaves em 'pathArray' (ex.: ['WMS_Capabilities', 'Capability', 'Layer', 'Layer'])
         * Se em algum momento obj for undefined ou a chave não existir, retorna 'defaultValue'.
         */
        let current = obj;
        for (let key of pathArray) {
            if (current == null || !Object.prototype.hasOwnProperty.call(current, key)) {
                return defaultValue;
            }
            current = current[key];
        }
        return current;
    }
    /**
     * 1) Endpoint para listar mosaicos (GetCapabilities)
     *
     *    GET /mapbiomas/capabilities
     */
    mapbiomas.capabilities = async (req, res) => {
        try {
            const mapbiomasUrl = process.env.MAPBIOMAS_WMS_URL;
            const mapbiomasAuth = process.env.MAPBIOMAS_AUTH_TOKEN;

            if (!mapbiomasUrl || !mapbiomasAuth) {
                return res.status(400).json({
                    error: 'As variáveis MAPBIOMAS_WMS_URL e MAPBIOMAS_AUTH_TOKEN não foram definidas.'
                });
            }

            // Monta a URL de GetCapabilities
            const url = `${mapbiomasUrl}?SERVICE=WMS&REQUEST=GetCapabilities`;

            // Faz requisição com axios (XML em formato texto)
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Basic ${mapbiomasAuth}`,
                    'User-Agent': 'Mozilla/5.0 QGIS/33415/Linux Mint 21.3'
                },
                responseType: 'text'
            });
            // Converte XML -> objeto JS
            const parser = new XMLParser();
            const jsonCapabilities = parser.parse(response.data);

            // Usando a função getNested, pegamos o array de layers
            const layers = mapbiomas.getNested(
                jsonCapabilities,
                ['WMS_Capabilities', 'Capability', 'Layer', 'Layer'],
                []
            );

            // layers é um array de objetos, cada um com "Name" e etc.
            // Precisamos montar [{ name, date }, ...]
            // Exemplo: "planet_mosaic_2024_03" -> "2024-03-01T00:00:00Z"
            const result = layers.map(layer => {
                const layerName = layer.Name; // ex.: "planet_mosaic_2024_03"

                // Quebramos por sublinhado. Ex.: ["planet", "mosaic", "2024", "03"]
                const parts = layerName ? layerName.split('_') : [];
                const year = parts[2] || '1970';
                const month = parts[3] || '01';

                // Monta a data ISO (dia "01" fixo)
                const dateIso = `${year}-${month.padStart(2, '0')}-01T23:59:59Z`;

                return {
                    name: layerName || '',
                    date: dateIso
                };
            });

            return res.json(result);

        } catch (error) {
            console.error('Erro ao obter GetCapabilities:', error);
            return res.status(500).json({
                error: 'Não foi possível obter o GetCapabilities do servidor MapBiomas.'
            });
        }
    }

    /**
     * 2) Endpoint proxy para recuperar imagem (ou outro dado) via GetMap
     *
     *    GET /mapbiomas/proxy?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=...&LAYERS=...
     *
     *    Aqui, tudo que estiver depois de /proxy? é repassado para a URL base do WMS.
     */
    mapbiomas.proxy = async (req, res) => {
        try {
            const mapbiomasUrl = process.env.MAPBIOMAS_WMS_URL;
            const mapbiomasAuth = process.env.MAPBIOMAS_AUTH_TOKEN;

            if (!mapbiomasUrl || !mapbiomasAuth) {
                return res.status(400).send({
                    error: 'As variáveis MAPBIOMAS_WMS_URL e MAPBIOMAS_AUTH_TOKEN não foram definidas.'
                });
            }

            const queryString = req.originalUrl.split('?')[1] || '';
            const decodedQueryString = decodeURIComponent(queryString);
            const url = `${mapbiomasUrl}?${decodedQueryString}`;

            const response = await axios.get(url, {
                headers: {
                    Authorization: `Basic ${mapbiomasAuth}`,
                    'User-Agent': 'Mozilla/5.0 QGIS/32804/Windows 10 Version 2009'
                },
                responseType: 'arraybuffer'
            });

            if(response.status !== 200){
                res.setHeader('Content-Type', 'application/json');
                return res.status(response.status).send({
                    error: 'Não foi possível obter a resposta via proxy do MapBiomas.'
                });
            }

            res.setHeader('Content-Type', 'image/png');

            // Retorna os bytes diretamente
            return res.send(response.data);

        } catch (error) {
            console.error('Erro no proxy do MapBiomas:', error);
            return res.status(500).send({
                error: 'Não foi possível obter a resposta via proxy do MapBiomas.'
            });
        }
    }

    return mapbiomas;
};
