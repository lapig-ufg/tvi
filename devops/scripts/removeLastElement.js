use admin

use tvi
var cursor = db.getCollection('points').find({ $where: "this.userName.length == 4" })

while(cursor.hasNext()) {
	
	var doc = cursor.next();
	var campaign = doc._id;
	var userName = doc.userName.slice(0, -1);;
	var landUse = doc.landUse.slice(0, -1);;
	var counter = doc.counter.slice(0, -1);;
	var certaintyIndex = doc.certaintyIndex.slice(0, -1);

	db.getCollection('points').update({_id: campaign}, {$set:{"userName": userName, "landUse": landUse, "certaintyIndex": certaintyIndex, "counter": counter}})	

}