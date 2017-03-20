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

db.getCollection('points').mapReduce(mapFunction, mapReduce, { out: "map_reduce_example" });