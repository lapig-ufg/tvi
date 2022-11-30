db.getCollection('points').find({'campaign':"amazonia_peru_raisg_col2_etapa02"}).forEach(function(point) {
    var campaign = db.getCollection('campaign').findOne({_id: point.campaign})
    var numInspections = db.getCollection('campaign').distinct('numInspec',{'_id': point.campaign})
    
    if(point.inspection.length != numInspections) {
      print('Correcting ' + point._id + ' with ' + point.inspection.length + ' inspections')
      
      if(point.inspection.length > numInspections) {
        var numExceededInspection = point.inspection.length - numInspections
        print(' Removing ' + numExceededInspection + ' inspections')

        var inspection = point.inspection.slice(0, -1*numExceededInspection)
        var userName = point.userName.slice(0, -1*numExceededInspection)

        point.inspection = inspection
        point.userName = userName
      }
        
      point.underInspection = point.inspection.length
      print(' Final number of inspections ' + point.underInspection)
      db.getCollection('points').save(point)
    }
})
