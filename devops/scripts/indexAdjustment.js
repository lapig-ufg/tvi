use tvi

var cursor = db.getCollection('points').find({"campaign": "campanha_2000" })

var count = 1

while(cursor.hasNext()){
	
	var doc = cursor.next()

	var newdoc = {"index": count}	
	var id = doc._id
	db.getCollection('points').update({"_id":id}, { $set: newdoc })
	count++;
}