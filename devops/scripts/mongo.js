use tvi

var cursor = db.getCollection('points').find({"campaign": "campanha_2000"})

var count = 1

while(cursor.hasNext()){
	
	var doc = cursor.next()
	var lon = doc.lon
	var lat = doc.lat
	
	var lonReduced = String(lon.toFixed(5))
	lonReduced = lonReduced.substring(0, lonReduced.length - 1)

	var latReduced = String(lat.toFixed(5))
	latReduced = latReduced.substring(0, latReduced.length - 1)

	var coord = lonReduced+'_'+latReduced
	var id = doc._id
	var newdoc = {"coord": coord}
	db.getCollection('points').update({"_id":id}, { $set: newdoc })

}