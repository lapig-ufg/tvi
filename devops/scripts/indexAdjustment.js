use admin

db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});

use tvi

var cursor = db.getCollection('points').find({})

var count = 0

while(cursor.hasNext()){
	
	var doc = cursor.next()
	var newdoc = {"underInspection": doc.userName.length}	
	var id = doc._id
	print(doc._id)
	db.getCollection('points').update({"_id":id}, { $set: newdoc })
}