require('dotenv').config();
const cluster = require('cluster');
let clusterSize = require('os').cpus().length;

if (cluster.isMaster) {
  if (process.env.NODE_ENV === 'dev') {
    clusterSize = 2
  }

  for (let i=0; i < clusterSize; i++) {
    let ENV_VAR = {}
    if (i == 0) {
      ENV_VAR = { 'PRIMARY_WORKER': 1 }
    }
    cluster.fork(ENV_VAR);
  }

  cluster.on("exit", function(worker) {
    console.log(process.env.APP_NAME, worker.id, "has exited.")
  })
} else {
  require('./app.js');
}
