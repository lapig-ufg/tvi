use tvi
db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});
var cursor = db.getCollection('points').find({"campaign": "treinamentoLXO60Z"}).sort({'dateImport': 1});

var count = 0

while(cursor.hasNext()){
	
	var doc = cursor.next()

	var newdoc = {"index": count}	
	var id = doc._id
	db.getCollection('points').update({"_id":id}, { $set: newdoc })
	count++;
}