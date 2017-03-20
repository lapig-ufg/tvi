
var mapFunction = function(){
	var landUseObj = {}
	for(var lu = 0; lu < this.counter.length; lu++){
		if(landUseObj[counter[i]]){
			landUseObj[counter[i]] = landUseObj[counter[i]] + 1;
		}else{
			landUseObj[counter[i]] = 1;
		}
	}
	var key = "";
	var value = 0;

	for(var lu = 0; lu < this.counter.length; lu++){
		if(landUseObj[counter[i]] > count){
			count = landUseObj[counter[i]];
			key = counter[i];
		}
	}

	emit(key, value);
}


var reduceFunction = function(key, value){
	return Array.sum(value);
}

db.getCollection('pointsOriginal').mapReduce(mapFunction, reduceFunction, { out: "map_reduce_example" });
