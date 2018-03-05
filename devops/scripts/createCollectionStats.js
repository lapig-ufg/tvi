var campaigns = db.getCollection('points').distinct('campaign',{})

for(var count=0; count<campaigns.length; count++) {
    var campaign = campaigns[count]
    var userName = db.getCollection('points').distinct('userName',{'campaign': campaign})

    for(var i=0; i<userName.length; i++) {
        
        db.getCollection('status').save({
            "_id": userName[i]+"_"+campaign,
            "campaign": campaign,
            "status": "Offline",
            "name": userName[i]
        })
    }
}