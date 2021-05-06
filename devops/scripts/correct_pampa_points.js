db.getCollection('points').find({ 'campaign': 'mapbiomas_col3_etapa01', "biome": "PAMPA" }).forEach(function(point) {
    
    newClassConsolidated = []
    point.classConsolidated.forEach(function(c) {
        if(c == 'Pastagem Cultivada')
            c = 'Pastagem Natural'
        
        newClassConsolidated.push(c)
    });

    print(point._id)
    db.getCollection('points').update({_id: point._id}, {$set: {"classConsolidated": newClassConsolidated}})
})