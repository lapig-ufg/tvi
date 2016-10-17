var http = require('http');
var ejs = require('ejs');
var fs = require('fs')


http.createServer(function (req, res) {
	res.writeHead(200, {'Content-Type': 'text/xml'});	
	fs.readFile('template.ejs', 'utf8', function (err, template) {
	var content = ejs.render(template,{
	    name:"test name",
	    description:"this is the description",
	    coordinates:"-122.0822035425683,37.42228990140251,0"
	});
		res.write(content);
		res.end()
	});
}).listen(8000);

console.log('Server listening at at http://localhost:8000/');