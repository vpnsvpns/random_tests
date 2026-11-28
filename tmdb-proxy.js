(function () {
    'use strict';

    Lampa.Platform.tv();

    function init() {
        var protocol = Lampa.Utils.protocol();
        var cub_domain = (Lampa.Manifest && Lampa.Manifest.cub_domain) ? Lampa.Manifest.cub_domain : 'cub.best';
        var is_bylampa = typeof window !== 'undefined' && window.location && window.location.hostname.indexOf('bylampa') !== -1;

        // На bylampa.online используются сервера bylampa,
        // а на обычной lampa.mx и любых других зеркалах — универсальные SSL-совместимые зеркала CUB
        var path_api = is_bylampa 
            ? protocol + 'tmdbapi.bylampa.online/3/' 
            : protocol + 'apitmdb.' + cub_domain + '/3/';

        var path_image = is_bylampa 
            ? protocol + 'tmdbimg.bylampa.online/' 
            : protocol + 'imagetmdb.com/';

        var plugin_info = {
            name: 'TMDB My Proxy',
            version: '1.0.4',
            description: 'Проксирование постеров и API сайта TMDB',
            path_image: path_image,
            path_api: path_api
        };

        // Нормализация URL
        function fixUrl(url) {
            var prefix = url.slice(0, 8);
            var rest = url.slice(8).replace(/\/+/g, '/');
            return prefix + rest;
        }

        // Автоматическая активация проксирования в хранилище при установке
        if (typeof Lampa.Storage.get('proxy_tmdb') === 'undefined' || !Lampa.Storage.field('proxy_tmdb')) {
            Lampa.Storage.set('proxy_tmdb', true);
        }

        // Проксирование изображений и постеров TMDB
        Lampa.TMDB.image = function (url) {
            var original = Lampa.Utils.protocol() + 'image.tmdb.org/' + url;
            return fixUrl(Lampa.Storage.field('proxy_tmdb') ? plugin_info.path_image + url : original);
        };

        // Проксирование запросов к API TMDB
        Lampa.TMDB.api = function (url) {
            var original = Lampa.Utils.protocol() + 'api.themoviedb.org/3/' + url;
            return fixUrl(Lampa.Storage.field('proxy_tmdb') ? plugin_info.path_api + url : original);
        };

        // Скрытие стандартного пункта проксирования в настройках TMDB
        Lampa.Settings.listener.follow('open', function (event) {
            if (event.name === 'tmdb') {
                event.body.find('[data-parent="proxy"]').remove();
            }
        });
    }

    // Запуск плагина после готовности Lampa
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') {
                init();
            }
        });
    }
})();
