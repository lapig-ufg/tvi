module.exports = function(app){
	var Dashboard = {}

	var points = app.repository.collections.points;

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

		points.mapReduce(mapFunction, reduceFunction, { out: { inline : 1}, query: { 'campaign': campaign }},
			function(err, collection) {

				var coordx = [];
				var coordy = [];
				var color = []

				for(var key in collection){

					coordx.push(collection[key].value);
					coordy.push(collection[key]._id);
					color.push('rgba(222,45,38,0.8)')
				}
				
				collection = {};
				collection['coordx'] = coordx;
				collection['coordy'] = coordy;
				collection['color'] = color;

				response.send(collection);
		});

	}

	Dashboard.horizontalBar2 = function(request, response){

		var campaign = request.param('campaign')

		var mapFunction = function(){
			 var majority = {};
           
       for (var i=0; i < this.landUse.length; i++) {
           var l = this.landUse[i];
           var c = this.userName[i];
           if(majority[l] == undefined) {
               majority[l] = 0;
           }
           majority[l] += 1;
       };

       for(key in majority) {
           if (majority[key] > 1) {
               emit(key,1);
               break;
           }
       }
		}

		var reduceFunction = function(key,values){
			return Array.sum(values);
		}

		points.mapReduce(mapFunction,reduceFunction,{ out: { inline : 1},	query: { 'campaign': campaign }},
			function(err, collection) {

				var result = {
					labels: [],
					values: []
				}
				
				collection.forEach(function(c) {
					result.labels.push(c._id);
					result.values.push(c.value);
				});

				response.send(result);
		});

	}
	
	Dashboard.userInspections = function(request, response) {
		
		var counter = {};
		var cursor = points.find({ "campaign": "Mapbiomas_teste" });

		cursor.toArray(function(error, docs) {
			
			docs.forEach(function(doc) {
			    doc.userName.forEach(function(name) {        
			         
			        if(counter[name] == null) {
			            counter[name] = 0; 
			        }
			        
			        counter[name]++;
			    })
			});
		  
			var result = {
				usernames: [],
				ninspection: []
			};

			for(var user in counter) {
				result.usernames.push(user)
				result.ninspection.push(counter[user])
			}; 

		  response.send(result);
			response.end();

		})
	}

	Dashboard.pointsInspection = function(request, response) {

		request.session.user
		var cursor = points.find({"campaign" : "Mapbiomas_teste"});
		
		var result = {
			totalPoints: 0,
			noTotalPoints: 0
		};

		cursor.toArray(function(error, docs) {
			docs.forEach(function(doc) {
				if(doc.userName.length == 5) {
					result.totalPoints++;
				} else {
					result.noTotalPoints++;
				}
			})

	  response.send(result);
		response.end();

		});
	}

	return Dashboard;
}