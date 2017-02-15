

module.exports = function(app){
	var Dashboard = {}

	var pointsCollection = app.repository.collections.points;
	var campanha = "campanha_2000";

	
	Dashboard.inspection = function(request, response){
		/*
		pointsCollection.count({ "landUse": { $eq: [] } }, {"campaign": "treinamentoLXO60Z"}, function(count){
			pointsCollection.count({ "landUse": { $gt: [] } }, {"campaign": "treinamentoLXO60Z"}, function(count2){
				console.log(count, count2)
			})	
		})
		*/
		
		pointsCollection.count({"landUse": { "$eq": [] }, "campaign": "treinamentoLXO60Z"}, function(err, notinspect){
				pointsCollection.count({ "landUse": { "$gt": [] }, "campaign": "treinamentoLXO60Z"}, function(inspect){
				var dashboardData = {};
				dashboardData['inspect'] = inspect;
				dashboardData['not_inspect'] = notinspect;
				console.log(dashboardData);
				response.send(dashboardData);
			})	
		})
		
	}
	
	return Dashboard;

}