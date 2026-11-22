(function () {
    'use strict';

    if (window.plugin_cinema_4k_ready) return;
    window.plugin_cinema_4k_ready = true;

    var PLUGIN_ID = 'cinema_4k';

    // Публичные шлюзы BWA / Lampac (используются в cinema.js / modss)
    var DEFAULT_HOSTS = [
        'https://bwa.to',
        'https://rc.bwa.ad',
        'https://lampa.bwa.ad',
        'https://apn.watch'
    ];

    var manifest = {
        type: 'video',
        version: '1.0.0',
        name: 'Cinema 4K',
        description: 'Онлайн-просмотр 2160p / 1080p через BWA/Lampac API без торрентов',
        component: PLUGIN_ID
    };

    if (Lampa.Manifest) {
        if (Array.isArray(Lampa.Manifest.plugins)) {
            Lampa.Manifest.plugins.push(manifest);
        } else {
            Lampa.Manifest.plugins = manifest;
        }
    }

    function getHosts() {
        var custom = Lampa.Storage.get(PLUGIN_ID + '_custom_host', '');
        if (custom) {
            return [custom.replace(/\/$/, '')].concat(DEFAULT_HOSTS);
        }
        return DEFAULT_HOSTS;
    }

    function Cinema4KComponent(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);

        var html = $('<div></div>');
        var body = $('<div class="cinema-4k-list"></div>');
        var hostIndex = 0;
        var strict4K = true;

        this.create = function () {
            var _this = this;
            this.activity.loader(true);

            filter.onSelect = function (type, a, b) {
                if (type === 'filter') {
                    if (a.stype === 'quality') {
                        strict4K = b.index === 0;
                        _this.loadBalancers();
                    } else if (a.stype === 'host') {
                        hostIndex = b.index;
                        _this.loadBalancers();
                    }
                }
            };

            filter.onBack = function () {
                Lampa.Activity.backward();
            };

            files.appendFiles(scroll.render());
            html.append(filter.render());
            html.append(files.render());

            this.loadBalancers();
            return this.render();
        };

        this.updateFilter = function (hosts) {
            var hostItems = hosts.map(function (h, i) {
                return {
                    title: h.replace(/^https?:\/\//, ''),
                    selected: i === hostIndex,
                    index: i
                };
            });

            filter.set('filter', [
                {
                    title: 'Качество: ' + (strict4K ? 'Только 4K (2160p)' : 'Все (4K + 1080p)'),
                    stype: 'quality',
                    items: [
                        { title: 'Только 4K (2160p)', selected: strict4K, index: 0 },
                        { title: 'Все (4K + 1080p)', selected: !strict4K, index: 1 }
                    ]
                },
                {
                    title: 'Шлюз: ' + hosts[hostIndex].replace(/^https?:\/\//, ''),
                    stype: 'host',
                    items: hostItems
                }
            ]);
        };

        this.loadBalancers = function () {
            var _this = this;
            var movie = object.movie || {};
            var hosts = getHosts();

            this.activity.loader(true);
            scroll.clear();
            body.empty();
            this.updateFilter(hosts);

            var host = hosts[hostIndex];
            var isSerial = movie.first_air_date || movie.number_of_seasons ? 1 : 0;
            var kpId = movie.kinopoisk_id || movie.kp_id || '';
            var imdbId = movie.imdb_id || '';
            var title = movie.title || movie.name || '';
            var origTitle = movie.original_title || movie.original_name || title;
            var year = (movie.release_date || movie.first_air_date || '').slice(0, 4);

            var eventsUrl = host + '/lite/events?id=' + encodeURIComponent(movie.id || '') +
                '&imdb_id=' + encodeURIComponent(imdbId) +
                '&kinopoisk_id=' + encodeURIComponent(kpId) +
                '&title=' + encodeURIComponent(title) +
                '&original_title=' + encodeURIComponent(origTitle) +
                '&year=' + encodeURIComponent(year) +
                '&serial=' + isSerial +
                '&rjson=true';

            network.clear();
            network.timeout(10000);
            network.silent(
                eventsUrl,
                function (balancers) {
                    if (!Array.isArray(balancers) || !balancers.length) {
                        _this.tryNextHost(hosts, 'Шлюз вернул пустой список балансеров');
                        return;
                    }
                    _this.scanBalancers(balancers, movie);
                },
                function () {
                    _this.tryNextHost(hosts, 'Шлюз недоступен');
                }
            );
        };

        this.tryNextHost = function (hosts, reason) {
            if (hostIndex < hosts.length - 1) {
                hostIndex++;
                this.loadBalancers();
            } else {
                this.activity.loader(false);
                this.showEmpty(
                    'Не удалось получить список балансеров (' + reason + ').<br><br>' +
                    'Укажите рабочий BWA/Lampac хост в <b>Настройки -> Cinema 4K</b> (например, адрес из плагина @rik).'
                );
            }
        };

        // Опрашиваем все балансеры с &rjson=true, чтобы вытащить прямые 2160p потоки
        this.scanBalancers = function (balancers, movie) {
            var _this = this;
            var foundStreams = [];
            var pending = balancers.length;

            balancers.forEach(function (bal) {
                if (!bal.url) {
                    pending--;
                    if (pending === 0) _this.finishScan(foundStreams, movie);
                    return;
                }

                var reqUrl = bal.url + (bal.url.indexOf('?') === -1 ? '?' : '&') + 'rjson=true';
                var req = new Lampa.Reguest();
                req.timeout(9000);
                req.silent(
                    reqUrl,
                    function (res) {
                        _this.extractStreams(res, bal.name || bal.balanser || 'Балансер', foundStreams);
                        pending--;
                        if (pending === 0) _this.finishScan(foundStreams, movie);
                    },
                    function () {
                        pending--;
                        if (pending === 0) _this.finishScan(foundStreams, movie);
                    }
                );
            });
        };

        this.extractStreams = function (res, balName, outList) {
            if (!res) return;

            // Формат ответа Lampac/BWA rjson: { method: 'play', url: '...', quality: { '2160p': '...', '1080p': '...' } }
            // или массив серий/озвучек: [ { title: '...', url: '...', quality: {...} } ]
            var items = Array.isArray(res) ? res : (res.data && Array.isArray(res.data) ? res.data : [res]);

            items.forEach(function (entry) {
                if (!entry) return;

                var qMap = entry.quality || {};
                var url4k = qMap['2160p'] || qMap['4K'] || qMap['2160'] || '';
                var directUrl = entry.url || entry.file || '';

                if (!url4k && /2160|4k|uhd/i.test(String(entry.maxquality || entry.title || directUrl))) {
                    url4k = directUrl;
                }

                var bestUrl = url4k || qMap['1080p'] || directUrl;
                if (!bestUrl || typeof bestUrl !== 'string') return;

                var is4k = !!url4k;
                if (strict4K && !is4k) return;

                outList.push({
                    balancer: balName,
                    title: entry.title || entry.translate || entry.voice || 'Оригинал / Дубляж',
                    quality: is4k ? '4K 2160p' : (qMap['1080p'] ? '1080p' : 'HD'),
                    is4k: is4k,
                    url: bestUrl,
                    qualityMap: Object.keys(qMap).length ? qMap : false
                });
            });
        };

        this.finishScan = function (streams, movie) {
            var _this = this;
            this.activity.loader(false);

            streams.sort(function (a, b) {
                return (b.is4k ? 1 : 0) - (a.is4k ? 1 : 0);
            });

            if (!streams.length) {
                this.showEmpty(
                    strict4K
                        ? 'Ни один балансер не отдал поток в 4K (2160p) для этого фильма.<br><br>Переключите фильтр сверху на <b>«Все (4K + 1080p)»</b>.'
                        : 'Потоки для этого фильма не найдены.'
                );
                return;
            }

            streams.forEach(function (item) {
                var card = $(
                    '<div class="online-prestige selector" style="padding: 1.1em 1.25em; margin-bottom: 0.7em; background: rgba(255,255,255,0.07); border-radius: 0.55em; display: flex; justify-content: space-between; align-items: center; gap: 1em;">' +
                        '<div>' +
                            '<div style="font-size: 1.15em; font-weight: 600;">' + item.balancer + '</div>' +
                            '<div style="font-size: 0.92em; opacity: 0.75; margin-top: 0.25em;">' + item.title + '</div>' +
                        '</div>' +
                        '<div style="background: ' + (item.is4k ? '#ff9800' : '#4caf50') + '; color: #000; font-weight: 800; padding: 0.35em 0.7em; border-radius: 0.35em; white-space: nowrap;">' +
                            item.quality +
                        '</div>' +
                    '</div>'
                );

                card.on('hover:enter', function () {
                    var playObj = {
                        title: (movie.title || movie.name || 'Видео') + ' [' + item.quality + ']',
                        url: item.url,
                        quality: item.qualityMap,
                        timeline: Lampa.Timeline.view(Lampa.Utils.hash(movie.original_title || movie.title || item.url))
                    };
                    Lampa.Player.play(playObj);
                    Lampa.Player.playlist([playObj]);
                });

                body.append(card);
            });

            scroll.append(body);
            this.activity.toggle();
        };

        this.showEmpty = function (msg) {
            scroll.append(
                '<div style="padding: 2.5em; text-align: center; font-size: 1.1em; line-height: 1.5; opacity: 0.85;">' +
                    msg +
                '</div>'
            );
            this.activity.toggle();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };

        this.destroy = function () {
            network.clear();
            files.destroy();
            scroll.destroy();
            html.remove();
        };
    }

    function addButton() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var render = e.object.activity.render();
            render.find('.view--cinema4k').remove();

            var btn = $(
                '<div class="full-start__button selector view--cinema4k" data-subtitle="Cinema 4K">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>' +
                    '<span>Смотреть 4K</span>' +
                '</div>'
            );

            btn.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Cinema 4K — ' + (e.data.movie.title || e.data.movie.name),
                    component: PLUGIN_ID,
                    movie: e.data.movie,
                    page: 1
                });
            });

            var container = render.find('.full-start-new__buttons');
            if (!container.length) container = render.find('.full-start__buttons');
            if (container.length) container.prepend(btn);
        });
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: 'Cinema 4K',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 9 15 12 10 15 10 9"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: PLUGIN_ID + '_custom_host', type: 'input', values: '', default: '' },
            field: {
                name: 'Свой BWA / Lampac хост (опционально)',
                description: 'Например, http://bwa... из плагина @rik, если публичные шлюзы перегружены'
            }
        });
    }

    function init() {
        Lampa.Component.add(PLUGIN_ID, Cinema4KComponent);
        addSettings();
        addButton();
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
