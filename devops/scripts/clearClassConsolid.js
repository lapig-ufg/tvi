//RODAR PARA AS CAMPANHAS (mapbiomas_col3_etapa03, mapbiomas_col3_etapa02_2)

db.getCollection('points').find({'campaign':'mapbiomas_col3_etapa03'}).forEach(function(point) {
    var campaign = db.getCollection('campaign').findOne({_id: point.campaign})
    var initialYear = campaign.initialYear
    var finalYear = campaign.finalYear
    var numInspections = (finalYear - initialYear + 1)
    var numInspec = db.getCollection('campaign').distinct('numInspec',{'_id': point.campaign})
    
    if(point.classConsolidated.length > numInspections) {
        db.getCollection('points').update({_id: point._id}, {$set: {"classConsolidated": []}})
    }
})