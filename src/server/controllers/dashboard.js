

module.exports = function(app){
	var Dashboard = {}

	var points = app.repository.collections.points;
	var campanha = "campanha_2000";

	var getNames = function(userNames){
		var names = {}

		for(var i = 0; i < userNames.length; i++){
			names[userNames[i]] = 0;
		}

		return names;

	}
	
	Dashboard.donuts = function(request, response){

		var campaign = request.param('campaign')
		
		points.count({"landUse": { "$eq": [] }, "campaign": campaign}, function(err, notinspect){
				points.count({ "landUse": { "$gt": [] }, "campaign": campaign}, function(err, inspect){
				var dashboardData = {};
				
				dashboardData['inspect'] = inspect;
				dashboardData['not_inspect'] = notinspect;
				console.log(dashboardData);
				response.send(dashboardData);
			})	
		})
		
	}

	Dashboard.horizontalBar1 = function(request, response){
		points.find({"campaign": "campanha_2008"}, {images: 0, modis: 0}).toArray(function(err, result){
			console.log(err, result)
			response.send(result)			
		})
	}
	
	return Dashboard;

}