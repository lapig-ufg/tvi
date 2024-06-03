const https = require('https');

module.exports = function(app) {
	const planet = {};

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

	const getNext = async (url) => {
		try {
			const response = await get(url);
			return response.mosaics;
		} catch (error) {
			console.error("Error fetching next page: ", error);
			throw error;
		}
	};

	const getPlanetBasemaps = async () => {
		let images = [];
		const apiKey = process.env.PLANET_PUBLIC_API_KEY;

		if (!apiKey) {
			throw new Error("API key for Planet is not set");
		}

		try {
			const response = await get(`https://api.planet.com/basemaps/v1/mosaics?api_key=${apiKey}`);
			let mosaics = response.mosaics;

			if (response._links && response._links._next) {
				const nextMosaics = await getNext(response._links._next);
				mosaics = mosaics.concat(nextMosaics);
			}

			images = mosaics.filter(mosaic => !mosaic.name.includes("hancock") && !mosaic.name.includes("global_quarterly"));
		} catch (error) {
			console.error("Error fetching basemaps: ", error);
			throw error;
		}

		return images;
	};

	planet.publicMosaicPlanet = async (request, response) => {
		try {
			const result = await getPlanetBasemaps();
			response.send(result);
		} catch (error) {
			console.error("Mosaics - GET: ", error);
			response.status(500).send({ error: 'Não é possível encontrar os registros dos mosaicos' });
		}
	};

	return planet;
};
