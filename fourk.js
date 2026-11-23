/**
 * ══════════════════════════════════════════════════════════════════════════════
 * Плагин «Онлайн 4K Ultra HD» для Lampa (lampa.mx, bylampa.online и др.)
 * ══════════════════════════════════════════════════════════════════════════════
 * Версия: 2.2.0 (Универсальная сборка для GitHub / Local / Smart TV)
 *
 * Возможности:
 * 1. Бесплатный просмотр фильмов и сериалов в 4K UHD (2160p) и 2K (1440p) онлайн.
 *    (ТОРРЕНТЫ И TORRSERVER НЕ ТРЕБУЮТСЯ).
 * 2. Полная интеграция с карточкой фильма Lampa:
 *    - Заменяет стандартное открытие трейлеров при нажатии кнопки «Смотреть» на запуск 4K!
 *    - Добавляет видимую золотую кнопку «4K» рядом с основной кнопкой воспроизведения.
 *    - Регистрируется в нативном контейнере источников Lampa (buttons--container).
 *    - Добавляет пункт «Онлайн 4K Ultra HD» в меню дополнительных действий (...).
 * 3. Поддержка парсинга как чистого JSON, так и HTML data-json ответов балансеров.
 * 4. Автоматическое определение максимального разрешения (2160p / 1440p / 1080p).
 * 5. Расширенный буфер HLS против буферизации тяжелых 4K-потоков.
 * 6. Меню настроек в Lampa (выбор балансера, разрешения, автозапуска).
 * 7. Чистый открытый код без обфускации и привязки к доменам.
 * ══════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (window.plugin_online_4k_ready) return;
  window.plugin_online_4k_ready = true;

  var PLUGIN_NAME = 'Онлайн 4K';
  var PLUGIN_VERSION = '2.2.0';

  /* -------------------------------------------------------------------------- */
  /*                                 НАСТРОЙКИ                                  */
  /* -------------------------------------------------------------------------- */

  var DEFAULT_SERVERS = [
    'http://88.218.62.180:9118',
    'http://lampac.sh/lite',
    'https://lampac.stream'
  ];

  function getBaseUrl() {
    var custom = Lampa.Storage.get('fourk_custom_server', '');
    if (custom && custom.trim()) {
      var s = custom.trim();
      if (!s.startsWith('http')) s = 'http://' + s;
      return s.replace(/\/+$/, '');
    }
    return DEFAULT_SERVERS[0];
  }

  function getPreferredQuality() {
    return Lampa.Storage.get('fourk_quality', '2160');
  }

  /* -------------------------------------------------------------------------- */
  /*                            СЕТЕВЫЕ ЗАПРОСЫ И ПАРСИНГ                        */
  /* -------------------------------------------------------------------------- */

  /**
   * Универсальный парсер ответов балансеров:
   * обрабатывает чистый JSON, массивы, а также HTML со встроенными data-json='...'
   */
  function parseResponseData(raw) {
    if (!raw) return [];
    if (typeof raw === 'object') {
      if (Array.isArray(raw)) return raw;
      if (raw.channels && Array.isArray(raw.channels)) return raw.channels;
      return [raw];
    }

    var str = (raw + '').trim();

    // 1. Попытка распарсить как чистый JSON
    if (str.startsWith('{') || str.startsWith('[')) {
      try {
        var parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed;
        if (parsed.channels && Array.isArray(parsed.channels)) return parsed.channels;
        return [parsed];
      } catch (e) {}
    }

    // 2. Парсинг из HTML атрибутов data-json='...'
    var items = [];
    var regex = /data-json=(['"])(.*?)\1/g;
    var match;
    while ((match = regex.exec(str)) !== null) {
      try {
        var unescaped = match[2]
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        var obj = JSON.parse(unescaped);
        items.push(obj);
      } catch (e) {}
    }

    return items;
  }

  /**
   * Выполнение сетевого запроса через Lampa.Reguest / fetch
   */
  function request(url, callback, errorCallback) {
    if (Lampa.Reguest) {
      Lampa.Reguest.native(
        url,
        function (res) {
          callback(res);
        },
        function (err) {
          if (errorCallback) errorCallback(err);
        },
        false,
        { dataType: 'text' }
      );
      return;
    }

    fetch(url)
      .then(function (res) { return res.text(); })
      .then(function (text) { callback(text); })
      .catch(function (err) { if (errorCallback) errorCallback(err); });
  }

  /* -------------------------------------------------------------------------- */
  /*                           БАЛАНСЕР 1: ALLOHA 4K                           */
  /* -------------------------------------------------------------------------- */

  function searchAlloha(movie, callback) {
    var base = getBaseUrl();
    var query = movie.title || movie.name || '';
    var year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
    var searchUrl = base + '/lite/alloha?title=' + encodeURIComponent(query);
    if (year) searchUrl += '&year=' + encodeURIComponent(year);

    request(
      searchUrl,
      function (raw) {
        var items = parseResponseData(raw);
        if (!items.length) {
          callback(null);
          return;
        }

        // Ищем точное совпадение по году или первому элементу
        var target = null;
        if (year) {
          target = items.find(function (it) { return it.year && String(it.year) === String(year); });
        }
        if (!target) target = items[0];

        // Если это ссылка на список переводов / серий
        if (target.method === 'link' && target.url) {
          request(
            target.url,
            function (subRaw) {
              var voices = parseResponseData(subRaw);
              if (voices.length) {
                callback({ type: 'alloha', voices: voices, movie: movie });
              } else {
                callback(null);
              }
            },
            function () { callback(null); }
          );
        } else if (target.stream || target.url) {
          callback({ type: 'alloha', voices: [target], movie: movie });
        } else {
          callback(null);
        }
      },
      function () { callback(null); }
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                           БАЛАНСЕР 2: FILMIX 4K                            */
  /* -------------------------------------------------------------------------- */

  function searchFilmix(movie, callback) {
    var base = getBaseUrl();
    var query = movie.title || movie.name || '';
    var year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
    var searchUrl = base + '/lite/filmix?title=' + encodeURIComponent(query);
    if (year) searchUrl += '&year=' + encodeURIComponent(year);

    request(
      searchUrl,
      function (raw) {
        var items = parseResponseData(raw);
        if (!items.length) {
          callback(null);
          return;
        }

        // Формируем список доступных качеств для Filmix
        var results = items.map(function (it) {
          var qualities = {};
          var streamUrl = it.url || it.stream || '';

          if (streamUrl.indexOf('_480.mp4') !== -1) {
            qualities['2160p'] = streamUrl.replace('_480.mp4', '_2160.mp4');
            qualities['1440p'] = streamUrl.replace('_480.mp4', '_1440.mp4');
            qualities['1080p'] = streamUrl.replace('_480.mp4', '_1080.mp4');
            qualities['720p'] = streamUrl.replace('_480.mp4', '_720.mp4');
            qualities['480p'] = streamUrl;
          } else if (it.quality) {
            qualities = it.quality;
          }

          var maxQ = '1080p';
          if (qualities['2160p'] || (it.title && it.title.indexOf('4K') !== -1)) maxQ = '2160p 4K';
          else if (qualities['1440p']) maxQ = '1440p 2K';

          return {
            title: it.title || 'Filmix',
            maxquality: maxQ,
            qualities: qualities,
            url: qualities['2160p'] || qualities['1080p'] || streamUrl
          };
        });

        callback({ type: 'filmix', voices: results, movie: movie });
      },
      function () { callback(null); }
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                         ПОДГОТОВКА ПОТОКА К ПРОСМОТРУ                      */
  /* -------------------------------------------------------------------------- */

  function resolveStream(voiceItem, callback) {
    if (voiceItem.qualities && Object.keys(voiceItem.qualities).length) {
      callback({
        url: voiceItem.qualities['2160p'] || voiceItem.qualities['1440p'] || voiceItem.qualities['1080p'] || voiceItem.url,
        qualities: voiceItem.qualities
      });
      return;
    }

    if (voiceItem.method === 'call' && voiceItem.url) {
      request(
        voiceItem.url,
        function (resRaw) {
          var parsed = parseResponseData(resRaw);
          var playData = parsed[0] || {};
          var finalUrl = playData.url || playData.stream || voiceItem.stream;
          var qualities = playData.quality || {};
          callback({ url: finalUrl, qualities: qualities, segments: playData.segments });
        },
        function () {
          callback({ url: voiceItem.stream, qualities: {} });
        }
      );
    } else {
      callback({ url: voiceItem.stream || voiceItem.url, qualities: voiceItem.quality || {} });
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                           ЗАПУСК ПЛЕЕРА LAMPA                             */
  /* -------------------------------------------------------------------------- */

  function play(streamInfo, voiceItem, movie) {
    if (!streamInfo.url) {
      Lampa.Noty.show('Онлайн 4K: Ошибка получения ссылки на поток.');
      return;
    }

    var chosenUrl = streamInfo.url;
    var pref = getPreferredQuality();

    if (streamInfo.qualities) {
      if (pref === '2160' && streamInfo.qualities['2160p']) chosenUrl = streamInfo.qualities['2160p'];
      else if (pref === '1440' && streamInfo.qualities['1440p']) chosenUrl = streamInfo.qualities['1440p'];
      else if (streamInfo.qualities['2160p']) chosenUrl = streamInfo.qualities['2160p'];
      else if (streamInfo.qualities['1080p']) chosenUrl = streamInfo.qualities['1080p'];
    }

    var playObject = {
      title: (movie.title || movie.name || '') + ' (' + (voiceItem.translate || voiceItem.title || '4K') + ')',
      url: chosenUrl,
      quality: streamInfo.qualities || {},
      timeline: {
        hash: Lampa.Utils.hash(movie.original_title || movie.title || 'movie_4k'),
        percent: 0,
        time: 0,
        duration: 0
      }
    };

    // Настройка таймаутов буфера для стабильного 4K
    if (Lampa.Storage.get('fourk_stable_hls', true)) {
      playObject.hls_manifest_timeout = 30000;
      playObject.hls_retry_timeout = 60000;
    }

    if (streamInfo.segments && streamInfo.segments.skip) {
      playObject.segments = streamInfo.segments;
    }

    Lampa.Player.play(playObject);
    Lampa.Player.playlist([playObject]);
  }

  /* -------------------------------------------------------------------------- */
  /*                        ГЛАВНАЯ ТОЧКА ВХОДА (LAUNCH)                        */
  /* -------------------------------------------------------------------------- */

  function launch(movie) {
    if (!movie) return;

    Lampa.Loading.start(function () {
      Lampa.Loading.stop();
    });

    // 1. Сначала ищем в Alloha 4K
    searchAlloha(movie, function (resAlloha) {
      if (resAlloha && resAlloha.voices && resAlloha.voices.length) {
        Lampa.Loading.stop();
        showVoiceSelector(resAlloha.voices, movie);
        return;
      }

      // 2. Если в Alloha нет, ищем в Filmix 4K
      searchFilmix(movie, function (resFilmix) {
        Lampa.Loading.stop();
        if (resFilmix && resFilmix.voices && resFilmix.voices.length) {
          showVoiceSelector(resFilmix.voices, movie);
          return;
        }

        // Если источников нет (например, не вышедший фильм из трейлеров)
        Lampa.Noty.show('Онлайн 4K: Потоки не найдены. Возможно, релиз еще не вышел в цифровой прокат.');
      });
    });
  }

  function showVoiceSelector(voices, movie) {
    // Если всего 1 голос и включен автозапуск
    if (voices.length === 1 && Lampa.Storage.get('fourk_auto_start', false)) {
      resolveStream(voices[0], function (info) {
        play(info, voices[0], movie);
      });
      return;
    }

    var items = voices.map(function (v) {
      var name = v.translate || v.title || v.voice_name || 'Основная озвучка';
      var qualityBadge = v.maxquality ? ' [' + v.maxquality + ']' : ' [4K UHD]';
      return {
        title: name + qualityBadge,
        subtitle: v.voice_name ? 'Тип: ' + v.voice_name : 'Качество: 2160p Ultra HD',
        item: v
      };
    });

    Lampa.Select.show({
      title: 'Онлайн 4K — Выбор озвучки',
      items: items,
      onSelect: function (selected) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        resolveStream(selected.item, function (info) {
          Lampa.Loading.stop();
          play(info, selected.item, movie);
        });
      },
      onBack: function () {
        Lampa.Controller.toggle('content');
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                   ИНТЕГРАЦИЯ В КАРТОЧКУ ФИЛЬМА (КНОПКИ)                    */
  /* -------------------------------------------------------------------------- */

  function attachButtons(card, movie) {
    if (!card || !card.length || !movie) return;

    // 1. Добавляем в нативный .buttons--container Lampa
    // Это гарантирует, что Lampa onGroupButtons и onWatch видят наш плагин как основной источник!
    var btnsContainer = card.find('.buttons--container');
    if (!card.find('.button--online-4k-source').length) {
      var sourceBtn = $(
        '<div class="full-start__button selector view--online button--online-4k-source" data-subtitle="Онлайн 4K Ultra HD">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 8px;">' +
            '<circle cx="12" cy="12" r="10" stroke="#ffc107" stroke-width="2"/>' +
            '<polygon points="10,8 16,12 10,16" fill="#ffc107"/>' +
          '</svg>' +
          '<span>4K Онлайн</span>' +
        '</div>'
      );

      sourceBtn.on('hover:enter', function () {
        launch(movie);
      });

      var torrentBtn = card.find('.view--torrent');
      if (torrentBtn.length) {
        torrentBtn.after(sourceBtn);
      } else if (btnsContainer.length) {
        btnsContainer.prepend(sourceBtn);
      }
    }

    // 2. Добавляем ВИДИМУЮ золотую кнопку «4K» в панель кнопок (.full-start-new__buttons)
    if (!card.find('.button--online-4k-visible').length) {
      var visibleBtn = $(
        '<div class="full-start__button selector button--online-4k-visible" title="Смотреть в 4K Ultra HD" style="cursor: pointer;">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: auto;">' +
            '<rect x="2" y="3.5" width="20" height="17" rx="3.5" stroke="#ffc107" stroke-width="2.2"/>' +
            '<text x="12" y="15.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" font-weight="900" fill="#ffc107">4K</text>' +
          '</svg>' +
          '<span>Смотреть 4K</span>' +
        '</div>'
      );

      visibleBtn.on('hover:enter', function () {
        launch(movie);
      });

      visibleBtn.on('hover:focus hover:hover', function () {
        try {
          if (Lampa.Activity.active() && Lampa.Activity.active().activity) {
            Lampa.Activity.active().activity.last = visibleBtn[0];
          }
        } catch (e) {}
      });

      var playBtn = card.find('.button--play');
      if (playBtn.length) {
        playBtn.after(visibleBtn);
      } else {
        var buttonsRow = card.find('.full-start-new__buttons, .full-start__buttons');
        if (buttonsRow.length) buttonsRow.prepend(visibleBtn);
      }
    }

    // 3. ПЕРЕХВАТЫВАЕМ нажатие на стандартную круглую кнопку «Смотреть» (.button--play)
    // Чтобы клик по «Смотреть» сразу запускал 4K онлайн, а не уходил в YouTube-трейлеры!
    var mainPlayBtn = card.find('.button--play');
    if (mainPlayBtn.length) {
      mainPlayBtn.off('hover:enter.online4k').on('hover:enter.online4k', function (e) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        launch(movie);
      });
    }
  }

  function setupFullCardHook() {
    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') {
        var card = e.body || (e.object && e.object.activity && e.object.activity.render()) || (Lampa.Activity.active() && Lampa.Activity.active().activity && Lampa.Activity.active().activity.render());
        var movie = (e.data && e.data.movie) || (e.object && e.object.card) || (Lampa.Activity.active() && Lampa.Activity.active().card);

        if (card && movie) {
          // Вызываем сразу
          attachButtons(card, movie);
          // И с задержками (на случай, если Lampa groupButtons перестроит DOM)
          setTimeout(function () { attachButtons(card, movie); }, 60);
          setTimeout(function () { attachButtons(card, movie); }, 250);
          setTimeout(function () { attachButtons(card, movie); }, 600);
        }
      } else if (e.type === 'options' && e.options) {
        var optMovie = e.card || (e.object && e.object.card) || (e.link && e.link.card);
        e.options.push({
          title: 'Онлайн 4K Ultra HD',
          icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke="#ffc107" stroke-width="2"/><text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="900" fill="#ffc107">4K</text></svg>',
          action: function () {
            if (optMovie) launch(optMovie);
          }
        });
      }
    });

    // Если карточка УЖЕ была открыта в момент добавления плагина
    try {
      if (Lampa.Activity.active() && Lampa.Activity.active().component === 'full') {
        var act = Lampa.Activity.active();
        var currentCard = act.activity.render();
        var currentMovie = act.card;
        attachButtons(currentCard, currentMovie);
      }
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*                               НАСТРОЙКИ LAMPA                              */
  /* -------------------------------------------------------------------------- */

  function setupSettings() {
    try {
      if (Lampa.SettingsApi) {
        Lampa.SettingsApi.addComponent({
          component: 'online_4k',
          name: PLUGIN_NAME,
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffc107" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="900" fill="#ffc107">4K</text></svg>'
        });

        Lampa.SettingsApi.addParam({
          component: 'online_4k',
          param: {
            name: 'fourk_quality',
            type: 'select',
            values: {
              '2160': '4K UHD (2160p)',
              '1440': '2K QHD (1440p)',
              '1080': 'Full HD (1080p)'
            },
            default: '2160'
          },
          field: {
            name: 'Приоритетное качество',
            description: 'Выбирать максимальное доступное разрешение'
          }
        });

        Lampa.SettingsApi.addParam({
          component: 'online_4k',
          param: {
            name: 'fourk_auto_start',
            type: 'trigger',
            default: false
          },
          field: {
            name: 'Автозапуск 4K',
            description: 'Запускать лучший поток сразу без диалога выбора озвучки'
          }
        });

        Lampa.SettingsApi.addParam({
          component: 'online_4k',
          param: {
            name: 'fourk_stable_hls',
            type: 'trigger',
            default: true
          },
          field: {
            name: 'Стабильный буфер 4K',
            description: 'Расширенные таймауты HLS (30с/60с) против прерываний и буферизации'
          }
        });

        Lampa.SettingsApi.addParam({
          component: 'online_4k',
          param: {
            name: 'fourk_custom_server',
            type: 'input',
            default: ''
          },
          field: {
            name: 'Пользовательский сервер Lampac',
            description: 'Оставьте пустым для встроенного публичного 4K-сервера'
          }
        });
      }
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*                            СТАРТ И ИНИЦИАЛИЗАЦИЯ                           */
  /* -------------------------------------------------------------------------- */

  function start() {
    setupFullCardHook();
    setupSettings();

    // Экспорт в глобальную область видимости
    window.plugin_online_4k_launch = launch;
    console.log(PLUGIN_NAME + ' v' + PLUGIN_VERSION + ' успешно загружен.');
  }

  if (window.appready) {
    start();
  } else if (window.Lampa && Lampa.Listener) {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') start();
    });
  } else {
    start();
  }
})();
