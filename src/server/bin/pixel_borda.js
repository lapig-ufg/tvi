var campaignObj = db.getCollection('campaign').find({ _id: campaign }).toArray()

var nInspections = campaignObj[0].numInspec
var initialYear = campaignObj[0].initialYear
var finalYear = campaignObj[0].finalYear

var colNames = ["id","lat","lon"]

for(var i=0; i < nInspections; i++) {
  
  colNames.push('user_' + (i+1))
  colNames.push('time_' + (i+1))

  for(var y=initialYear; y <= finalYear; y++) {
    colNames.push('class_' + y + "_" + (i+1))
    colNames.push('border_' + y + "_" + (i+1))
  }
}

for(var y=initialYear; y <= finalYear; y++) {
  colNames.push('class_' + y + "_f")
}

colNames.push('edited')

print(colNames.join(';'))

db.getCollection('points').find({ 'campaign': campaign }).forEach(function(point) {
  
  var result = [ point._id, point.lon, point.lat ]
  for(var i=0; i < nInspections; i++) {
    
    var inspection = point.inspection[i]
    
    if (point.userName[i]) {
      result.push(point.userName[i].toLowerCase())
      result.push(inspection.counter)
      
      for(var j=0; j < inspection.form.length; j++) {
        var form = inspection.form[j]
        
        for(var y=form.initialYear; y <= form.finalYear; y++) {
          result.push(form.landUse)
          result.push(form.pixelBorder)
        }
      }
    }
    
  }
  
  var consolidated = point.classConsolidated

  if (consolidated) {
    for(var i=0; i < consolidated.length; i++) {
      result.push(consolidated[i])
    }

    result.push(point.pointEdited)
  }


  print(result.join(';'))
})
