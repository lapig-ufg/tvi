use admin
db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes:10245792750});
//Atualizar _id

use tvi
var cursor = db.getCollection('pointsOriginal').find({})

while(cursor.hasNext()) {
	
	var doc = cursor.next();
	var campaign = doc.campaign
	var images = doc.images;
	var modis = doc.modis;
	var index = doc.index;
	var id = index+"_"+campaign;
	doc._id = id;

	print(doc._id);

	db.getCollection('pointsImg').insert({"_id":id, "images": images, "modis": modis, "index": index})

	delete doc.modis;
	for (var i in doc.images) {
		delete doc.images[i].imageBase
		delete doc.images[i].imageBaseRef
	}

	db.getCollection('points').insert(doc)

}

