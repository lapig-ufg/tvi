use admin

db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});


use tvi

//var cursor = db.getCollection('points').find({ landUse: { $gt: [] } }).count()
var cursor = db.getCollection('points').find(
	{ 
		"landUse": { "$eq": [] },
		"campaign": "treinamentoLXO60Z"
	}
).count()

print(cursor);