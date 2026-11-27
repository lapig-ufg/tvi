'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function capture(sources) {
    let factory;
    const images = sources.map(src => ({
        src,
        getAttribute() { return this.src; },
        setAttribute(name, value) { this.src = value; }
    }));
    const origin = 'https://tvi.lapig.iesa.ufg.br';
    const document = { body: {}, querySelectorAll: () => [] };
    const clonedDoc = { querySelectorAll: selector => selector === 'canvas' ? [] : images };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/diagnostic-capture.js'), 'utf8'), {
        Application: { service(name, fn) { factory = fn; } },
        URL, document, navigator: { userAgent: 'test' },
        window: { location: { href: origin + '/#/admin', origin }, screen: {}, open() {} },
        console: { log() {}, info() {}, warn() {}, error() {} },
        localStorage: { setItem() {} },
        html2canvas(body, options) {
            options.onclone(clonedDoc);
            return Promise.resolve({ toDataURL: () => 'data:image/jpeg;base64,test' });
        }
    });
    const service = {};
    factory.call(service);
    service.prepareAndOpenTickets();
    return images.map(image => image.src);
}

test('captura preserva imagens locais e protocolos que não podem ser consultados pelo proxy', () => {
    const sources = ['blob:https://tvi.lapig.iesa.ufg.br/image', 'data:image/png;base64,test',
        '/api/bdc/tile.png', 'https://tvi.lapig.iesa.ufg.br/api/bdc/tile.png',
        '/service/tile-proxy?url=test', 'ftp://example.org/tile.png', '', null, 'http://[invalid'];
    assert.deepEqual(capture(sources), sources);
});

test('captura encaminha somente imagens HTTP externas e não encadeia o proxy', () => {
    const sources = ['https://tiles.lapig.iesa.ufg.br/tile.png', '//tiles.lapig.iesa.ufg.br/tile.png'];
    const expected = sources.map(src => '/service/tile-proxy?url=' + encodeURIComponent(new URL(src, 'https://tvi.lapig.iesa.ufg.br').href));
    assert.deepEqual(capture(sources), expected);
    assert.deepEqual(capture(expected), expected);
});
