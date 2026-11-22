/**
 * 4K Stable — плагин Lampa для стабильного просмотра в 4K.
 * - Принудительное максимальное качество (2160p/1440p/1080p)
 * - Увеличенные таймауты HLS (манифест 30с, повторы 60с)
 * - Движок hls.js (кроме Tizen) для контроля уровня и буфера
 * Работает на любой сборе Lampa, без проверки origin.
 */
(function () {
  'use strict';
  if (window.fourk_plugin) return;
  window.fourk_plugin = true;

  var savedQuality = null;

  function val(name, def) {
    try {
      var v = Lampa.Storage.field(name);
      if (v === undefined || v === null || v === '' || v === 'undefined') v = Lampa.Storage.get(name);
      if (v === undefined || v === null || v === '' || v === 'undefined') v = def;
      if (v === 'true') v = true;
      if (v === 'false') v = false;
      return v;
    } catch (e) {
      return def;
    }
  }

  function forceOn() {
    return val('fourk_force', true) === true;
  }

  function stableOn() {
    return val('fourk_stable', true) === true;
  }

  function applyQuality() {
    try {
      if (forceOn()) {
        if (savedQuality === null) {
          var g = Lampa.Storage.get('video_quality_default');
          savedQuality = g && g !== 'undefined' && g !== '' ? g : '1080';
        }
        Lampa.Storage.set('video_quality_default', String(val('fourk_quality', '2160')));
      } else if (savedQuality !== null) {
        Lampa.Storage.set('video_quality_default', savedQuality);
        savedQuality = null;
      }
    } catch (e) {}
  }

  // 1. Таймауты и движок HLS: расширяем playdata перед созданием плеера
  try {
    var origPlaydata = Lampa.Player.playdata;
    Lampa.Player.playdata = function () {
      var w = origPlaydata.apply(this, arguments);
      try {
        if (w && stableOn()) {
          if ((parseInt(w.hls_manifest_timeout, 10) || 0) < 30000) w.hls_manifest_timeout = 30000;
          if ((parseInt(w.hls_retry_timeout, 10) || 0) < 60000) w.hls_retry_timeout = 60000;
          if (!w.hls_type && !Lampa.Platform.is('tizen')) w.hls_type = 'hlsjs';
        }
      } catch (e) {}
      return w;
    };
  } catch (e) {}

  // 2. Настройки плагина
  try {
    if (Lampa.SettingsApi && Lampa.SettingsApi.addComponent) {
      Lampa.SettingsApi.addComponent({
        component: 'fourk',
        icon: '<svg width="39" height="39" viewBox="0 0 39 39" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4.5" y="9.5" width="30" height="20" rx="3" stroke="#ffffff" stroke-width="2"/><text x="19.5" y="24" text-anchor="middle" font-family="Arial" font-size="10" font-weight="bold" fill="#ffffff">4K</text></svg>',
        name: '4K Stable',
      });
      var changed = function () {
        setTimeout(applyQuality, 0);
      };
      Lampa.SettingsApi.addParam({
        component: 'fourk',
        param: { name: 'fourk_quality', type: 'select', values: { '1080': '1080p', '1440': '1440p', '2160': '2160p' }, default: '2160' },
        field: { name: 'Максимальное качество', description: 'Разрешение, которое выбирается в первую очередь' },
        onChange: changed,
      });
      Lampa.SettingsApi.addParam({
        component: 'fourk',
        param: { name: 'fourk_force', type: 'trigger', default: true },
        field: { name: 'Принудительно высокое качество', description: 'Не опускаться ниже выбранного разрешения' },
        onChange: changed,
      });
      Lampa.SettingsApi.addParam({
        component: 'fourk',
        param: { name: 'fourk_stable', type: 'trigger', default: true },
        field: { name: 'Стабильный буфер HLS', description: 'Таймауты манифеста 30с / повторы 60с, движок hls.js' },
        onChange: changed,
      });
    }
  } catch (e) {}

  // 3. Регистрация в списке плагинов
  try {
    var entry = { type: 'video', version: '1.0.0', name: '4K Stable', description: 'Стабильный просмотр в 4K (2160p)' };
    var pl = Lampa.Manifest.plugins;
    if (Array.isArray(pl)) {
      if (!pl.some(function (p) { return p && p.name === '4K Stable'; })) pl.push(entry);
    } else if (pl && pl.type) Lampa.Manifest.plugins = [pl, entry];
    else Lampa.Manifest.plugins = [entry];
  } catch (e) {}

  applyQuality();
  window.fourk_apply = applyQuality;
})();
