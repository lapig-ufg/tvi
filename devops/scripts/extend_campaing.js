db.getCollection('points').find({ "campaign": "mapa_pastagem_2000_2016" }).forEach(function(point) {
    point._id = point.index + '_mapa_pastagem_1985_2001'
    point.campaign ='mapa_pastagem_1985_2001'
    point.dateImport = new Date()
    point.userName = []
    point.inspection = []
    point.underInspection = 0
    point.cached = false
    delete point.classConsolidated
    print(point._id + " created.")
    db.getCollection('points').save(point)
})