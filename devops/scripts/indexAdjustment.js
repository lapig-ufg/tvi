use admin

db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});

use tvi

var cursor = db.getCollection('points').find({"campaign": "campanha_2008"})

var count = 0

while(cursor.hasNext()){
	
	var doc = cursor.next()
	var newdoc = {"index": count}	
	var id = doc._id
	print(doc)
	db.getCollection('pointsOriginal').update({"_id":id}, { $set: newdoc })
	count=count+1;
	
}