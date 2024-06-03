const ejs = require('ejs');
const fs = require('fs')
const axios = require("axios");

module.exports = function(app) {
	
	const planet = {};
	const getNext = async (url) => {
		try {
			const response = await axios.get(url);
			return response.data.mosaics;
		} catch (error) {
			console.error("Error fetching next page: ", error);
			throw error;
		}
	};

	const getPlanetBasemaps = async () => {
		let images = [];
		const apiKey = process.env.PLANET_PUBLIC_API_KEY || "";

		try {
			const response = await axios.get(`https://api.planet.com/basemaps/v1/mosaics?api_key=${apiKey}`, { timeout: 60000 });
			const mosaics = response.data.mosaics;

			if (response.data._links && response.data._links._next) {
				const nextMosaics = await getNext(response.data._links._next);
				for (const mosaic of nextMosaics) {
					if (!mosaic.name.includes("hancock") && !mosaic.name.includes("global_quarterly")) {
						mosaics.push(mosaic);
					}
				}
			}
			images = mosaics;
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
}