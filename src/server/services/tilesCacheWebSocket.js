/**
 * Bridge WebSocket (Tiles API) → Socket.IO (Frontend AngularJS)
 *
 * Conecta aos WebSockets nativos da API de tiles (FastAPI) e retransmite
 * os dados em tempo real via Socket.IO para o frontend do TVI.
 *
 * WebSockets consumidos:
 *   - ws://{TILES_API}/api/cache/ws/monitor    → evento 'cache-stats-update'
 *   - ws://{TILES_API}/api/cache/ws/campaign/{id} → evento 'campaign-progress'
 *
 * Correções aplicadas:
 *   - Backoff de reconexão independente por tipo de conexão
 *   - Double-checked delete em campaignConnections (race condition)
 *   - Heartbeat ping/pong para detecção de conexões stale
 *   - Notificação de desconexão para o frontend
 */
'use strict';

const WebSocket = require('ws');

const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_BACKOFF = 1.5;
const HEARTBEAT_INTERVAL = 30000;  // 30s entre pings
const THROTTLE_INTERVAL = 500;     // Mínimo 500ms entre emissões

class TilesCacheWebSocket {

    constructor(app) {
        this.app = app;
        this.io = app.io;
        this.config = app.config.tilesApi;
        this.logger = app.services.logger;

        // Derivar URL base WS a partir da URL HTTP
        this.baseWsUrl = this.config.baseUrl.replace(/^http/, 'ws');

        // Credenciais para autenticação nos WebSockets (mesmas da API)
        this.wsAuthParams = this._buildAuthParams();

        // Monitor global
        this.monitorWs = null;
        this.monitorReconnectTimer = null;
        this.monitorReconnectDelay = INITIAL_RECONNECT_DELAY;
        this.monitorHeartbeat = null;
        this.lastMonitorEmit = 0;

        // Conexões por campanha: { campaignId → ConnectionState }
        // ConnectionState: { ws, reconnectTimer, heartbeat, lastEmit, reconnectDelay, unsubscribing }
        this.campaignConnections = {};

        this._stopped = false;
    }

    // =========================================================================
    // Autenticação
    // =========================================================================

    _buildAuthParams() {
        const username = process.env.TILES_API_USERNAME || '';
        const password = process.env.TILES_API_PASSWORD || '';
        if (username && password) {
            return `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        }
        return '';
    }

    _buildWsUrl(path) {
        return `${this.baseWsUrl}${path}${this.wsAuthParams}`;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    start() {
        this._stopped = false;
        this._log('info', 'Iniciando bridge WebSocket → Socket.IO');
        this.connectMonitor();
    }

    stop() {
        this._stopped = true;
        this._log('info', 'Parando bridge WebSocket → Socket.IO');

        // Monitor
        clearTimeout(this.monitorReconnectTimer);
        clearInterval(this.monitorHeartbeat);
        if (this.monitorWs) {
            try { this.monitorWs.close(1000, 'shutdown'); } catch (_) {}
            this.monitorWs = null;
        }

        // Campanhas
        for (const id of Object.keys(this.campaignConnections)) {
            this.unsubscribeCampaign(id);
        }

        // Notificar frontend que bridge foi desconectado
        if (this.io) {
            this.io.to('cache-updates').emit('cache-stats-update', {
                source: 'websocket',
                connected: false,
                timestamp: new Date().toISOString(),
            });
        }
    }

    // =========================================================================
    // Monitor Global
    // =========================================================================

    connectMonitor() {
        if (this._stopped) return;

        const wsUrl = this._buildWsUrl(this.config.endpoints.wsMonitor);
        this._log('info', `Conectando ao monitor: ${this.baseWsUrl}${this.config.endpoints.wsMonitor}`);

        try {
            this.monitorWs = new WebSocket(wsUrl);
        } catch (err) {
            this._log('error', `Erro ao criar WebSocket monitor: ${err.message}`);
            this._scheduleMonitorReconnect();
            return;
        }

        this.monitorWs.on('open', () => {
            this._log('info', 'Monitor WebSocket conectado');
            this.monitorReconnectDelay = INITIAL_RECONNECT_DELAY;
            this._startHeartbeat('monitor');
        });

        this.monitorWs.on('message', (raw) => {
            try {
                const data = JSON.parse(raw);

                const now = Date.now();
                if (now - this.lastMonitorEmit < THROTTLE_INTERVAL) return;
                this.lastMonitorEmit = now;

                if (this.io) {
                    this.io.to('cache-updates').emit('cache-stats-update', {
                        timestamp: data.timestamp,
                        source: 'websocket',
                        connected: true,
                        tile_keys: data.tile_keys,
                        meta_keys: data.meta_keys,
                        lock_keys: data.lock_keys,
                        total_keys: data.total_keys,
                        delta_tiles: data.delta_tiles,
                        tiles_per_sec: data.tiles_per_sec,
                        redis_memory: data.redis_memory,
                        redis_memory_bytes: data.redis_memory_bytes,
                        celery_queue_standard: data.celery_queue_standard,
                        celery_queue_high: data.celery_queue_high,
                        s3_connected: data.s3_connected,
                        local_cache_size: data.local_cache_size,
                        pod: data.pod,
                    });
                }
            } catch (err) {
                this._log('error', `Erro ao processar mensagem do monitor: ${err.message}`);
            }
        });

        this.monitorWs.on('close', (code) => {
            this._log('warn', `Monitor WebSocket desconectado (code=${code})`);
            clearInterval(this.monitorHeartbeat);
            this.monitorWs = null;

            // Notificar frontend
            if (this.io) {
                this.io.to('cache-updates').emit('cache-stats-update', {
                    source: 'websocket',
                    connected: false,
                    timestamp: new Date().toISOString(),
                });
            }

            this._scheduleMonitorReconnect();
        });

        this.monitorWs.on('error', (err) => {
            this._log('error', `Monitor WebSocket erro: ${err.message}`);
        });

        this.monitorWs.on('pong', () => {
            // Heartbeat respondido — conexão viva
        });
    }

    _scheduleMonitorReconnect() {
        if (this._stopped) return;

        const delay = Math.min(this.monitorReconnectDelay, MAX_RECONNECT_DELAY);
        this._log('info', `Reconectando monitor em ${delay}ms`);

        clearTimeout(this.monitorReconnectTimer);
        this.monitorReconnectTimer = setTimeout(() => this.connectMonitor(), delay);
        this.monitorReconnectDelay = Math.min(this.monitorReconnectDelay * RECONNECT_BACKOFF, MAX_RECONNECT_DELAY);
    }

    // =========================================================================
    // Campanhas
    // =========================================================================

    subscribeCampaign(campaignId) {
        if (this._stopped) return;

        // Já conectado?
        const existing = this.campaignConnections[campaignId];
        if (existing && !existing.unsubscribing) {
            this._log('info', `Campanha ${campaignId} já monitorada`);
            return;
        }

        const wsPath = this.config.endpoints.wsCampaign.replace('{campaign_id}', campaignId);
        const wsUrl = this._buildWsUrl(wsPath);
        this._log('info', `Conectando à campanha ${campaignId}`);

        let ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            this._log('error', `Erro ao criar WebSocket campanha ${campaignId}: ${err.message}`);
            this._scheduleCampaignReconnect(campaignId);
            return;
        }

        const conn = {
            ws,
            reconnectTimer: null,
            heartbeat: null,
            lastEmit: 0,
            reconnectDelay: INITIAL_RECONNECT_DELAY,
            unsubscribing: false,
        };
        this.campaignConnections[campaignId] = conn;

        ws.on('open', () => {
            this._log('info', `Campanha ${campaignId} WebSocket conectado`);
            conn.reconnectDelay = INITIAL_RECONNECT_DELAY;
            this._startHeartbeat('campaign', campaignId);
        });

        ws.on('message', (raw) => {
            try {
                const data = JSON.parse(raw);

                const now = Date.now();
                if (now - conn.lastEmit < THROTTLE_INTERVAL) return;
                conn.lastEmit = now;

                if (this.io) {
                    this.io.to('cache-updates').emit('campaign-progress', {
                        timestamp: data.timestamp,
                        source: 'websocket',
                        campaign_id: data.campaign_id,
                        campaign_name: data.campaign_name,
                        caching_status: data.caching_status,
                        image_type: data.image_type,
                        years: data.years,
                        total_points: data.total_points,
                        cached_points: data.cached_points,
                        pending_points: data.pending_points,
                        cache_percentage: data.cache_percentage,
                        delta_cached: data.delta_cached,
                        points_per_sec: data.points_per_sec,
                        redis_total_keys: data.redis_total_keys,
                        redis_memory: data.redis_memory,
                        celery_queue_standard: data.celery_queue_standard,
                        celery_queue_high: data.celery_queue_high,
                        pod: data.pod,
                    });

                    if (data.cache_percentage >= 100 && data.caching_status === 'completed') {
                        this.io.to('cache-updates').emit('task-completed', {
                            taskId: `campaign-${campaignId}`,
                            campaignId: campaignId,
                            timestamp: data.timestamp,
                        });
                        this.unsubscribeCampaign(campaignId);
                    }
                }
            } catch (err) {
                this._log('error', `Erro ao processar campanha ${campaignId}: ${err.message}`);
            }
        });

        ws.on('close', (code) => {
            this._log('warn', `Campanha ${campaignId} WebSocket desconectado (code=${code})`);
            clearInterval(conn.heartbeat);

            // Evitar reconexão se foi desinscrição voluntária
            const wasUnsubscribing = conn.unsubscribing;
            // Limpar a entrada ANTES de reconectar (evita double-delete)
            delete this.campaignConnections[campaignId];

            if (!wasUnsubscribing && code !== 1000) {
                this._scheduleCampaignReconnect(campaignId);
            }
        });

        ws.on('error', (err) => {
            this._log('error', `Campanha ${campaignId} WebSocket erro: ${err.message}`);
        });

        ws.on('pong', () => {
            // Heartbeat respondido
        });
    }

    unsubscribeCampaign(campaignId) {
        const conn = this.campaignConnections[campaignId];
        if (!conn) return;

        this._log('info', `Desconectando campanha ${campaignId}`);
        conn.unsubscribing = true;  // Flag para evitar reconexão no close handler
        clearTimeout(conn.reconnectTimer);
        clearInterval(conn.heartbeat);

        if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
            try { conn.ws.close(1000, 'unsubscribe'); } catch (_) {}
        }
        delete this.campaignConnections[campaignId];
    }

    _scheduleCampaignReconnect(campaignId) {
        if (this._stopped) return;

        // Recuperar delay do estado anterior se existir, senão usar padrão
        const prevConn = this.campaignConnections[campaignId];
        const currentDelay = prevConn ? prevConn.reconnectDelay : INITIAL_RECONNECT_DELAY;
        const delay = Math.min(currentDelay, MAX_RECONNECT_DELAY);

        this._log('info', `Reconectando campanha ${campaignId} em ${delay}ms`);

        const timer = setTimeout(() => this.subscribeCampaign(campaignId), delay);

        // Guardar timer em estado temporário para cleanup
        if (this.campaignConnections[campaignId]) {
            this.campaignConnections[campaignId].reconnectTimer = timer;
            this.campaignConnections[campaignId].reconnectDelay = Math.min(
                currentDelay * RECONNECT_BACKOFF, MAX_RECONNECT_DELAY
            );
        }
    }

    // =========================================================================
    // Heartbeat
    // =========================================================================

    _startHeartbeat(type, campaignId) {
        const interval = setInterval(() => {
            let ws;
            if (type === 'monitor') {
                ws = this.monitorWs;
            } else {
                const conn = this.campaignConnections[campaignId];
                ws = conn ? conn.ws : null;
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.ping();
            } else {
                clearInterval(interval);
            }
        }, HEARTBEAT_INTERVAL);

        if (type === 'monitor') {
            clearInterval(this.monitorHeartbeat);
            this.monitorHeartbeat = interval;
        } else {
            const conn = this.campaignConnections[campaignId];
            if (conn) {
                clearInterval(conn.heartbeat);
                conn.heartbeat = interval;
            }
        }
    }

    // =========================================================================
    // Status & Util
    // =========================================================================

    getActiveCampaigns() {
        return Object.keys(this.campaignConnections);
    }

    getStatus() {
        return {
            monitor: {
                connected: this.monitorWs !== null && this.monitorWs.readyState === WebSocket.OPEN,
                url: `${this.baseWsUrl}${this.config.endpoints.wsMonitor}`,
            },
            campaigns: Object.entries(this.campaignConnections).map(([id, conn]) => ({
                campaignId: id,
                connected: conn.ws && conn.ws.readyState === WebSocket.OPEN,
            })),
            activeCampaigns: Object.keys(this.campaignConnections).length,
            stopped: this._stopped,
        };
    }

    _log(level, message) {
        const prefix = '[TilesCacheWS]';
        if (this.logger) {
            this.logger[level](`${prefix} ${message}`, {
                module: 'tilesCacheWebSocket',
            });
        } else {
            console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${message}`);
        }
    }
}

// Factory function para compatibilidade com express-load
// (express-load chama mod.call(app) em todos os arquivos em services/)
// A inicialização real acontece em app.js após Socket.IO estar pronto.
module.exports = function(app) {
    // Não inicializar aqui — retornar a classe para uso posterior
    return TilesCacheWebSocket;
};

// Exportar classe diretamente para require manual
module.exports.TilesCacheWebSocket = TilesCacheWebSocket;