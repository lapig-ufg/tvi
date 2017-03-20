

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
		
		points.count({"landUse": { "$eq": [] }, "campaign": campaign}, function(err1, notinspect){
				points.count({ "landUse": { "$gt": [] }, "campaign": campaign}, function(err2, inspect){
				var dashboardData = {};
				dashboardData['inspect'] = inspect;
				dashboardData['not_inspect'] = notinspect;
				response.send(dashboardData);
			})	
		})
		
	}

	Dashboard.horizontalBar1 = function(request, response){

		var campaign = request.param('campaign')

		var mapFunction = function(){
			for(var un = 0; un < this.userName.length; un++){
				var value = 1;
				var key = this.userName[un];
				emit(key, value);
			}
		}

		var reduceFunction = function(key, value){
			return Array.sum(value);
		}

		points.mapReduce(
			mapFunction, 
			reduceFunction, 
			{ out: { inline : 1}, 
				query: { 'campaign': campaign }
			}, function(err, collection) {
				console.log(err, collection);
				response.send(collection);
		});

	}
	
	return Dashboard;

}