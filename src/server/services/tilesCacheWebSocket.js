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
 * Correções aplicadas (v2):
 *   - Autenticação via query params com credenciais do super-admin do MongoDB
 *     (substitui env vars TILES_API_USERNAME/PASSWORD que estavam vazias — causa raiz do 403)
 *   - Backoff de reconexão armazenado fora do connection object (fix: delay resetava a 2s)
 *   - Circuit breaker: 403/401 interrompe reconexão (erro de autenticação, não transitório)
 *   - Max retries configurável com estado 'exhausted'
 *   - Close code 1006 tratado como possível rejeição HTTP pré-upgrade
 *   - Métodos de reconexão manual para reset do circuit breaker
 *   - Status enriquecido com info de erro, tentativas e estado do circuit breaker
 */
'use strict';

const WebSocket = require('ws');

const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_BACKOFF = 1.5;
const HEARTBEAT_INTERVAL = 30000;
const THROTTLE_INTERVAL = 500;
const MAX_RETRIES = 10;

// Close codes que indicam erro fatal (não reconectar automaticamente)
const FATAL_CLOSE_CODES = new Set([1008, 1003]);

class TilesCacheWebSocket {

    constructor(app) {
        this.app = app;
        this.io = app.io;
        this.config = app.config.tilesApi;
        this.logger = app.services.logger;

        this.baseWsUrl = this.config.baseUrl.replace(/^http/, 'ws');

        // Credenciais (query params, carregadas do MongoDB no start)
        this._authQueryParams = null;
        this._authLoaded = false;

        // Monitor global
        this.monitorWs = null;
        this.monitorReconnectTimer = null;
        this.monitorHeartbeat = null;
        this.lastMonitorEmit = 0;

        // Estado de reconexão do monitor (fora do WS object)
        this.monitorState = this._createConnectionState('monitor');

        // Conexões por campanha: { campaignId → { ws, heartbeat } }
        this.campaignConnections = {};

        // Estado de reconexão por campanha (separado do connection object)
        // { campaignId → ConnectionState }
        this.campaignStates = {};

        this._stopped = false;
    }

    /**
     * Cria estado de reconexão para uma conexão (monitor ou campanha).
     */
    _createConnectionState(label) {
        return {
            label: label,
            reconnectDelay: INITIAL_RECONNECT_DELAY,
            retryCount: 0,
            maxRetries: MAX_RETRIES,
            circuitOpen: false,       // true = parou de reconectar (erro fatal)
            circuitReason: null,      // motivo do circuit breaker
            lastError: null,
            lastCloseCode: null,
            lastAttempt: null,
            exhausted: false,         // true = atingiu max retries
        };
    }

    /**
     * Reseta o estado de reconexão (usado após conexão bem-sucedida ou reset manual).
     */
    _resetConnectionState(state) {
        state.reconnectDelay = INITIAL_RECONNECT_DELAY;
        state.retryCount = 0;
        state.circuitOpen = false;
        state.circuitReason = null;
        state.lastError = null;
        state.lastCloseCode = null;
        state.exhausted = false;
    }

    /**
     * Avalia se deve parar de reconectar com base no close code e histórico.
     * Retorna { shouldReconnect, reason }.
     */
    _evaluateReconnect(state, closeCode, errorMessage) {
        state.lastCloseCode = closeCode;
        state.lastAttempt = new Date().toISOString();

        // Circuit breaker já aberto
        if (state.circuitOpen) {
            return { shouldReconnect: false, reason: state.circuitReason };
        }

        // 403/401 = erro de autenticação → circuit breaker
        if (errorMessage && (errorMessage.includes('403') || errorMessage.includes('401'))) {
            state.circuitOpen = true;
            state.circuitReason = `Autenticação rejeitada (${errorMessage})`;
            return { shouldReconnect: false, reason: state.circuitReason };
        }

        // Close code 1006 (abnormal closure) pode ser 403 HTTP antes do upgrade WS
        // Após 3 tentativas consecutivas com 1006, tratar como provável rejeição
        if (closeCode === 1006) {
            state.retryCount++;
            if (state.retryCount >= 3) {
                state.circuitOpen = true;
                state.circuitReason = 'Conexão rejeitada repetidamente (close code 1006 — provável erro de autenticação HTTP)';
                return { shouldReconnect: false, reason: state.circuitReason };
            }
        } else {
            state.retryCount++;
        }

        // Close code fatal
        if (FATAL_CLOSE_CODES.has(closeCode)) {
            state.circuitOpen = true;
            state.circuitReason = `Close code fatal: ${closeCode}`;
            return { shouldReconnect: false, reason: state.circuitReason };
        }

        // Close intencional (1000)
        if (closeCode === 1000) {
            return { shouldReconnect: false, reason: 'Desconexão intencional (code 1000)' };
        }

        // Max retries
        if (state.retryCount > state.maxRetries) {
            state.exhausted = true;
            return { shouldReconnect: false, reason: `Limite de ${state.maxRetries} tentativas atingido` };
        }

        return { shouldReconnect: true, reason: null };
    }

    // =========================================================================
    // Autenticação (query params com credenciais do super-admin no MongoDB)
    // =========================================================================

    /**
     * Busca credenciais de um super-admin no MongoDB para autenticar no WebSocket.
     * A Tiles API (FastAPI) prioriza query params (?username=X&password=Y).
     */
    async _loadAuthFromDatabase() {
        try {
            const usersCollection = this.app.repository.collections.users;
            if (!usersCollection) {
                this._log('error', 'Collection de usuários não disponível — credenciais não carregadas');
                return false;
            }

            const user = await usersCollection.findOne({ role: 'super-admin' });
            if (!user) {
                this._log('error', 'Nenhum super-admin encontrado no MongoDB — WebSocket sem autenticação');
                return false;
            }

            const username = user.email || user.username;
            const password = user.password;

            if (!username || !password) {
                this._log('error', 'Super-admin sem username/email ou password — WebSocket sem autenticação');
                return false;
            }

            this._authQueryParams = `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
            this._authLoaded = true;
            this._log('info', `Credenciais carregadas do MongoDB (usuário: ${username})`);
            return true;
        } catch (err) {
            this._log('error', `Erro ao carregar credenciais do MongoDB: ${err.message}`);
            return false;
        }
    }

    _buildWsUrl(path) {
        return `${this.baseWsUrl}${path}${this._authQueryParams || ''}`;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async start() {
        this._stopped = false;
        this._log('info', 'Iniciando bridge WebSocket → Socket.IO');

        // Carregar credenciais do MongoDB antes de conectar
        const authOk = await this._loadAuthFromDatabase();
        if (!authOk) {
            this._log('warn', 'Bridge iniciando sem autenticação — conexões provavelmente serão rejeitadas (403)');
        }

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
            this._cleanupCampaignConnection(id, true);
        }

        // Limpar timers de reconexão de campanhas
        for (const id of Object.keys(this.campaignStates)) {
            clearTimeout(this.campaignStates[id]._reconnectTimer);
        }

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
        this._log('info', `Conectando ao monitor: ${this.baseWsUrl}${this.config.endpoints.wsMonitor} (tentativa ${this.monitorState.retryCount + 1}/${MAX_RETRIES})`);

        try {
            this.monitorWs = new WebSocket(wsUrl);
        } catch (err) {
            this._log('error', `Erro ao criar WebSocket monitor: ${err.message}`);
            this.monitorState.lastError = err.message;
            this._scheduleMonitorReconnect(null, err.message);
            return;
        }

        this.monitorWs.on('open', () => {
            this._log('info', 'Monitor WebSocket conectado');
            this._resetConnectionState(this.monitorState);
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

            if (this.io) {
                this.io.to('cache-updates').emit('cache-stats-update', {
                    source: 'websocket',
                    connected: false,
                    timestamp: new Date().toISOString(),
                });
            }

            this._scheduleMonitorReconnect(code, null);
        });

        this.monitorWs.on('error', (err) => {
            this._log('error', `Monitor WebSocket erro: ${err.message}`);
            this.monitorState.lastError = err.message;
        });

        this.monitorWs.on('pong', () => {});
    }

    _scheduleMonitorReconnect(closeCode, errorMessage) {
        if (this._stopped) return;

        const { shouldReconnect, reason } = this._evaluateReconnect(
            this.monitorState, closeCode, errorMessage || this.monitorState.lastError
        );

        if (!shouldReconnect) {
            this._log('warn', `Monitor: reconexão interrompida — ${reason}`);
            this._emitBridgeStatus();
            return;
        }

        const delay = Math.min(this.monitorState.reconnectDelay, MAX_RECONNECT_DELAY);
        this._log('info', `Reconectando monitor em ${delay}ms (tentativa ${this.monitorState.retryCount}/${MAX_RETRIES})`);

        clearTimeout(this.monitorReconnectTimer);
        this.monitorReconnectTimer = setTimeout(() => this.connectMonitor(), delay);
        this.monitorState.reconnectDelay = Math.min(
            this.monitorState.reconnectDelay * RECONNECT_BACKOFF, MAX_RECONNECT_DELAY
        );
    }

    // =========================================================================
    // Campanhas
    // =========================================================================

    subscribeCampaign(campaignId) {
        if (this._stopped) return;

        // Já conectado?
        const existing = this.campaignConnections[campaignId];
        if (existing) {
            this._log('info', `Campanha ${campaignId} já monitorada`);
            return;
        }

        // Obter ou criar estado de reconexão
        if (!this.campaignStates[campaignId]) {
            this.campaignStates[campaignId] = this._createConnectionState(`campaign:${campaignId}`);
        }
        const state = this.campaignStates[campaignId];

        // Se circuit breaker aberto, não conectar (exigir reconnect manual)
        if (state.circuitOpen) {
            this._log('warn', `Campanha ${campaignId}: circuit breaker aberto — ${state.circuitReason}. Use reconnect manual.`);
            return;
        }

        const wsPath = this.config.endpoints.wsCampaign.replace('{campaign_id}', campaignId);
        const wsUrl = this._buildWsUrl(wsPath);
        this._log('info', `Conectando à campanha ${campaignId} (tentativa ${state.retryCount + 1}/${MAX_RETRIES})`);

        let ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            this._log('error', `Erro ao criar WebSocket campanha ${campaignId}: ${err.message}`);
            state.lastError = err.message;
            this._scheduleCampaignReconnect(campaignId, null, err.message);
            return;
        }

        this.campaignConnections[campaignId] = { ws, heartbeat: null };

        ws.on('open', () => {
            this._log('info', `Campanha ${campaignId} WebSocket conectado`);
            this._resetConnectionState(state);
            this._startHeartbeat('campaign', campaignId);
        });

        ws.on('message', (raw) => {
            try {
                const data = JSON.parse(raw);
                const conn = this.campaignConnections[campaignId];
                if (!conn) return;

                const now = Date.now();
                if (!conn.lastEmit) conn.lastEmit = 0;
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

            // Limpar conexão (mas NÃO o state de reconexão)
            this._cleanupCampaignConnection(campaignId, false);

            this._scheduleCampaignReconnect(campaignId, code, null);
        });

        ws.on('error', (err) => {
            this._log('error', `Campanha ${campaignId} WebSocket erro: ${err.message}`);
            state.lastError = err.message;
        });

        ws.on('pong', () => {});
    }

    /**
     * Limpa a conexão WebSocket de uma campanha sem afetar o estado de reconexão.
     */
    _cleanupCampaignConnection(campaignId, intentional) {
        const conn = this.campaignConnections[campaignId];
        if (!conn) return;

        clearInterval(conn.heartbeat);
        if (intentional && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
            try { conn.ws.close(1000, 'unsubscribe'); } catch (_) {}
        }
        delete this.campaignConnections[campaignId];
    }

    unsubscribeCampaign(campaignId) {
        this._log('info', `Desconectando campanha ${campaignId}`);

        // Limpar timer de reconexão
        const state = this.campaignStates[campaignId];
        if (state && state._reconnectTimer) {
            clearTimeout(state._reconnectTimer);
        }

        // Limpar conexão
        this._cleanupCampaignConnection(campaignId, true);

        // Remover estado de reconexão (desinscrição total)
        delete this.campaignStates[campaignId];
    }

    _scheduleCampaignReconnect(campaignId, closeCode, errorMessage) {
        if (this._stopped) return;

        const state = this.campaignStates[campaignId];
        if (!state) return; // Foi desinscrito

        const { shouldReconnect, reason } = this._evaluateReconnect(
            state, closeCode, errorMessage || state.lastError
        );

        if (!shouldReconnect) {
            this._log('warn', `Campanha ${campaignId}: reconexão interrompida — ${reason}`);
            this._emitBridgeStatus();
            return;
        }

        const delay = Math.min(state.reconnectDelay, MAX_RECONNECT_DELAY);
        this._log('info', `Reconectando campanha ${campaignId} em ${delay}ms (tentativa ${state.retryCount}/${MAX_RETRIES})`);

        state._reconnectTimer = setTimeout(() => this.subscribeCampaign(campaignId), delay);
        state.reconnectDelay = Math.min(state.reconnectDelay * RECONNECT_BACKOFF, MAX_RECONNECT_DELAY);
    }

    // =========================================================================
    // Reconexão Manual (reset de circuit breaker)
    // =========================================================================

    /**
     * Reconecta o monitor, resetando circuit breaker e contadores.
     */
    reconnectMonitor() {
        this._log('info', 'Reconexão manual do monitor solicitada');
        clearTimeout(this.monitorReconnectTimer);
        clearInterval(this.monitorHeartbeat);
        if (this.monitorWs) {
            try { this.monitorWs.close(1000, 'manual-reconnect'); } catch (_) {}
            this.monitorWs = null;
        }
        this._resetConnectionState(this.monitorState);
        this.connectMonitor();
    }

    /**
     * Reconecta uma campanha, resetando circuit breaker e contadores.
     */
    reconnectCampaign(campaignId) {
        this._log('info', `Reconexão manual da campanha ${campaignId} solicitada`);
        this._cleanupCampaignConnection(campaignId, true);

        const state = this.campaignStates[campaignId];
        if (state) {
            clearTimeout(state._reconnectTimer);
            this._resetConnectionState(state);
        } else {
            this.campaignStates[campaignId] = this._createConnectionState(`campaign:${campaignId}`);
        }

        this.subscribeCampaign(campaignId);
    }

    /**
     * Reconecta tudo (monitor + todas as campanhas), resetando circuit breakers.
     * Recarrega credenciais do MongoDB antes de reconectar.
     */
    async reconnectAll() {
        this._log('info', 'Reconexão manual de todas as conexões solicitada — recarregando credenciais');
        await this._loadAuthFromDatabase();
        this.reconnectMonitor();
        for (const id of Object.keys(this.campaignStates)) {
            this.reconnectCampaign(id);
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

    /**
     * Emite status do bridge para o frontend via Socket.IO.
     */
    _emitBridgeStatus() {
        if (!this.io) return;
        this.io.to('cache-updates').emit('ws-bridge-status', this.getStatus());
    }

    getActiveCampaigns() {
        return Object.keys(this.campaignConnections);
    }

    getStatus() {
        const monitorConnected = this.monitorWs !== null && this.monitorWs.readyState === WebSocket.OPEN;
        return {
            monitor: {
                connected: monitorConnected,
                url: `${this.baseWsUrl}${this.config.endpoints.wsMonitor}`,
                retryCount: this.monitorState.retryCount,
                circuitOpen: this.monitorState.circuitOpen,
                circuitReason: this.monitorState.circuitReason,
                exhausted: this.monitorState.exhausted,
                lastError: this.monitorState.lastError,
                lastCloseCode: this.monitorState.lastCloseCode,
                lastAttempt: this.monitorState.lastAttempt,
            },
            campaigns: Object.keys(this.campaignStates).map(id => {
                const state = this.campaignStates[id];
                const conn = this.campaignConnections[id];
                return {
                    campaignId: id,
                    connected: conn ? (conn.ws && conn.ws.readyState === WebSocket.OPEN) : false,
                    retryCount: state.retryCount,
                    circuitOpen: state.circuitOpen,
                    circuitReason: state.circuitReason,
                    exhausted: state.exhausted,
                    lastError: state.lastError,
                    lastCloseCode: state.lastCloseCode,
                    lastAttempt: state.lastAttempt,
                };
            }),
            activeCampaigns: Object.keys(this.campaignConnections).length,
            totalSubscriptions: Object.keys(this.campaignStates).length,
            authLoaded: this._authLoaded,
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
module.exports = function(app) {
    return TilesCacheWebSocket;
};

module.exports.TilesCacheWebSocket = TilesCacheWebSocket;
