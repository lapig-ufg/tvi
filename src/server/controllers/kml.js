var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var KML = {};

	KML.KmlGenerator = function(request, response){
		var lon = request.param('longitude');
		var lat = request.param('latitude');
		var county = request.param('county');
		
		fs.readFile('./templates/kml.ejs', 'utf8', function (err, template) {
			var content = ejs.render(template,{
		    name: county,
		    description:"this is the description",
		    coordinates: lon+","+lat
			});
			response.setHeader('Content-type', 'text/xml')
			response.setHeader('Content-disposition', 'attachment; filename=arquivo.kml');
			response.write(content);
			response.end()
		});		

	}

	return KML;

}