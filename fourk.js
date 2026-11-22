/**
 * 4K Stable — плагин Lampa.
 * 1. Добавляет на карточку пункт «Смотреть 4K» (ищет источники на балансере и запускает видео).
 * 2. Принудительно ставит максимальное качество (2160p) и увеличивает таймауты HLS
 *    (манифест 30с, повторы 60с) — более стабильный просмотр.
 * Работает на любой сборе Lampa, без проверок origin, без внешних зависимостей.
 */
(function () {
  'use strict';
  if (window.fourk_plugin) return;
  window.fourk_plugin = true;

  var BASE = 'http://88.218.62.180:9118';
  // на https-сборах http-запрос блокируется браузером — пробуем https-адрес балансера
  var BASES = location.protocol === 'https:'
    ? ['https://88.218.62.180:9118', 'http://88.218.62.180:9118']
    : ['http://88.218.62.180:9118'];

  /* ---------- настройки качества ---------- */
  var savedQuality = null;

  function val(name, def) {
    try {
      var v = Lampa.Storage.field(name);
      if (v === undefined || v === null || v === '' || v === 'undefined') v = Lampa.Storage.get(name);
      if (v === undefined || v === null || v === '' || v === 'undefined') v = def;
      if (v === 'true') v = true;
      if (v === 'false') v = false;
      return v;
    } catch (e) { return def; }
  }

  function forceOn() { return val('fourk_force', true) === true; }
  function stableOn() { return val('fourk_stable', true) === true; }

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

  // таймауты HLS: расширяем playdata перед созданием плеера
  try {
    var origPlaydata = Lampa.Player.playdata;
    Lampa.Player.playdata = function () {
      var w = origPlaydata.apply(this, arguments);
      try {
        if (w && stableOn()) {
          if ((parseInt(w.hls_manifest_timeout, 10) || 0) < 30000) w.hls_manifest_timeout = 30000;
          if ((parseInt(w.hls_retry_timeout, 10) || 0) < 60000) w.hls_retry_timeout = 60000;
        }
      } catch (e) {}
      return w;
    };
  } catch (e) {}

  /* ---------- поиск источников на балансере ---------- */

  function searchUrl(m) {
    var p = [];
    p.push('id=' + encodeURIComponent(m.id || ''));
    if (m.imdb_id) p.push('imdb_id=' + encodeURIComponent(m.imdb_id));
    if (m.kinopoisk_id) p.push('kinopoisk_id=' + encodeURIComponent(m.kinopoisk_id));
    p.push('title=' + encodeURIComponent(m.title || m.name || ''));
    p.push('original_title=' + encodeURIComponent(m.original_title || m.original_name || ''));
    p.push('serial=' + (m.name ? 1 : 0));
    p.push('year=' + (((m.release_date || m.first_air_date || '0000') + '').slice(0, 4)));
    p.push('source=' + (m.source || 'tmdb'));
    return BASES[0] + '/lite/alloha?' + p.join('&');
  }

  function get(url) {
    // пробуем основной адрес, при mixed-content ошибке — запасной
    return fetch(url).then(function (r) {
      if (!r.ok) throw 'Сервер недоступен (' + r.status + ')';
      return r.text();
    }).catch(function (e) {
      if (BASES.length < 2) throw e;
      var alt = BASES[1] + url.slice(BASES[0].length);
      return fetch(alt).then(function (r) {
        if (!r.ok) throw 'Сервер недоступен (' + r.status + ')';
        return r.text();
      });
    });
  }

  // ссылки внутри ответа приходят http — на https-сборах переписываем на свой адрес
  function norm(u) {
    if (BASES[0] === 'http://88.218.62.180:9118' || u.indexOf(BASES[0]) === 0) return u;
    return u.replace('http://88.218.62.180:9118', BASES[0]);
  }

  function fetchItems(url) {
    return get(url).then(function (html) {
      if (/^\s*\{/.test(html)) throw 'Источники временно недоступны';
      var box = document.createElement('div');
      box.innerHTML = html;
      var out = [], els = box.querySelectorAll('[data-json]');
      for (var i = 0; i < els.length; i++) {
        try {
          var j = JSON.parse(els[i].getAttribute('data-json'));
          j._text = (els[i].textContent || '').trim();
          j._s = els[i].getAttribute('s');
          j._e = els[i].getAttribute('e');
          out.push(j);
        } catch (e) {}
      }
      return out;
    });
  }

  function labelOf(x) {
    if (x._e) return 'Серия ' + x._e + (x.name ? ' · ' + x.name : '');
    var m = (x.url || '').match(/[?&]s=(\d+)/);
    var t = (x.name || x._text || x.title || '').trim();
    if (m && x.method === 'link' && !/[?&]t=\d/.test(x.url || '')) return 'Сезон ' + m[1];
    if (!t) t = (x.stream ? 'Видео' : 'Источник');
    if (x.details) t += ' · ' + x.details;
    return t;
  }

  function pick(title, items) {
    return new Promise(function (resolve) {
      var list = items.map(function (x, i) { return { title: labelOf(x), _i: i }; });
      var counts = {};
      list.forEach(function (l) { counts[l.title] = (counts[l.title] || 0) + 1; });
      var seen = {};
      list.forEach(function (l) {
        if (counts[l.title] > 1) {
          seen[l.title] = (seen[l.title] || 0) + 1;
          l.title += ' · ' + seen[l.title];
        }
      });
      Lampa.Loading.stop();
      if (window.fourk_auto) { resolve(items[0]); return; }
      Lampa.Select.show({
        title: title,
        items: list,
        onSelect: function (a) { resolve(items[a._i]); }
      });
    });
  }

  function play(movie, group, chosen) {
    Lampa.Loading.stop();
    var data = {
      url: norm(chosen.stream),
      title: movie.title || movie.name || '',
      hls_manifest_timeout: stableOn() ? 30000 : 10000,
      hls_retry_timeout: stableOn() ? 60000 : 30000
    };
    if (chosen._s) data.season = parseInt(chosen._s, 10);
    if (chosen._e) data.episode = parseInt(chosen._e, 10);
    Lampa.Player.play(data);
    if (group.length > 1) {
      Lampa.Player.playlist(group.map(function (x) {
        var it = { title: labelOf(x), url: norm(x.stream) };
        if (x._s) it.season = parseInt(x._s, 10);
        if (x._e) it.episode = parseInt(x._e, 10);
        return it;
      }));
    }
  }

  // state.trans = озвучка уже выбрана (чтобы не спрашивать повторно)
  function walk(movie, url, state, depth) {
    if (depth > 6) return Promise.reject('Не удалось получить видео');
    return fetchItems(url).then(function (items) {
      if (!items.length) throw 'Пустой ответ сервера';

      var links = items.filter(function (x) { return x.method === 'link' && x.url; });

      if (!state.trans) {
        var works = links.filter(function (x) { return !/[?&]s=\d/.test(x.url); });
        var seasons = links.filter(function (x) { return /[?&]s=\d/.test(x.url) && !/[?&]t=\d/.test(x.url); });
        var trans = links.filter(function (x) { return /[?&]t=\d/.test(x.url); });
        var group = works.length ? { n: 'Источник', a: works }
                  : seasons.length ? { n: 'Сезон', a: seasons }
                  : trans.length ? { n: 'Озвучка', a: trans } : null;
        if (group) {
          return pick(group.n, group.a).then(function (ch) {
            if (!ch) return;
            if (group.n === 'Озвучка') state.trans = true;
            return walk(movie, norm(ch.url), state, depth + 1);
          });
        }
      }

      var streams = items.filter(function (x) { return x.stream; });
      if (streams.length) {
        return pick('Видео', streams).then(function (v) {
          if (v) play(movie, streams, v);
        });
      }
      if (links.length) {
        return pick('Далее', links).then(function (ch) {
          if (ch) return walk(movie, norm(ch.url), state, depth + 1);
        });
      }
      throw 'Источники не найдены';
    });
  }

  function launch(movie) {
    if (!movie) return;
    try { Lampa.Loading.start(); } catch (e) {}
    walk(movie, searchUrl(movie), {}, 0).catch(function (e) {
      try { Lampa.Loading.stop(); } catch (x) {}
      try { Lampa.Noty.show('4K: ' + ((e && e.message) || e || 'Ошибка')); } catch (x) {}
    });
  }

  /* ---------- настройки плагина ---------- */
  try {
    if (Lampa.SettingsApi && Lampa.SettingsApi.addComponent) {
      var have = Lampa.SettingsApi.getParam('fourk') || [];
      if (!have.length) {
        Lampa.SettingsApi.addComponent({
          component: 'fourk',
          icon: '<svg width="39" height="39" viewBox="0 0 39 39" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4.5" y="9.5" width="30" height="20" rx="3" stroke="#ffffff" stroke-width="2"/><text x="19.5" y="24" text-anchor="middle" font-family="Arial" font-size="10" font-weight="bold" fill="#ffffff">4K</text></svg>',
          name: '4K Stable'
        });
        var changed = function () { setTimeout(applyQuality, 0); };
        Lampa.SettingsApi.addParam({
          component: 'fourk',
          param: { name: 'fourk_quality', type: 'select', values: { '1080': '1080p', '1440': '1440p', '2160': '2160p' }, default: '2160' },
          field: { name: 'Максимальное качество', description: 'Разрешение, которое выбирается в первую очередь' },
          onChange: changed
        });
        Lampa.SettingsApi.addParam({
          component: 'fourk',
          param: { name: 'fourk_force', type: 'trigger', default: true },
          field: { name: 'Принудительно высокое качество', description: 'Не опускаться ниже выбранного разрешения' },
          onChange: changed
        });
        Lampa.SettingsApi.addParam({
          component: 'fourk',
          param: { name: 'fourk_stable', type: 'trigger', default: true },
          field: { name: 'Стабильный буфер HLS', description: 'Таймауты манифеста 30с / повторы 60с' },
          onChange: changed
        });
      }
    }
  } catch (e) {}

  /* ---------- пункт «Смотреть 4K» на карточке ---------- */
  try {
    var arr = Lampa.Manifest.plugins;
    if (Array.isArray(arr)) {
      for (var i = arr.length - 1; i >= 0; i--) {
        var p = arr[i];
        if (p && (p.name === '4K Stable' || p.name === 'Смотреть 4K')) arr.splice(i, 1);
      }
    }
    Lampa.Manifest.plugins = {
      type: 'video',
      version: '1.1.0',
      name: 'Смотреть 4K',
      description: 'Источники онлайн и стабильный просмотр в 4K',
      component: 'fourk',
      onContextMenu: function () {
        return { name: 'Смотреть 4K', description: 'Источники и 2160p' };
      },
      onContextLauch: function (movie) { launch(movie); }
    };
  } catch (e) {}

  applyQuality();
  window.fourk_apply = applyQuality;
  window.fourk_launch = launch;
})();
