var 
		cron = require('cron')
	,	exec = require('child_process').exec
	,	dateFormat = require('dateformat')
	,	fs = require('fs')
	,	path = require('path')
	,	async = require('async');

module.exports = function(app) {

	var config = app.config;

	var Jobs = {};

	var strDate = function() {
		return dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss ");
	}

	var writeLog = function(logStream, msg) {
		logStream.write(strDate() + msg + "\n");
	}
	
	/**
	 * Ensure log directory exists
	 */
	var ensureLogDirectory = function() {
		try {
			if (!fs.existsSync(config.logDir)) {
				fs.mkdirSync(config.logDir, { recursive: true });
				console.log('Created log directory:', config.logDir);
			}
		} catch (error) {
			console.error('Failed to create log directory:', error);
			// Try to create a fallback directory
			try {
				const fallbackDir = path.join(process.cwd(), 'logs');
				if (!fs.existsSync(fallbackDir)) {
					fs.mkdirSync(fallbackDir, { recursive: true });
					console.log('Created fallback log directory:', fallbackDir);
				}
				config.logDir = fallbackDir;
			} catch (fallbackError) {
				console.error('Failed to create fallback log directory:', fallbackError);
				// As last resort, use current directory
				config.logDir = process.cwd();
			}
		}
	}
	
	/**
	 * Create log stream safely
	 */
	var createLogStream = function(logFile) {
		try {
			ensureLogDirectory();
			return fs.createWriteStream(logFile, {'flags': 'a'});
		} catch (error) {
			console.error('Failed to create log stream for', logFile, ':', error);
			// Return a mock stream that doesn't crash the app
			return {
				write: function(data) {
					console.log('LOG:', data.trim());
				},
				end: function() {}
			};
		}
	}

	Jobs.populateCache = function(params, logStream, cacheComplete) {
		
		var requestPointCache = function(pointId, url) {
			writeLog(logStream, ' Resquest ' + url + ' for ' + pointId._id)
		}

		var pointCacheCompĺete = function(pointId) {
			writeLog(logStream, pointId + ' images cached.')
		}

		app.controllers.image.populateCache(requestPointCache, pointCacheCompĺete, cacheComplete);
	}

	/**
	 * Job para processar cache de imagens de forma inteligente
	 */
	Jobs.smartCacheProcessor = function(params, logStream, callback) {
		writeLog(logStream, 'Iniciando processamento inteligente de cache...');
		
		var pointsCollection = app.repository.collections.points;
		var campaignCollection = app.repository.collections.campaign;
		var cacheConfigCollection = app.repository.collections.cacheConfig;
		var request = require('request');
		
		// Função para emitir eventos via socket
		var emitCacheUpdate = function(event, data) {
			if (app.io) {
				app.io.to('cache-updates').emit(event, {
					timestamp: new Date().toISOString(),
					...data
				});
			}
		};
		
		// Buscar configurações do MongoDB
		cacheConfigCollection.findOne({ configType: 'smartCacheProcessor' }, function(err, mongoConfig) {
			if (err) {
				writeLog(logStream, 'Erro ao buscar configuração no MongoDB: ' + err.message);
				return callback(err);
			}
			
			// Se não há configuração no MongoDB, usar parâmetros passados (fallback)
			var config = mongoConfig || params;
			
			// Verificar se o job está habilitado
			if (mongoConfig && mongoConfig.isEnabled === false) {
				writeLog(logStream, 'Job desabilitado na configuração - pulando execução');
				return callback();
			}
			
			// Configurações do job
			var batchSize = config.batchSize || 5; // Pontos por batch
			var maxPointsPerRun = config.maxPointsPerRun || 50; // Limite por execução
			var simulate = config.simulate !== false; // Por padrão simula
			var continueWhileHasWork = config.continueWhileHasWork !== false; // Continuar executando enquanto houver trabalho
			
			writeLog(logStream, `Configurações: batchSize=${batchSize}, maxPointsPerRun=${maxPointsPerRun}, simulate=${simulate}, continueWhileHasWork=${continueWhileHasWork}`);
		
		// Emitir evento de início do job
		emitCacheUpdate('cache-job-started', {
			simulate: simulate,
			batchSize: batchSize,
			maxPointsPerRun: maxPointsPerRun
		});
		
		// Buscar pontos não cacheados por prioridade
		var query = [
			{
				$match: {
					cached: { $ne: true }
				}
			},
			{
				$lookup: {
					from: "campaign",
					localField: "campaign",
					foreignField: "_id",
					as: "campaignInfo"
				}
			},
			{
				$unwind: "$campaignInfo"
			},
			{
				$addFields: {
					campaignPriority: {
						$ifNull: ["$campaignInfo.cachePriority", 3]
					}
				}
			},
			{
				$sort: {
					campaignPriority: 1,  // Prioridade da campanha
					index: 1              // Ordem dos pontos
				}
			},
			{
				$limit: maxPointsPerRun
			}
		];
		
		// Função para processar ciclos de cache
		var processCacheCycle = function(cycleNumber) {
			writeLog(logStream, `\n=== Iniciando ciclo ${cycleNumber} de cache ===`);
			
			pointsCollection.aggregate(query).toArray(function(err, points) {
				if (err) {
					writeLog(logStream, 'Erro ao buscar pontos: ' + err.message);
					return callback(err);
				}
				
				if (points.length === 0) {
					writeLog(logStream, 'Nenhum ponto não cacheado encontrado');
					return callback();
				}
				
				writeLog(logStream, `Encontrados ${points.length} pontos para processar`);
			
			// Emitir evento com estatísticas iniciais
			emitCacheUpdate('cache-points-found', {
				totalPoints: points.length,
				totalBatches: Math.ceil(points.length / batchSize),
				simulate: simulate
			});
			
			// Processar em batches
			var processedCount = 0;
			var errorCount = 0;
			
			var processBatch = function(batchPoints, next) {
				writeLog(logStream, `Processando batch de ${batchPoints.length} pontos...`);
				
				var batchPromises = batchPoints.map(function(point) {
					return new Promise(async function(resolve) {
						try {
							var campaign = point.campaignInfo;
							var imagesProcessed = 0;
							
							// Processar todas as imagens do ponto
							for (var year = campaign.initialYear; year <= campaign.finalYear; year++) {
								for (var period of ['DRY', 'WET']) {
									if (simulate) {
										writeLog(logStream, `[SIMULAÇÃO] ${point._id} - Landsat ${year} ${period}`);
										await sleep(50); // Simular processamento
									} else {
										try {
											await simulateLeafletRequest(point, period, year, campaign, logStream);
											writeLog(logStream, `[REAL] Cacheado ${point._id} - Landsat ${year} ${period}`);
										} catch (error) {
											writeLog(logStream, `[ERRO] ${point._id} - Landsat ${year} ${period}: ${error.message}`);
										}
									}
									imagesProcessed++;
								}
							}
							
							// Marcar ponto como cacheado se não for simulação
							if (!simulate) {
								pointsCollection.updateOne(
									{ _id: point._id },
									{ 
										$set: { 
											cached: true, 
											cachedAt: new Date(),
											cachedBy: 'job'
										} 
									},
									function(err) {
										if (err) {
											writeLog(logStream, `Erro ao marcar ponto ${point._id} como cacheado: ${err.message}`);
										}
									}
								);
							}
							
							processedCount++;
							writeLog(logStream, `Ponto ${point._id} processado (${imagesProcessed} imagens)`);
							resolve();
							
						} catch (error) {
							errorCount++;
							writeLog(logStream, `Erro no ponto ${point._id}: ${error.message}`);
							resolve();
						}
					});
				});
				
				Promise.all(batchPromises).then(function() {
					// Emitir progresso após cada batch
					emitCacheUpdate('cache-batch-completed', {
						batchNumber: currentBatch + 1,
						totalBatches: batches.length,
						processedCount: processedCount,
						errorCount: errorCount,
						totalPoints: points.length,
						progress: Math.round((processedCount / points.length) * 100)
					});
					
					setTimeout(next, 2000); // Pausa entre batches
				});
			};
			
			// Dividir pontos em batches
			var batches = [];
			for (var i = 0; i < points.length; i += batchSize) {
				batches.push(points.slice(i, i + batchSize));
			}
			
			// Processar todos os batches sequencialmente
			var currentBatch = 0;
			var processNextBatch = function() {
				if (currentBatch >= batches.length) {
					writeLog(logStream, `Processamento concluído: ${processedCount} sucessos, ${errorCount} erros`);
					
					// Emitir evento de conclusão do ciclo
					emitCacheUpdate('cache-job-completed', {
						totalProcessed: processedCount,
						totalErrors: errorCount,
						totalPoints: points.length,
						simulate: simulate,
						finalProgress: 100
					});
					
					// Verificar se deve continuar processando
					if (continueWhileHasWork) {
						writeLog(logStream, `\nCiclo ${cycleNumber} concluído. Verificando se há mais trabalho...`);
						
						// Aguardar um pouco antes de verificar novamente
						setTimeout(function() {
							// Verificar se ainda há pontos não cacheados
							pointsCollection.findOne({ cached: { $ne: true } }, function(err, hasMore) {
								if (err) {
									writeLog(logStream, 'Erro ao verificar pontos restantes: ' + err.message);
									return callback(err);
								}
								
								if (hasMore) {
									writeLog(logStream, 'Ainda há pontos para processar. Iniciando próximo ciclo...');
									processCacheCycle(cycleNumber + 1);
								} else {
									writeLog(logStream, 'Todos os pontos foram processados!');
									return callback();
								}
							});
						}, 5000); // Aguardar 5 segundos entre ciclos
					} else {
						return callback();
					}
				}
				
				processBatch(batches[currentBatch], function() {
					currentBatch++;
					processNextBatch();
				});
			};
			
			processNextBatch();
		});
		
		// Funções auxiliares dentro do escopo do job
		
		function sleep(ms) {
			return new Promise(resolve => setTimeout(resolve, ms));
		}
		
		async function simulateLeafletRequest(point, period, year, campaign, logStream) {
			// Configurações otimizadas - apenas zoom 13
			var subdomains = ['1', '2', '3', '4', '5'];
			var targetZoom = 13; // Usar apenas zoom 13 conforme solicitado
			
			// Visparam padrão ou da campaign
			var visparam = campaign.visparam || 'landsat-tvi-false';
			
			var requests = [];
			var subdomainIndex = Math.floor(Math.random() * subdomains.length); // Iniciar com subdomain aleatório
			
			// Obter tiles ao redor do ponto apenas para zoom 13
			var tiles = getTilesAroundPoint(point.lat, point.lon, targetZoom, 1); // 1x1 ao redor do ponto
			
			// Emitir evento de início do processamento do ponto
			emitCacheUpdate('cache-point-processing', {
				pointId: point._id,
				campaign: campaign._id,
				period: period,
				year: year,
				totalTiles: tiles.length
			});
			
			var processedTiles = 0;
			var errorTiles = 0;
			
			for (let tile of tiles) {
				// Distribuir entre subdomains de forma circular
				var subdomain = subdomains[subdomainIndex % subdomains.length];
				subdomainIndex++;
				
				// URL seguindo padrão do Landsat
				var tileUrl = `https://tm${subdomain}.lapig.iesa.ufg.br/api/layers/landsat/${tile.x}/${tile.y}/${targetZoom}` +
							 `?period=${period}` +
							 `&year=${year}` +
							 `&visparam=${visparam}`;
				
				requests.push(
					new Promise((resolve) => {
						request({
							url: tileUrl,
							method: 'GET',
							timeout: 30000,
							headers: {
								'User-Agent': 'TVI-CacheManager/1.0'
							}
						}, (error, response) => {
							if (error) {
								errorTiles++;
								writeLog(logStream, `[ERRO] ${tileUrl}: ${error.message}`);
								emitCacheUpdate('cache-tile-error', {
									pointId: point._id,
									url: tileUrl,
									error: error.message
								});
							} else {
								processedTiles++;
								writeLog(logStream, `[OK] ${tileUrl} - Status: ${response.statusCode}`);
								emitCacheUpdate('cache-tile-success', {
									pointId: point._id,
									url: tileUrl,
									status: response.statusCode
								});
							}
							resolve();
						});
					})
				);
			}
			
			// Executar todas as requisições em paralelo com limite
			var batchSize = 20; // Aumentar batch size já que estamos usando apenas zoom 13
			for (let i = 0; i < requests.length; i += batchSize) {
				var batch = requests.slice(i, i + batchSize);
				await Promise.all(batch);
				
				// Pequena pausa entre batches para não sobrecarregar
				if (i + batchSize < requests.length) {
					await sleep(200); // Reduzir tempo de espera
				}
			}
			
			// Emitir evento de conclusão do ponto
			emitCacheUpdate('cache-point-completed', {
				pointId: point._id,
				campaign: campaign._id,
				period: period,
				year: year,
				processedTiles: processedTiles,
				errorTiles: errorTiles,
				totalTiles: tiles.length
			});
			
			writeLog(logStream, `Concluído: ${point._id} - ${period}/${year} - ${processedTiles}/${tiles.length} tiles (Zoom 13)`);
		}
		
		function getTilesAroundPoint(lat, lon, zoom, radius = 1) {
			var tiles = [];
			var centerTile = latLonToTile(lat, lon, zoom);
			
			for (let dx = -radius; dx <= radius; dx++) {
				for (let dy = -radius; dy <= radius; dy++) {
					tiles.push({
						x: centerTile.x + dx,
						y: centerTile.y + dy,
						z: zoom
					});
				}
			}
			
			return tiles;
		}
		
		function latLonToTile(lat, lon, zoom) {
			var x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
			var y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
			
			return { x: x, y: y };
		}
		}; // Fecha processCacheCycle
		
		// Iniciar primeiro ciclo
		processCacheCycle(1);
		
		}); // Fecha a função cacheConfigCollection.findOne
	}

	/**
	 * Job para limpar logs antigos do MongoDB
	 */
	Jobs.logsCleaner = function(params, logStream, callback) {
		writeLog(logStream, 'Iniciando limpeza de logs...');
		
		var logsCollection = app.repository.collections.logs;
		var logsConfigCollection = app.repository.collections.logsConfig;
		
		// Se não existir a coleção logsConfig, criar
		if (!logsConfigCollection) {
			logsConfigCollection = app.repository.db.collection('logsConfig');
			app.repository.collections.logsConfig = logsConfigCollection;
		}
		
		// Função para emitir eventos via socket
		var emitLogsUpdate = function(event, data) {
			if (app.io) {
				app.io.to('logs-updates').emit(event, {
					timestamp: new Date().toISOString(),
					...data
				});
			}
		};
		
		// Buscar configurações do MongoDB
		logsConfigCollection.findOne({ configType: 'logsCleaner' }, function(err, mongoConfig) {
			if (err) {
				writeLog(logStream, 'Erro ao buscar configuração no MongoDB: ' + err.message);
				return callback(err);
			}
			
			// Se não há configuração no MongoDB, usar parâmetros passados ou padrões
			var config = mongoConfig || params || {
				daysToKeep: 30,        // Manter logs dos últimos 30 dias
				keepErrors: true,      // Sempre manter logs de erro
				batchSize: 1000,       // Deletar em lotes de 1000
				simulate: false        // Por padrão, executar de verdade
			};
			
			// Verificar se o job está habilitado
			if (mongoConfig && mongoConfig.isEnabled === false) {
				writeLog(logStream, 'Job desabilitado na configuração - pulando execução');
				return callback();
			}
			
			// Configurações do job
			var daysToKeep = config.daysToKeep || 30;
			var keepErrors = config.keepErrors !== false;
			var batchSize = config.batchSize || 1000;
			var simulate = config.simulate || false;
			
			writeLog(logStream, `Configuração: Manter logs dos últimos ${daysToKeep} dias, ${keepErrors ? 'preservar erros' : 'incluir erros'}, lotes de ${batchSize}, modo: ${simulate ? 'SIMULAÇÃO' : 'REAL'}`);
			
			// Calcular data de corte
			var cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
			
			writeLog(logStream, `Data de corte: ${cutoffDate.toISOString()}`);
			
			// Construir query de busca
			var deleteQuery = {
				timestamp: { $lt: cutoffDate }
			};
			
			if (keepErrors) {
				// Excluir logs de erro da limpeza
				deleteQuery.level = { $ne: 'error' };
			}
			
			// Primeiro, contar quantos logs serão removidos
			logsCollection.count(deleteQuery, function(err, totalToDelete) {
				if (err) {
					writeLog(logStream, 'Erro ao contar logs para remoção: ' + err.message);
					return callback(err);
				}
				
				writeLog(logStream, `Total de logs a remover: ${totalToDelete}`);
				
				// Emitir evento de início
				emitLogsUpdate('logs-cleanup-started', {
					totalToDelete: totalToDelete,
					cutoffDate: cutoffDate,
					keepErrors: keepErrors,
					simulate: simulate
				});
				
				if (totalToDelete === 0) {
					writeLog(logStream, 'Nenhum log para remover');
					emitLogsUpdate('logs-cleanup-completed', {
						deletedCount: 0,
						simulate: simulate
					});
					return callback();
				}
				
				if (simulate) {
					// Modo simulação - apenas reportar o que seria feito
					writeLog(logStream, `[SIMULAÇÃO] ${totalToDelete} logs seriam removidos`);
					
					// Buscar alguns exemplos de logs que seriam removidos
					logsCollection.find(deleteQuery)
						.limit(10)
						.toArray(function(err, sampleLogs) {
							if (err) {
								writeLog(logStream, 'Erro ao buscar amostras: ' + err.message);
							} else {
								writeLog(logStream, 'Exemplos de logs que seriam removidos:');
								sampleLogs.forEach(function(log) {
									writeLog(logStream, `  - ${log.timestamp} | ${log.level} | ${log.message}`);
								});
							}
							
							emitLogsUpdate('logs-cleanup-completed', {
								deletedCount: 0,
								wouldDelete: totalToDelete,
								simulate: true
							});
							
							return callback();
						});
				} else {
					// Modo real - executar remoção em lotes
					var totalDeleted = 0;
					var errors = 0;
					
					var processBatch = function() {
						logsCollection.find(deleteQuery)
							.limit(batchSize)
							.toArray(function(err, logsToDelete) {
								if (err) {
									writeLog(logStream, 'Erro ao buscar lote para remoção: ' + err.message);
									errors++;
									return processNextBatch();
								}
								
								if (logsToDelete.length === 0) {
									// Não há mais logs para deletar
									writeLog(logStream, `Limpeza concluída. Total removido: ${totalDeleted}`);
									
									emitLogsUpdate('logs-cleanup-completed', {
										deletedCount: totalDeleted,
										errors: errors,
										simulate: false
									});
									
									return callback();
								}
								
								// Extrair IDs para deletar
								var idsToDelete = logsToDelete.map(function(log) {
									return log._id;
								});
								
								// Deletar o lote
								logsCollection.deleteMany(
									{ _id: { $in: idsToDelete } },
									function(err, result) {
										if (err) {
											writeLog(logStream, 'Erro ao deletar lote: ' + err.message);
											errors++;
										} else {
											var deletedInBatch = result.deletedCount || 0;
											totalDeleted += deletedInBatch;
											writeLog(logStream, `Lote processado: ${deletedInBatch} logs removidos (Total: ${totalDeleted}/${totalToDelete})`);
											
											// Emitir progresso
											emitLogsUpdate('logs-cleanup-progress', {
												deletedInBatch: deletedInBatch,
												totalDeleted: totalDeleted,
												totalToDelete: totalToDelete,
												progress: (totalDeleted / totalToDelete) * 100
											});
										}
										
										// Processar próximo lote após pequena pausa
										setTimeout(processNextBatch, 100);
									}
								);
							});
					};
					
					var processNextBatch = function() {
						if (totalDeleted < totalToDelete) {
							processBatch();
						} else {
							writeLog(logStream, `Limpeza concluída. Total removido: ${totalDeleted}`);
							
							emitLogsUpdate('logs-cleanup-completed', {
								deletedCount: totalDeleted,
								errors: errors,
								simulate: false
							});
							
							return callback();
						}
					};
					
					// Iniciar processamento
					processBatch();
				}
			});
		});
	}

	Jobs.publishLayers = function(params, logStream, callback) {
		
		var onEach = function(key, next) {
			var cmd = params.cmd + " " + key.file + " " +config.currentCampaign + " " + key.startYear + " " + params.keys.length;
			// Command executed
			exec(cmd, function (error, stdout, stderr) {
				  
				  if(error || stderr) {
				  	writeLog(logStream, error);
				  	writeLog(logStream, stderr);
				  }

				  if(stdout) {
				  	var lines = stdout.split("\n");
				  	
				  	lines.forEach(function(line) {
				  		if(line) {
				  			writeLog(logStream, line);
				  		}
				  	});
				  }
					
					next();
				});
		}

		async.eachSeries(params.keys, onEach, callback)

	}
	
	Jobs.start = function() {
		// Ensure log directory exists at startup
		ensureLogDirectory();
		
		config.jobs.toRun.forEach(function(job) {
			var logFile = config.logDir + "/" + job.name + ".log";

			new cron.CronJob(job.cron, function() {
				var logStream = createLogStream(logFile);
				var startLogMsg = "Job " + job.name + " start.";
				
				// Job started
				writeLog(logStream, startLogMsg);

				Jobs[job.name](job.params,logStream, function() {

					var endLogMsg = "Job " + job.name + " end.";
					// Job ended
					writeLog(logStream, endLogMsg);
					
					logStream.end();
					
				});

			}, null, true, config.jobs.timezone, null, job.runOnAppStart);
		});
	}

	return Jobs;
	
}; 