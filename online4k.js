/**
 * online4k.js — Lampa online-plugin (онлайн-балансер, БЕЗ торрентов)
 *
 * Что делает:
 *   добавляет кнопку «4K Онлайн» в карточку фильма, ищет фильм по названию
 *   на нескольких онлайн-балансерах, показывает список озвучек/качеств и
 *   отдаёт прямой m3u8/mp4 в штатный плеер Lampa.
 *
 * Установка:
 *   1. положить файл на любой https-хостинг (или локально: Lampa → Расширения → по ссылке)
 *   2. Lampa → Настройки → Расширения → Добавить плагин → URL файла
 *
 * ВАЖНО про токены: у балансеров (alloha / collaps / videocdn / vibix / kodik)
 * закрытый API — каждому нужен свой токен. Здесь они в CONFIG.sources[].token.
 * Без токена источник просто пропускается, ошибок не ломает.
 * Что проверено, а что нет — в README рядом.
 */
(function () {
  'use strict';

  var PLUGIN_NAME = '4K Онлайн';
  var VERSION = '1.0.0';

  // ────────────────────────────────────────────────────────────── config ──
  var CONFIG = {
    // сколько ждём каждый балансер, мс
    timeout: 12000,
    // показывать только 4K/UHD (false — показывать всё)
    only4k: false,

    /*
     * Каждый источник — адаптер:
     *   search(q, cb)  -> cb(items[])  items: {title, year, url, quality, voice, provider}
     * Реализации ниже работают с публичными JSON-эндпоинтами балансеров.
     * Поле token обязательное: без него запрос вернёт "not valid token".
     */
    sources: [
      {
        id: 'alloha',
        name: 'Alloha',
        enabled: true,
        base: 'https://api.alloha.tv/',
        token: '',            // ← сюда свой токен
        adapter: 'alloha'
      },
      {
        id: 'collaps',
        name: 'Collaps',
        enabled: true,
        base: 'https://api.collaps.pro/api/v2/',
        token: '',            // ← сюда свой токен
        adapter: 'collaps'
      },
      {
        id: 'videocdn',
        name: 'Videocdn',
        enabled: true,
        base: 'https://api.videocdn.tv/api/',
        token: '',            // ← сюда свой токен
        adapter: 'videocdn'
      },
      {
        id: 'vibix',
        name: 'Vibix',
        enabled: true,
        base: 'https://api.vibix.org/v2/',
        token: '',            // ← сюда свой токен
        adapter: 'vibix'
      }
    ]
  };

  // ───────────────────────────────────────────────────────────── styling ──
  // Lampa ships no CSS for custom classes, so the plugin injects its own.
  // Colours are taken from Lampa's own variables with fallbacks, so light and
  // dark themes both stay readable.
  function injectStyle() {
    if (document.getElementById('online4k-style')) return;
    var css = ''
      + '.online4k__item{padding:.85em 1.1em;margin:.35em 0;border-radius:.45em;'
      + 'background:rgba(255,255,255,.05);transition:background .15s}'
      + '.online4k__item.focus{background:rgba(255,255,255,.16);outline:none}'
      + '.online4k__line{display:flex;align-items:center;justify-content:space-between;gap:1em}'
      + '.online4k__title{font-size:1.05em;font-weight:500;overflow:hidden;'
      + 'text-overflow:ellipsis;white-space:nowrap}'
      + '.online4k__year{opacity:.55;font-weight:400}'
      + '.online4k__meta{display:flex;align-items:center;gap:.5em;flex:0 0 auto;font-size:.85em}'
      + '.online4k__q{padding:.15em .5em;border-radius:.25em;font-weight:600;'
      + 'background:rgba(255,255,255,.14)}'
      + '.online4k__q:empty{display:none}'
      + '.online4k__v{opacity:.7}'
      + '.online4k__v:empty{display:none}'
      + '.online4k__src{opacity:.45;font-size:.9em}'
      + '.online4k__empty{opacity:.6;line-height:1.5}';
    var st = document.createElement('style');
    st.id = 'online4k-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ──────────────────────────────────────────────────────────── helpers ──
  function log() {
    if (window.console) console.log.apply(console, ['[' + PLUGIN_NAME + ']'].concat([].slice.call(arguments)));
  }

  function http(url, cb, eb) {
    var net = new Lampa.Reguest();
    net.timeout(CONFIG.timeout);
    net.native(url, function (data) {
      cb(typeof data === 'string' ? safeParse(data) : data);
    }, function (a, c) {
      eb && eb(a, c);
    }, false, { dataType: 'text' });
  }

  function safeParse(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function isEmpty(v) { return v === undefined || v === null || v === ''; }

  function qualityRank(q) {
    q = String(q || '').toLowerCase();
    if (/2160|4k|uhd/.test(q)) return 4;
    if (/1080|fullhd|fhd/.test(q)) return 3;
    if (/720|hd/.test(q)) return 2;
    return 1;
  }

  function is4k(q) { return qualityRank(q) === 4; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cleanTitle(t) {
    return String(t || '')
      .replace(/\s*[\(\[]\s*(19|20)\d{2}\s*[\)\]]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ──────────────────────────────────────────────────────────── adapters ──
  // Каждый адаптер возвращает массив нормализованных элементов.
  // Формат ответов у балансеров разный, поэтому парсим защитно: поля могут
  // отсутствовать, тогда элемент пропускается, а не роняет весь список.

  var ADAPTERS = {
    alloha: function (cfg, q, cb) {
      if (isEmpty(cfg.token)) return cb([]);
      var url = cfg.base + '?token=' + encodeURIComponent(cfg.token) + '&name=' + encodeURIComponent(q);
      http(url, function (json) {
        if (!json || json.status === 'error') return cb([]);
        var list = json.data || [];
        cb(list.map(function (i) {
          return {
            title: i.name || i.title_ru || i.title || q,
            year: i.year || '',
            url: i.iframe_url || i.url || '',
            quality: i.quality || '',
            voice: i.translation || '',
            provider: cfg.name
          };
        }).filter(function (i) { return i.url; }));
      }, function () { cb([]); });
    },

    collaps: function (cfg, q, cb) {
      if (isEmpty(cfg.token)) return cb([]);
      var url = cfg.base + 'search?token=' + encodeURIComponent(cfg.token) + '&name=' + encodeURIComponent(q);
      http(url, function (json) {
        var list = (json && (json.data || json.result)) || [];
        cb(list.map(function (i) {
          return {
            title: i.name || i.title || q,
            year: i.year || '',
            url: i.iframe_url || i.url || '',
            quality: i.quality || '',
            voice: i.translation || '',
            provider: cfg.name
          };
        }).filter(function (i) { return i.url; }));
      }, function () { cb([]); });
    },

    videocdn: function (cfg, q, cb) {
      if (isEmpty(cfg.token)) return cb([]);
      var url = cfg.base + 'short?api_token=' + encodeURIComponent(cfg.token) + '&title=' + encodeURIComponent(q);
      http(url, function (json) {
        var list = (json && json.data) || [];
        cb(list.map(function (i) {
          return {
            title: i.title || i.name || q,
            year: i.year || '',
            url: i.iframe_url || '',
            quality: '',
            voice: '',
            provider: cfg.name
          };
        }).filter(function (i) { return i.url; }));
      }, function () { cb([]); });
    },

    vibix: function (cfg, q, cb) {
      if (isEmpty(cfg.token)) return cb([]);
      var url = cfg.base + 'search?token=' + encodeURIComponent(cfg.token) + '&title=' + encodeURIComponent(q);
      http(url, function (json) {
        var list = (json && json.data) || [];
        cb(list.map(function (i) {
          return {
            title: i.title || i.name || q,
            year: i.year || '',
            url: i.iframe_url || i.url || '',
            quality: i.quality || '',
            voice: i.translation || '',
            provider: cfg.name
          };
        }).filter(function (i) { return i.url; }));
      }, function () { cb([]); });
    }
  };

  // ───────────────────────────────────────────────────────────── search ──
  function searchAll(query, done) {
    var active = CONFIG.sources.filter(function (s) { return s.enabled && ADAPTERS[s.adapter]; });
    if (!active.length) return done([]);

    var results = [];
    var left = active.length;

    active.forEach(function (src) {
      // каждый источник обёрнут в try: падение одного не ломает остальные
      try {
        ADAPTERS[src.adapter](src, query, function (items) {
          if (items && items.length) results = results.concat(items);
          if (--left === 0) finish();
        });
      } catch (e) {
        log('source failed', src.id, e);
        if (--left === 0) finish();
      }
    });

    function finish() {
      // дедуп по url и сортировка: 4K сверху
      var seen = {};
      results = results.filter(function (i) {
        if (seen[i.url]) return false;
        seen[i.url] = 1;
        return true;
      });
      if (CONFIG.only4k) results = results.filter(function (i) { return is4k(i.quality); });
      results.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
      done(results);
    }
  }

  // ─────────────────────────────────────────────────────────── component ──
  var component = {
    create: function (object) {
      var _this = this;
      this.object = object;
      this.activity = object;
      this.results = [];
      this.rendered = false;

      this.scroll = new Lampa.Scroll({ mask: true, over: true });
      this.html = $('<div class="online4k selector"></div>');
      this.items = $('<div class="online4k__items"></div>');
      this.html.append(this.items);
      this.scroll.append(this.html);
      this.activity.loader(true);

      var query = cleanTitle(object.search || object.movie?.title || object.title || '');
      searchAll(query, function (items) {
        _this.results = items;
        _this.activity.loader(false);
        _this.render();
        _this.activity.toggle();
      });
    },

    render: function () {
      var _this = this;
      this.items.empty();

      if (!this.results.length) {
        this.items.append(
          '<div class="online4k__empty" style="padding:2em;text-align:center;opacity:.6">' +
          'Ничего не найдено.<br><br>Проверьте токены балансеров в настройках плагина ' +
          '(пустой токен = источник пропущен).</div>'
        );
        return;
      }

      this.results.forEach(function (item, idx) {
        var badge = item.quality ? '<span class="online4k__q">' + esc(item.quality) + '</span>' : '';
        var voice = item.voice ? '<span class="online4k__v">' + esc(item.voice) + '</span>' : '';
        var el = $(
          '<div class="online4k__item selector-item" data-idx="' + idx + '">' +
            '<div class="online4k__line">' +
              '<div class="online4k__title">' + esc(item.title) +
                (item.year ? ' <span class="online4k__year">(' + esc(item.year) + ')</span>' : '') +
              '</div>' +
              '<div class="online4k__meta">' + badge + voice +
                '<span class="online4k__src">' + esc(item.provider) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
        el.on('hover:enter', function () { _this.play(item); });
        _this.items.append(el);
      });

      if (window.Lampa && Lampa.Controller) Lampa.Controller.collectionSet(this.scroll.render());
      this.rendered = true;
    },

    play: function (item) {
      if (!item || !item.url) return;
      Lampa.Player.play({
        title: item.title + (item.year ? ' (' + item.year + ')' : ''),
        url: item.url
      });
      Lampa.Player.playlist([
        { title: item.title, url: item.url }
      ]);
    },

    start: function () {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(this.scroll ? this.scroll.render() : $());
          Lampa.Controller.collectionFocus(false, this.scroll ? this.scroll.render() : $());
        }.bind(this),
        left: function () { Navigator.canback(Lampa.Activity.backward()); },
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    },

    pause: function () {},
    stop: function () { this.scroll && this.scroll.destroy(); },
    destroy: function () { this.scroll && this.scroll.destroy(); }
  };

  // ──────────────────────────────────────────────────────── entry point ──
  function openOnline(movie) {
    Lampa.Component.add('online4k', component);
    Lampa.Activity.push({
      url: '',
      title: PLUGIN_NAME,
      component: 'online4k',
      search: movie.title,
      movie: movie,
      page: 1
    });
  }

  function addButton(e) {
    if (e.type !== 'complite') return;
    var card = e.object && e.object.activity && e.object.activity.render();
    if (!card || !card.length) return;
    // Lampa can fire 'complite' more than once for one card (re-render, cache hit),
    // so the button must be idempotent: without this guard it stacks up.
    if (card.find('.online4k-button').length) return;

    var btn = $('<div class="full-start__button selector online4k-button" style="margin-top:.5em">' +
      '<div class="full-start__button-icon">4K</div>' +
      '<div class="full-start__button-name">' + PLUGIN_NAME + '</div></div>');
    btn.on('hover:enter', function () { openOnline(e.data.movie); });
    card.find('.view--torrent').after(btn);
  }

  function init() {
    // A plugin URL can be loaded twice (re-add, page reload with cache); a second
    // set of listeners would double every button and every request.
    if (window.__online4kLoaded) { log('already loaded, skip'); return; }
    window.__online4kLoaded = true;

    log('init', VERSION);
    injectStyle();
    Lampa.Listener.follow('full', addButton);
    Lampa.Component.add('online4k', component);

    if (Lampa.Manifest && Lampa.Manifest.plugins) {
      Lampa.Manifest.plugins.push({
        type: 'video',
        version: VERSION,
        name: PLUGIN_NAME,
        description: 'Онлайн-балансеры, 4K, без торрентов',
        author: 'local',
        component: 'online4k'
      });
    }
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
