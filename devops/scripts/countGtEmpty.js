use admin

db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});


use tvi

//var cursor = db.getCollection('points').find({ landUse: { $gt: [] } }).count()
var cursor = db.getCollection('points').find(
	{ 
		"campaign": "campanha_2000",
		$where: "this.userName.length < 3"
	}
)

print(cursor);


use tvi

db.getCollection('points').find(
	{ 
		"campaign": "campanha_2000",
		$where: "this.userName.length < 3",
    "underInspection": 3
	}
)

while(cursor.hasNext()){
	
	var doc = cursor.next()

	var newdoc = {"index": count}	
	var id = doc._id
	db.getCollection('points').update({"_id":id}, { $set: newdoc })
	
}