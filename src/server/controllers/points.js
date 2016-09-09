module.exports = function(app) {

	var Points = {};

	Points.getCurrentPoint = function(request, response) {
		session = request.session;

		if(session.count === undefined) {
			session.count = 1;
			session.total = 100;
		}

		var data = {
			current: session.count,
			total: session.total
		}

		response.send(data);
		response.end();

	};

	Points.updatePoint = function(request, response) {
		session = request.session;

		session.count += 1;

		var data = {
			current: session.count,
			total: session.total
		}

		response.send(data);
		response.end();

	};

	return Points;

}