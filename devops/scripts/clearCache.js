// db.getCollection('points').find({campaign: 'capacitacion_peru_raisg', cached: true}).forEach( function(point) {
//     db.points.update({ _id: point._id}, { '$set': { "cached": false} }); 
// });

db.getCollection('points').find({campaign: 'amazonia_peru_raisg', cached: true, index: { $gte: 4516 }  }).forEach( function(point) {
    db.points.update({ _id: point._id}, { '$set': { "cached": false} }); 
});