require('dotenv').config();
const cluster = require('cluster');
const os = require('os');

const totalCPUs = os.cpus().length;

/**
 * Calcula número de workers baseado em percentual de CPUs
 * Default: 10% dos CPUs disponíveis
 * Máximo: 80% dos CPUs
 * Garante mínimo 2 e número par
 */
function getWorkerCount() {
    if (process.env.NODE_ENV === 'dev') {
        return 2;
    }

    const cpuPercent = parseFloat(process.env.CPU_PERCENT) || 0.1;
    const maxCPUs = Math.floor(totalCPUs * 0.8); // Limite de 80%
    
    let numCPUs = Math.floor(totalCPUs * cpuPercent);
    numCPUs = Math.min(numCPUs, maxCPUs); // Nunca passa de 80%

    // Garante mínimo 2 e número par
    return Math.max(2, numCPUs % 2 === 0 ? numCPUs : numCPUs + 1);
}

if (totalCPUs > 1 && cluster.isMaster) {
    const clusterWorkerSize = getWorkerCount();
    
    console.log(`Total CPUs: ${totalCPUs}, Workers: ${clusterWorkerSize} (${Math.round((clusterWorkerSize/totalCPUs)*100)}%)`);

    for (let i = 0; i < clusterWorkerSize; i++) {
        const ENV_VAR = i === 0 ? { PRIMARY_WORKER: 1 } : {};
        cluster.fork(ENV_VAR);
    }

    cluster.on('exit', (worker) => {
        console.log(`${process.env.APP_NAME} Worker ${worker.id} has exited.`);
    });
} else {
    require('./app.js');
}