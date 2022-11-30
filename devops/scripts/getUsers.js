// var users = [];
// db.points.find({campaign: 'amazonia_bolivia_raisg',  $where: "this.userName.length < 3" }).forEach(function(point){
//    var uss = []; 
//    var us = db.status.find({campaign: 'amazonia_bolivia_raisg', name: {"$nin": point.userName}}).forEach(function(user){
//        uss.push(user.name)
//    });
//    users.push({'point': point._id, 'users': uss})
   
// });

var users = [];
db.points.find({campaign: 'amazonia_bolivia_raisg',  $where: "this.userName.length < 3" }).forEach(function(point){
   var uss = []; 
   var us = db.status.find({campaign: 'amazonia_bolivia_raisg', name: {"$nin": point.userName}}).forEach(function(user){
       // uss.push(user.name)
       users.push({'point': point._id, 'user': user.name})
   });
   // users.push({'point': point._id, 'users': uss})
   
});

printjsononeline(users)