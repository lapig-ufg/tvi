'use strict';

function start(service, reportError, timers = { setInterval, clearInterval }) {
    let busy = false;
    let stopped = false;
    async function tick() {
        if (busy || stopped) return;
        busy = true;
        try { await service.processNext(); }
        catch (error) { reportError(error); }
        finally { busy = false; }
    }
    const timer = timers.setInterval(tick, 5000);
    if (timer.unref) timer.unref();
    tick();
    return function stop() {
        stopped = true;
        timers.clearInterval(timer);
    };
}

module.exports = { start };
