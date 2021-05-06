db.getCollection('points').find({campaign: 'amazonia_samples'}).forEach( function(point) {
    print(point)
});