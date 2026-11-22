(function () {
    'use strict';

    if (window.plugin_online_4k_free_loaded) return;
    window.plugin_online_4k_free_loaded = true;

    var PLUGIN_ID = 'online_4k_free';

    var COLLAPS_MIRRORS = [
        'https://api.bhcesh.me',
        'https://api.delivembd.ws',
        'https://api1657191944.apicollaps.cc'
    ];

    var ALLOHA_MIRRORS = [
        'https://api.alloha.tv',
        'https://api.apbugall.org'
    ];

    function getParam(key, def) {
        return Lampa.Storage.get(PLUGIN_ID + '_' + key, def);
    }

    function Online4KFreeComponent(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);

        var html = $('<div></div>');
        var body = $('<div class="online-4k-free-list"></div>');
        var strict4K = true;

        this.create = function () {
            var _this = this;
            this.activity.loader(true);

            filter.onSelect = function (type, a, b) {
                if (type === 'filter' && a.stype === 'mode') {
                    strict4K = b.index === 0;
                    _this.searchAll();
                }
            };

            filter.onBack = function () {
                Lampa.Activity.backward();
            };

            files.appendFiles(scroll.render());
            html.append(filter.render());
            html.append(files.render());

            this.searchAll();
            return this.render();
        };

        this.updateFilterUI = function () {
            filter.set('filter', [
                {
                    title: 'Качество: ' + (strict4K ? 'Только 4K (2160p)' : '4K + 1080p резерв'),
                    stype: 'mode',
                    items: [
                        { title: 'Только 4K (2160p)', selected: strict4K, index: 0 },
                        { title: '4K + 1080p резерв', selected: !strict4K, index: 1 }
                    ]
                }
            ]);
        };

        this.fetchWithMirrors = function (mirrors, buildUrl, onSuccess, onFail) {
            var index = 0;

            function tryNext() {
                if (index >= mirrors.length) {
                    onFail();
                    return;
                }

                var host = mirrors[index].replace(/\/$/, '');
                var url = buildUrl(host);
                var req = new Lampa.Reguest();
                req.timeout(8000);
                req.silent(
                    url,
                    function (res) {
                        onSuccess(res);
                    },
                    function () {
                        index++;
                        tryNext();
                    }
                );
            }

            tryNext();
        };

        this.searchAll = function () {
            var _this = this;
            var movie = object.movie || {};

            this.activity.loader(true);
            scroll.clear();
            body.empty();
            this.updateFilterUI();

            var kpId = movie.kinopoisk_id || movie.kp_id || '';
            var imdbId = movie.imdb_id || '';
            var title = movie.title || movie.name || movie.original_title || '';

            var foundStreams = [];
            var completed = 0;
            var totalSources = 2;

            function checkDone() {
                completed++;
                if (completed === totalSources) {
                    _this.activity.loader(false);
                    _this.renderResults(foundStreams);
                }
            }

            // 1. Collaps (бесплатный балансер с 2160p)
            var customCollaps = getParam('collaps_host', '');
            var collapsList = customCollaps ? [customCollaps].concat(COLLAPS_MIRRORS) : COLLAPS_MIRRORS;

            this.fetchWithMirrors(
                collapsList,
                function (host) {
                    var query = kpId ? 'kinopoisk_id=' + kpId : (imdbId ? 'imdb_id=' + imdbId : 'name=' + encodeURIComponent(title));
                    return host + '/franchise/details?' + query + '&token=eedefb541aeba871d7756d121c6527bd';
                },
                function (res) {
                    if (res && res.results && res.results.length) {
                        res.results.forEach(function (item) {
                            var qual = String(item.quality || '');
                            var is4k = /2160|4k|uhd/i.test(qual);
                            if (strict4K && !is4k) return;

                            var streamUrl = item.iframe_url || item.url || '';
                            if (streamUrl) {
                                foundStreams.push({
                                    source: 'Collaps',
                                    title: item.name || title,
                                    voice: (item.voiceActing && item.voiceActing.join(', ')) || 'Дубляж / Оригинал',
                                    quality: is4k ? '4K 2160p' : (qual || '1080p'),
                                    is4k: is4k,
                                    url: streamUrl.indexOf('//') === 0 ? 'https:' + streamUrl : streamUrl
                                });
                            }
                        });
                    }
                    checkDone();
                },
                checkDone
            );

            // 2. Alloha (бесплатный балансер с выборочным 2160p)
            var customAlloha = getParam('alloha_host', '');
            var allohaList = customAlloha ? [customAlloha].concat(ALLOHA_MIRRORS) : ALLOHA_MIRRORS;

            this.fetchWithMirrors(
                allohaList,
                function (host) {
                    var query = kpId ? 'kp=' + kpId : (imdbId ? 'imdb=' + imdbId : 'name=' + encodeURIComponent(title));
                    return host + '/?token=04941a9a3ca3ac16e2b4327347bbc1&' + query;
                },
                function (res) {
                    if (res && res.data) {
                        var d = res.data;
                        var qual = String(d.quality || '');
                        var is4k = /2160|4k|uhd/i.test(qual);
                        if (!strict4K || is4k) {
                            var iframe = d.iframe || '';
                            if (iframe) {
                                foundStreams.push({
                                    source: 'Alloha',
                                    title: d.name || title,
                                    voice: d.translation || 'Несколько озвучек',
                                    quality: is4k ? '4K 2160p' : (qual || '1080p'),
                                    is4k: is4k,
                                    url: iframe.indexOf('//') === 0 ? 'https:' + iframe : iframe
                                });
                            }
                        }
                    }
                    checkDone();
                },
                checkDone
            );
        };

        this.renderResults = function (streams) {
            var _this = this;
            var movie = object.movie || {};

            streams.sort(function (a, b) {
                return (b.is4k ? 1 : 0) - (a.is4k ? 1 : 0);
            });

            if (!streams.length) {
                this.showEmpty(
                    strict4K
                        ? 'Для этого фильма пока нет бесплатного 4K (2160p) потока.<br><br>Переключите фильтр сверху на «4K + 1080p резерв», чтобы открыть доступную версию.'
                        : 'Бесплатные потоки для этого фильма не найдены.'
                );
                return;
            }

            streams.forEach(function (item) {
                var badgeBg = item.is4k ? '#ff9800' : '#3a3a3a';
                var badgeColor = item.is4k ? '#000' : '#fff';

                var card = $(
                    '<div class="online-prestige selector" style="padding: 1.15em 1.3em; margin-bottom: 0.75em; background: rgba(255,255,255,0.06); border-radius: 0.6em; display: flex; justify-content: space-between; align-items: center; gap: 1em;">' +
                        '<div>' +
                            '<div style="font-size: 1.15em; font-weight: 600; margin-bottom: 0.3em;">' + item.source + ' — ' + item.title + '</div>' +
                            '<div style="font-size: 0.92em; opacity: 0.75;">Озвучка: ' + item.voice + '</div>' +
                        '</div>' +
                        '<div style="background: ' + badgeBg + '; color: ' + badgeColor + '; font-weight: 800; padding: 0.35em 0.75em; border-radius: 0.4em; font-size: 0.9em; white-space: nowrap;">' +
                            item.quality +
                        '</div>' +
                    '</div>'
                );

                card.on('hover:enter', function () {
                    _this.launchPlayer(item, movie);
                });

                body.append(card);
            });

            scroll.append(body);
            this.activity.toggle();
        };

        this.launchPlayer = function (item, movie) {
            var _this = this;
            this.activity.loader(true);

            var req = new Lampa.Reguest();
            req.timeout(9000);
            req.native(
                item.url,
                function (htmlText) {
                    _this.activity.loader(false);
                    var m3u8Match = htmlText.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);

                    if (m3u8Match && m3u8Match[0]) {
                        var cleanM3u8 = m3u8Match[0].replace(/\\/g, '');
                        var playData = {
                            title: (movie.title || movie.name || 'Видео') + ' [' + item.quality + ']',
                            url: cleanM3u8,
                            timeline: Lampa.Timeline.view(Lampa.Utils.hash(movie.original_title || movie.title || cleanM3u8))
                        };
                        Lampa.Player.play(playData);
                        Lampa.Player.playlist([playData]);
                    } else {
                        openIframeOverlay(item.url);
                    }
                },
                function () {
                    _this.activity.loader(false);
                    openIframeOverlay(item.url);
                },
                false,
                { dataType: 'text' }
            );

            function openIframeOverlay(src) {
                var overlay = $(
                    '<div class="online-4k-iframe-wrap" style="position: fixed; inset: 0; z-index: 9999; background: #000;">' +
                        '<iframe src="' + src + '" style="width: 100%; height: 100%; border: none;" allowfullscreen allow="autoplay; encrypted-media"></iframe>' +
                    '</div>'
                );

                $('body').append(overlay);

                Lampa.Controller.add('iframe_4k', {
                    toggle: function () {},
                    back: function () {
                        overlay.remove();
                        Lampa.Controller.toggle('content');
                    }
                });
                Lampa.Controller.toggle('iframe_4k');
            }
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
                right: function () {
                    Navigator.move('right');
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
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

    function addWatch4KButton() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var render = e.object.activity.render();
            render.find('.view--online4k-free').remove();

            var btn = $(
                '<div class="full-start__button selector view--online4k-free" data-subtitle="Бесплатный 4K">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">' +
                        '<path d="M8 5v14l11-7z"/>' +
                    '</svg>' +
                    '<span>Смотреть 4K</span>' +
                '</div>'
            );

            btn.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Онлайн 4K — ' + (e.data.movie.title || e.data.movie.name),
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

    function registerSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: 'Онлайн 4K',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 9 15 12 10 15 10 9"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: PLUGIN_ID + '_collaps_host', type: 'input', values: '', default: '' },
            field: { name: 'Свое зеркало Collaps (необязательно)', description: 'Оставьте пустым для автоподбора рабочих зеркал' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: PLUGIN_ID + '_alloha_host', type: 'input', values: '', default: '' },
            field: { name: 'Свое зеркало Alloha (необязательно)', description: 'Оставьте пустым для автоподбора рабочих зеркал' }
        });
    }

    function init() {
        Lampa.Component.add(PLUGIN_ID, Online4KFreeComponent);
        registerSettings();
        addWatch4KButton();
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
