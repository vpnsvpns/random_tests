/**
 * online4k.js — Lampa online-plugin. Без торрентов, без токенов, без регистрации.
 *
 * Работает через открытый шлюз z01 (тот же, что использует z01.online):
 *   GET http://s{1,2,3}.z01.online/lite/withsearch      -> список источников
 *   GET http://s1.z01.online/lite/<source>?title=<q>    -> HTML со списком
 *   GET http://wtch.ch/lite/fxapi?postid=<id>           -> прямой mp4 (filmix)
 *   GET http://s1.z01.online/lite/hdvb?kinopoisk_id=<id>-> HLS master (hdvb)
 *
 * Проверено 26.11.2026: 4 источника из 34 отдают данные без токена —
 * filmix, hdvb, veoveo, kodik. Остальные 30 отвечают 403 "disable".
 * Потолок качества на этом шлюзе — 1080p (см. README).
 */
(function () {
  'use strict';

  var PLUGIN_NAME = '4K Онлайн';
  var VERSION = '2.0.0';

  var CONFIG = {
    // шлюзы, проверяются по порядку; первый ответивший используется
    gateways: ['http://s1.z01.online', 'http://s2.z01.online', 'http://s3.z01.online'],
    // источник для прямых mp4 (самый быстрый при старте)
    filmixResolver: 'http://wtch.ch/lite/fxapi',
    // какие источники опрашивать.
    // Проверено 26.11.2026: veoveo отдаёт ссылки, но их CDN (rstprgapipt.com)
    // не отвечает — в плеере чёрный экран. Поэтому он выключен, а не удалён:
    // включи, если их CDN оживёт.
    sources: ['hdvb', 'filmix'],
    timeout: 15000,
    // true — оставить только 2160p/4K
    only4k: false
  };

  var state = {
    gateway: null,
    cache: {}
  };

  // ───────────────────────────────────────────────────────────── утилиты ──
  function log() {
    if (window.console) console.log.apply(console, ['[' + PLUGIN_NAME + ']'].concat([].slice.call(arguments)));
  }

  function req(url, cb, eb, opts) {
    var net = new Lampa.Reguest();
    net.timeout(CONFIG.timeout);
    net.native(url, function (data) {
      cb(typeof data === 'string' ? data : (data ? String(data) : ''));
    }, function (a, c) {
      eb && eb(a, c);
    }, false, opts || { dataType: 'text' });
  }

  function unesc(s) {
    return String(s == null ? '' : s)
      .replace(/\\u0026/g, '&')
      .replace(/\\u003d/g, '=')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/&amp;/g, '&');
  }

  function decodeRu(s) {
    // в HTML заголовки приходят как %d0%9c... или \u041c
    return unesc(String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) {
      return String.fromCharCode(parseInt(h, 16));
    }));
  }

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ');
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function rank(q) {
    q = norm(q);
    if (/2160|4k|uhd/.test(q)) return 4;
    if (/1080|fullhd|fhd/.test(q)) return 3;
    if (/720|\bhd\b/.test(q)) return 2;
    return 1;
  }

  function is4k(q) { return rank(q) === 4; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cleanQuery(t) {
    return String(t || '')
      .replace(/\s*[\(\[]\s*(19|20)\d{2}\s*[\)\]]\s*/g, ' ')
      .replace(/\s*[\(\[]\s*(4k|uhd|1080p|720p)\s*[\)\]]\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ─────────────────────────────────────────────── разбор ответов шлюза ──
  // Все ответы — HTML с data-json='{...}'. Парсим его как JSON, а не regexp'ом
  // по всему тексту: там бывают вложенные кавычки.
  function parseItems(html) {
    var out = [];
    var re = /data-json='([^']+)'/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var raw = unesc(m[1]);
      var j;
      try { j = JSON.parse(raw); } catch (e) { continue; }

      var item = {
        title: decodeRu(j.title || j.name || ''),
        translate: decodeRu(j.translate || j.details || ''),
        year: j.year || '',
        quality: '',
        url: '',
        method: j.method || '',
        provider: '',
        raw: j
      };

      // filmix: method=play, quality = {"720p": "url", "480p": "url"}
      // hdvb/veoveo: method=call/play, отдельное поле stream, quality нет
      if (j.quality && typeof j.quality === 'object') {
        var best = '', bestRank = 0;
        for (var k in j.quality) {
          var r = rank(k);
          if (r > bestRank && j.quality[k]) { bestRank = r; best = k; }
        }
        item.quality = best;
        item.allQualities = j.quality;
        item.url = best ? (j.quality[best] || '') : (j.url || '');
      } else {
        item.url = j.url || '';
        if (j.maxquality) item.quality = j.maxquality;
        // у veoveo качество лежит в translate ("1080p")
        if (!item.quality && /^\d{3,4}p$/i.test(item.translate)) item.quality = item.translate;
      }

      if (j.stream) item.stream = unesc(j.stream);
      if (!item.url && item.stream) item.url = item.stream;

      // method=link — это промежуточная ссылка на другой шаг шлюза
      // (например /lite/fxapi?postid=...&rjson), а не воспроизводимый поток.
      // Такие элементы не должны попадать в список.
      //
      // ВАЖНО: здесь именно continue, а не return. return внутри while вышел бы
      // из parseItems целиком и вернул undefined — вызывающий код падал на
      // items.forEach.
      if (item.method === 'link' && !item.allQualities) continue;

      if (item.url || item.stream) out.push(item);
    }
    return out;
  }

  // ───────────────────────────────────────────────────────── выбор шлюза ──
  function pickGateway(cb) {
    if (state.gateway) return cb(state.gateway);
    var list = CONFIG.gateways.slice();
    var i = 0;

    (function next() {
      if (i >= list.length) return cb(list[0]); // не смогли проверить — пробуем первый
      var g = list[i++];
      req(g + '/lite/withsearch', function (txt) {
        if (txt && txt.indexOf('[') !== -1) {
          state.gateway = g;
          log('gateway', g);
          cb(g);
        } else next();
      }, function () { next(); });
    })();
  }

  // ────────────────────────────────────────────────────────────── поиск ──
  function searchFilmix(gw, query, cb) {
    var url = gw + '/lite/filmix?title=' + encodeURIComponent(query);
    req(url, function (html) {
      var posts = [];
      var re = /postid=(\d+)/g, m;
      while ((m = re.exec(html)) !== null) {
        if (posts.indexOf(m[1]) === -1) posts.push(m[1]);
      }
      if (!posts.length) return cb([]);

      // берём первые 4 поста — дальше идут сериалы и мусор
      var slice = posts.slice(0, 4);
      var left = slice.length, acc = [];

      slice.forEach(function (id) {
        req(CONFIG.filmixResolver + '?postid=' + id, function (body) {
          var items = parseItems(body);
          items.forEach(function (it) {
            it.provider = 'Filmix';
            // Качество берём ТОЛЬКО из ключей объекта quality: в имени файла
            // стоит исходник (BDRip.2160p), а отдаётся урезанный поток
            // (_720.mp4). Проверено на postid 1113/4807/4808: ключи 480p/720p.
            var qs = it.allQualities || {};
            var best = '', bestK = 0;
            for (var k in qs) {
              var r = rank(k);
              if (r > bestK) { bestK = r; best = k; }
            }
            it.quality = best;
            if (best && qs[best]) it.url = qs[best];

            if (!it.title) it.title = query;
            if (!it.translate) it.translate = '';
            acc.push(it);
          });
          if (--left === 0) cb(acc);
        }, function () { if (--left === 0) cb(acc); });
      });
    }, function () { cb([]); });
  }

  // HDVB отдаёт HLS master с вариантами 640x268..1920x804. Плеер Lampa берёт
  // первый вариант (худший), поэтому master нужно развернуть самому и отдать
  // ссылку на последний — там максимум. Проверено: 1920x804 = 1080p.
  function expandHdvb(streamUrl, cb) {
    req(streamUrl, function (master) {
      if (!master || master.indexOf('#EXTM3U') === -1) return cb(streamUrl);

      var lines = master.split('\n');
      var best = null, bestPx = 0;
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
        if (m) {
          var px = parseInt(m[1], 10) * parseInt(m[2], 10);
          if (px > bestPx) {
            bestPx = px;
            // ссылка на вариант идёт следующей непустой строкой
            for (var j = i + 1; j < lines.length; j++) {
              if (lines[j] && lines[j].indexOf('#') !== 0) { best = lines[j].trim(); break; }
            }
          }
        }
      }
      cb(best || streamUrl);
    }, function () { cb(streamUrl); });
  }

  function searchHdvb(gw, query, cb) {
    var url = gw + '/lite/hdvb?title=' + encodeURIComponent(query);
    req(url, function (html) {
      var ids = [];
      var re = /kinopoisk_id=(\d+)/g, m;
      while ((m = re.exec(html)) !== null) {
        if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
      }
      if (!ids.length) return cb([]);

      var slice = ids.slice(0, 2);
      var pending = slice.length;   // сколько запросов /lite/hdvb ещё не ответило
      var acc = [];
      var finished = false;

      function done() {
        if (finished) return;
        finished = true;
        cb(acc);
      }

      function oneLess() {
        if (--pending === 0) done();
      }

      slice.forEach(function (id) {
        req(gw + '/lite/hdvb?kinopoisk_id=' + id, function (body) {
          var items = parseItems(body);
          if (!items.length) return oneLess();

          var inner = items.length;  // сколько expandHdvb ещё не ответил
          items.forEach(function (it) {
            it.provider = 'HDVB';
            it.title = it.title || query;
            if (!it.quality) it.quality = '1080p';

            if (!it.stream) {
              acc.push(it);
              if (--inner === 0) oneLess();
              return;
            }
            expandHdvb(it.stream, function (best) {
              it.url = best || it.stream;
              acc.push(it);
              if (--inner === 0) oneLess();
            });
          });
        }, function () { oneLess(); });
      });
    }, function () { cb([]); });
  }

  function searchVeoveo(gw, query, cb) {
    var url = gw + '/lite/veoveo?title=' + encodeURIComponent(query);
    req(url, function (html) {
      var items = parseItems(html);
      items.forEach(function (it) {
        it.provider = 'VeoVeo';
        it.title = it.title || query;
      });
      cb(items);
    }, function () { cb([]); });
  }

  var SEARCHERS = {
    filmix: searchFilmix,
    hdvb: searchHdvb,
    veoveo: searchVeoveo
  };

  function searchAll(query, done) {
    pickGateway(function (gw) {
      var srcs = CONFIG.sources.filter(function (s) { return SEARCHERS[s]; });
      if (!srcs.length) return done([]);

      var left = srcs.length, acc = [];

      srcs.forEach(function (s) {
        try {
          SEARCHERS[s](gw, query, function (items) {
            acc = acc.concat(items || []);
            if (--left === 0) finish();
          });
        } catch (e) {
          log('source error', s, e);
          if (--left === 0) finish();
        }
      });

      function finish() {
        // дедуп по url и отброс пустышек
        var seen = {};
        acc = acc.filter(function (i) {
          if (!i.url || !i.title || seen[i.url]) return false;
          seen[i.url] = 1;
          return true;
        });
        if (CONFIG.only4k) acc = acc.filter(function (i) { return is4k(i.quality); });
        acc.sort(function (a, b) { return rank(b.quality) - rank(a.quality); });
        done(acc);
      }
    });
  }

  // ────────────────────────────────────────────────────────────── стили ──
  function injectStyle() {
    if (document.getElementById('online4k-style')) return;
    var css = ''
      + '.online4k__item{padding:.85em 1.1em;margin:.35em 0;border-radius:.45em;background:rgba(255,255,255,.05)}'
      + '.online4k__item.focus{background:rgba(255,255,255,.16)}'
      + '.online4k__line{display:flex;align-items:center;justify-content:space-between;gap:1em}'
      + '.online4k__title{font-size:1.05em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.online4k__year{opacity:.55;font-weight:400}'
      + '.online4k__meta{display:flex;align-items:center;gap:.5em;flex:0 0 auto;font-size:.85em}'
      + '.online4k__q{padding:.15em .5em;border-radius:.25em;font-weight:600;background:rgba(255,255,255,.14)}'
      + '.online4k__q:empty{display:none}.online4k__v{opacity:.7}.online4k__v:empty{display:none}'
      + '.online4k__src{opacity:.45;font-size:.9em}'
      + '.online4k__empty{opacity:.6;line-height:1.5}';
    var st = document.createElement('style');
    st.id = 'online4k-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ─────────────────────────────────────────────────────────── компонент ──
  var component = {
    create: function (object) {
      var _this = this;
      this.object = object;
      this.results = [];

      this.scroll = new Lampa.Scroll({ mask: true, over: true });
      this.html = $('<div class="online4k selector"></div>');
      this.items = $('<div class="online4k__items"></div>');
      this.html.append(this.items);
      this.scroll.append(this.html);
      object.loader(true);

      var q = cleanQuery(object.search || (object.movie && object.movie.title) || '');
      searchAll(q, function (items) {
        _this.results = items;
        object.loader(false);
        _this.render();
        object.toggle();
      });
    },

    render: function () {
      var _this = this;
      this.items.empty();

      if (!this.results.length) {
        this.items.append('<div class="online4k__empty" style="padding:2em;text-align:center">' +
          'Ничего не найдено.<br><br>' +
          'Шлюз отдаёт данные не для всех источников: на 26.11.2026 работают ' +
          'Filmix, HDVB, VeoVeo. Остальные отвечают 403 "disable".</div>');
        return;
      }

      this.results.forEach(function (item, idx) {
        var el = $(
          '<div class="online4k__item selector-item" data-idx="' + idx + '">' +
            '<div class="online4k__line">' +
              '<div class="online4k__title">' + esc(item.title) +
                (item.year ? ' <span class="online4k__year">(' + esc(item.year) + ')</span>' : '') +
              '</div>' +
              '<div class="online4k__meta">' +
                '<span class="online4k__q">' + esc(item.quality) + '</span>' +
                '<span class="online4k__v">' + esc(item.translate) + '</span>' +
                '<span class="online4k__src">' + esc(item.provider) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
        el.on('hover:enter', function () { _this.play(item); });
        _this.items.append(el);
      });

      if (Lampa.Controller) Lampa.Controller.collectionSet(this.scroll.render());
    },

    play: function (item) {
      if (!item || !item.url) return;
      var title = item.title + (item.year ? ' (' + item.year + ')' : '');
      Lampa.Player.play({ title: title, url: item.url });
      Lampa.Player.playlist([{ title: item.title, url: item.url }]);
    },

    start: function () {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(this.scroll.render());
          Lampa.Controller.collectionFocus(false, this.scroll.render());
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

  // ──────────────────────────────────────────────────────────── запуск ──
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
    if (card.find('.online4k-button').length) return;

    var btn = $('<div class="full-start__button selector online4k-button" style="margin-top:.5em">' +
      '<div class="full-start__button-icon">4K</div>' +
      '<div class="full-start__button-name">' + PLUGIN_NAME + '</div></div>');
    btn.on('hover:enter', function () { openOnline(e.data.movie); });
    card.find('.view--torrent').after(btn);
  }

  function init() {
    if (window.__online4kLoaded) return;
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
        description: 'Онлайн без торрентов: Filmix, HDVB, VeoVeo',
        author: 'local',
        component: 'online4k'
      });
    }
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
