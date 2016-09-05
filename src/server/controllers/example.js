module.exports = function(app) {

	var Example = {};

	Example.test = function(request, response) {
		var data = {
			title: 'Developers team',
			users: [
				{
					name: "Leandro",
					job: "Team coordinator"
				},
				{
					name: "Fernanda",
					job: "WebGIS developer"
				},
				{
					name: "Rhuan",
					job: "WebGIS developer"
				},
				{
					name: "Lana",
					job: "GIS analyst"
				},
				{
					name: "Guilherme",
					job: "GIS developer"
				},
				{
					name: "Umberto",
					job: "GIS developer"
				}
			]
		}

		response.send(data);
		response.end();
	};

	return Example;

}
