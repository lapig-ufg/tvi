

module.exports = function(app){
	var Dashboard = {}

	var pointsCollection = app.repository.collections.points;
	var campanha = "campanha_2000";

	
	Dashboard.inspection = function(request, response){

		var campaign = request.param('campaign')
		
		pointsCollection.count({"landUse": { "$eq": [] }, "campaign": campaign}, function(err, notinspect){
				pointsCollection.count({ "landUse": { "$gt": [] }, "campaign": campaign}, function(err, inspect){
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