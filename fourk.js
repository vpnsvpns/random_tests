/**
 * Плагин «Онлайн 4K Ultra HD» для Lampa (lampa.mx, bylampa.online и др.)
 * Бесплатный просмотр в 4K UHD (2160p) онлайн БЕЗ торрентов и TorrServer.
 */
(function () {
  'use strict';

  if (window.plugin_online_4k_ready) return;
  window.plugin_online_4k_ready = true;

  var PLUGIN_VERSION = '2.0.0';
  var DEFAULT_SERVER = 'http://88.218.62.180:9118';

  function getStorage(key, def) {
    try {
      var v = Lampa.Storage.get(key);
      if (v === undefined || v === null || v === '' || v === 'undefined') return def;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return v;
    } catch (e) {
      return def;
    }
  }

  function getServer() {
    var s = getStorage('fourk_server_url', DEFAULT_SERVER);
    return (s || DEFAULT_SERVER).replace(/\/+$/, '');
  }

  function isForce4K() { return getStorage('fourk_force_quality', true) === true; }
  function isStableHLS() { return getStorage('fourk_stable_hls', true) === true; }
  function isAutoStart() { return getStorage('fourk_auto_start', false) === true; }
  function getTargetQuality() { return String(getStorage('fourk_target_res', '2160')); }

  function applyPlayerSettings() {
    try {
      if (isForce4K()) {
        Lampa.Storage.set('video_quality_default', getTargetQuality());
      }
    } catch (e) {}
  }

  // Расширенный буфер для стабильного 4K стриминга
  try {
    var origPlaydata = Lampa.Player.playdata;
    Lampa.Player.playdata = function () {
      var w = origPlaydata ? origPlaydata.apply(this, arguments) : {};
      try {
        if (w && isStableHLS()) {
          var mTime = parseInt(w.hls_manifest_timeout, 10) || 0;
          var rTime = parseInt(w.hls_retry_timeout, 10) || 0;
          if (mTime < 30000) w.hls_manifest_timeout = 30000;
          if (rTime < 60000) w.hls_retry_timeout = 60000;
        }
      } catch (e) {}
      return w;
    };
  } catch (e) {}

  function requestText(url) {
    return new Promise(function (resolve, reject) {
      var network = new Lampa.Reguest();
      network.timeout(25000);
      network.native(
        url,
        function (result) {
          if (typeof result === 'string') resolve(result);
          else if (result && typeof result === 'object') {
            try { resolve(JSON.stringify(result)); } catch (e) { resolve(String(result)); }
          } else resolve('');
        },
        function (xhr) {
          if (location.protocol === 'https:' && (!xhr || xhr.status === 0) && !Lampa.Platform.is('android')) {
            reject('Браузер заблокировал HTTP-запрос (Mixed Content). Запустите Lampa по адресу http://lampa.mx (без HTTPS) или разрешите небезопасный контент в настройках сайта.');
          } else {
            reject('Сервер недоступен (' + (xhr && xhr.status ? xhr.status : 'ERR') + ')');
          }
        },
        false,
        { dataType: 'text' }
      );
    });
  }

  function requestJson(url) {
    return requestText(url).then(function (text) {
      try { return JSON.parse(text); } catch (e) { throw new Error('Некорректный ответ балансера'); }
    });
  }

  function buildSearchUrl(movie) {
    var base = getServer();
    var p = [];
    p.push('id=' + encodeURIComponent(movie.id || ''));
    if (movie.imdb_id) p.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
    if (movie.kinopoisk_id) p.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));
    p.push('title=' + encodeURIComponent(movie.title || movie.name || ''));
    p.push('original_title=' + encodeURIComponent(movie.original_title || movie.original_name || ''));
    var isSerial = (movie.name || movie.number_of_seasons || movie.first_air_date) ? 1 : 0;
    p.push('serial=' + isSerial);
    p.push('year=' + encodeURIComponent(((movie.release_date || movie.first_air_date || '0000') + '').slice(0, 4)));
    p.push('source=' + encodeURIComponent(movie.source || 'tmdb'));
    return base + '/lite/alloha?' + p.join('&');
  }

  function parseDataItems(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var out = [];
    var els = box.querySelectorAll('[data-json]');
    for (var i = 0; i < els.length; i++) {
      try {
        var raw = els[i].getAttribute('data-json');
        if (!raw) continue;
        var j = JSON.parse(raw);
        j._text = (els[i].textContent || '').trim();
        j._s = els[i].getAttribute('s');
        j._e = els[i].getAttribute('e');
        out.push(j);
      } catch (e) {}
    }
    return out;
  }

  function detectQualityBadge(item) {
    var str = [item.maxquality, item.quality, item.voice_name, item.translate, item.title, item._text].filter(Boolean).join(' ').toLowerCase();
    if (str.indexOf('2160') >= 0 || str.indexOf('4k') >= 0 || str.indexOf('uhd') >= 0) return '4K UHD';
    if (str.indexOf('1440') >= 0 || str.indexOf('2k') >= 0 || str.indexOf('qhd') >= 0) return '2K QHD';
    if (str.indexOf('1080') >= 0) return '1080p';
    return '';
  }

  function formatItemTitle(item) {
    var title = item.name || item.translate || item._text || item.title || '';
    if (item._e) title = 'Серия ' + item._e + (title ? ' · ' + title : '');
    else if (item._s) title = 'Сезон ' + item._s + (title ? ' · ' + title : '');
    var badge = detectQualityBadge(item);
    if (badge) title += ' [' + (badge === '4K UHD' ? '🌟 4K UHD' : badge) + ']';
    if (item.details) title += ' · ' + item.details;
    return title.trim() || 'Источник';
  }

  function resolveStream(item) {
    if (item.method === 'play' && item.url) return Promise.resolve(extractBestStream(item));
    if (item.method === 'call' && item.url) {
      return requestJson(item.url).then(function (res) {
        if (!res || !res.url) throw new Error('Балансер не вернул видеопоток');
        return extractBestStream(res);
      });
    }
    if (item.stream) return Promise.resolve({ url: item.stream, quality: item.quality || {} });
    return Promise.reject('Неизвестный источник');
  }

  function extractBestStream(res) {
    var playUrl = res.url || '';
    var qualities = res.quality || {};
    if (isForce4K()) {
      var target = getTargetQuality() + 'p';
      if (qualities[target]) playUrl = qualities[target];
      else if (qualities['2160p']) playUrl = qualities['2160p'];
      else if (qualities['1440p'] && getTargetQuality() !== '1080') playUrl = qualities['1440p'];
    }
    if (playUrl.indexOf(' or ') !== -1) playUrl = playUrl.split(' or ')[0];
    return { url: playUrl, quality: qualities, subtitles: res.subtitles || [] };
  }

  function startPlayer(movie, chosen, resolved, playlist) {
    applyPlayerSettings();
    var title = movie.title || movie.name || '';
    var subtitle = chosen.translate || chosen.name || chosen._text || '';

    var playdata = {
      url: resolved.url,
      title: title + (subtitle ? ' — ' + subtitle : ''),
      quality: resolved.quality,
      subtitles: resolved.subtitles,
      hls_manifest_timeout: isStableHLS() ? 30000 : 10000,
      hls_retry_timeout: isStableHLS() ? 60000 : 30000
    };

    if (chosen._s) playdata.season = parseInt(chosen._s, 10);
    if (chosen._e) playdata.episode = parseInt(chosen._e, 10);

    Lampa.Loading.stop();
    Lampa.Player.play(playdata);

    if (playlist && playlist.length > 1) {
      Lampa.Player.playlist(playlist.map(function (it) {
        return {
          title: formatItemTitle(it),
          url: it.stream || it.url,
          season: it._s ? parseInt(it._s, 10) : undefined,
          episode: it._e ? parseInt(it._e, 10) : undefined
        };
      }));
    }
  }

  function pickItem(title, items) {
    return new Promise(function (resolve) {
      if (!items || !items.length) { resolve(null); return; }

      // 4K всегда на первом месте
      var sorted = items.slice().sort(function (a, b) {
        var a4k = detectQualityBadge(a) === '4K UHD' ? 1 : 0;
        var b4k = detectQualityBadge(b) === '4K UHD' ? 1 : 0;
        return b4k - a4k;
      });

      if (isAutoStart() && sorted.length > 0 && detectQualityBadge(sorted[0]) === '4K UHD') {
        resolve(sorted[0]);
        return;
      }

      var list = sorted.map(function (it, idx) {
        return { title: formatItemTitle(it), _index: idx };
      });

      Lampa.Loading.stop();
      Lampa.Select.show({
        title: title,
        items: list,
        onSelect: function (sel) { resolve(sorted[sel._index]); },
        onBack: function () { resolve(null); }
      });
    });
  }

  function walkTree(movie, url, state, depth) {
    if (depth > 6) return Promise.reject('Превышена глубина меню');

    return requestText(url).then(function (html) {
      if (!html || !html.trim()) throw new Error('Пустой ответ балансера');
      var items = parseDataItems(html);
      if (!items.length) throw new Error('Источники не найдены');

      var links = items.filter(function (x) { return x.method === 'link' && x.url; });
      var playables = items.filter(function (x) { return x.method === 'call' || x.method === 'play' || x.stream; });

      if (links.length > 0 && !playables.length) {
        var isSeasons = links.some(function (x) { return /[?&]s=\d/.test(x.url); });
        var isVoices = links.some(function (x) { return /[?&]t=\d/.test(x.url); });
        var menuTitle = isVoices ? 'Выберите озвучку (4K сверху)' : isSeasons ? 'Выберите сезон' : 'Выберите релиз';

        return pickItem(menuTitle, links).then(function (chosen) {
          if (!chosen) return;
          return walkTree(movie, chosen.url, state, depth + 1);
        });
      }

      if (playables.length > 0) {
        var isEpisodes = playables.some(function (x) { return x._e; });
        var selectTitle = isEpisodes ? 'Выберите серию' : 'Выберите дорожку (4K UHD)';

        return pickItem(selectTitle, playables).then(function (chosen) {
          if (!chosen) return;
          Lampa.Loading.start();
          return resolveStream(chosen).then(function (resolved) {
            startPlayer(movie, chosen, resolved, playables);
          });
        });
      }

      throw new Error('Подходящих видеопотоков не найдено');
    });
  }

  function launch(movie) {
    if (!movie) return;
    try { Lampa.Loading.start(); } catch (e) {}

    walkTree(movie, buildSearchUrl(movie), {}, 0).catch(function (err) {
      try { Lampa.Loading.stop(); } catch (e) {}
      var msg = (err && err.message) || String(err) || 'Ошибка загрузки';
      try { Lampa.Noty.show('4K Онлайн: ' + msg); } catch (x) {}
    });
  }

  // Добавление кнопки «Смотреть 4K» на карточку
  Lampa.Listener.follow('full', function (e) {
    if (e.type === 'complite') {
      try {
        var card = e.object.activity.render();
        var movie = e.data.movie;
        if (!card.find('.button--online-4k').length) {
          var btn = $(
            '<div class="full-start__button selector button--online-4k">' +
              '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 8px;">' +
                '<rect x="2" y="4" width="20" height="16" rx="3" stroke="#ffc107" stroke-width="2"/>' +
                '<text x="12" y="15.5" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="900" fill="#ffc107">4K</text>' +
              '</svg>' +
              '<span>Смотреть 4K</span>' +
            '</div>'
          );
          btn.on('hover:enter', function () { launch(movie); });
          var container = card.find('.full-start-new__buttons, .full-start__buttons');
          if (container.length) container.prepend(btn);
        }
      } catch (err) {}
    }
  });

  // Пункт в контекстном меню карточки
  try {
    Lampa.Manifest.plugins = {
      type: 'video',
      version: PLUGIN_VERSION,
      name: 'Онлайн 4K',
      description: 'Бесплатный просмотр 4K UHD без торрентов',
      component: 'online_4k',
      onContextMenu: function () {
        return { name: 'Смотреть в 4K UHD', description: 'Поиск 2160p онлайн' };
      },
      onContextLauch: function (movie) { launch(movie); }
    };
  } catch (e) {}

  // Настройки в интерфейсе Lampa
  try {
    if (Lampa.SettingsApi && Lampa.SettingsApi.addComponent) {
      Lampa.SettingsApi.addComponent({
        component: 'online_4k',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="3" stroke="#ffffff" stroke-width="2"/><text x="12" y="15.5" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="900" fill="#ffffff">4K</text></svg>',
        name: 'Онлайн 4K'
      });

      Lampa.SettingsApi.addParam({
        component: 'online_4k',
        param: { name: 'fourk_server_url', type: 'input', default: DEFAULT_SERVER },
        field: { name: 'Адрес сервера / балансера', description: 'Сервер для поиска 4K потоков (Lampac)' }
      });

      Lampa.SettingsApi.addParam({
        component: 'online_4k',
        param: {
          name: 'fourk_target_res',
          type: 'select',
          values: { '2160': '2160p (4K UHD)', '1440': '1440p (2K QHD)', '1080': '1080p Full HD' },
          default: '2160'
        },
        field: { name: 'Приоритетное разрешение', description: 'Выбирать данное качество при наличии в источнике' },
        onChange: applyPlayerSettings
      });

      Lampa.SettingsApi.addParam({
        component: 'online_4k',
        param: { name: 'fourk_force_quality', type: 'trigger', default: true },
        field: { name: 'Принудительно высокое качество', description: 'Фиксировать разрешение плеера Lampa на 2160p' },
        onChange: applyPlayerSettings
      });

      Lampa.SettingsApi.addParam({
        component: 'online_4k',
        param: { name: 'fourk_stable_hls', type: 'trigger', default: true },
        field: { name: 'Стабильный буфер 4K', description: 'Расширенные таймауты HLS (30с/60с) против буферизации' }
      });

      Lampa.SettingsApi.addParam({
        component: 'online_4k',
        param: { name: 'fourk_auto_start', type: 'trigger', default: false },
        field: { name: 'Автозапуск 4K', description: 'Стартовать видео сразу без показа диалога выбора' }
      });
    }
  } catch (e) {}

  applyPlayerSettings();
})();
