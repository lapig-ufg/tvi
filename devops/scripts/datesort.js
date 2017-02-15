use admin

db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});


use tvi

var cursor = db.getCollection('points').find({"campaign": "campanha_2000"}).sort({'dateImport': -1});

while(cursor.hasNext()){
	
	var doc = cursor.next()
	print(doc._id);

}