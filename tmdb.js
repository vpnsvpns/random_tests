(function () {
    'use strict';

    Lampa.Platform.tv();

    var config = {
        name: 'TMDB My Proxy',
        version: '1.0.3',
        description: 'Проксирование постеров и API сайта TMDB',
        path_image: Lampa.Utils.protocol() + 'imagetmdb.cub.red/',
        path_api: Lampa.Utils.protocol() + 'apitmdb.cub.red/3/'
    };

    // Принудительно включаем проксирование TMDB, чтобы работало на чистой lampa.mx
    if (Lampa.Storage.get('proxy_tmdb', null) === null) {
        Lampa.Storage.set('proxy_tmdb', true);
    }

    function fixUrl(url) {
        var head = url.slice(0, 8);
        var tail = url.slice(8).replace(/\/+/g, '/');
        return head + tail;
    }

    Lampa.TMDB.image = function (url) {
        var original = Lampa.Utils.protocol() + 'image.tmdb.org/' + url;
        return fixUrl(Lampa.Storage.field('proxy_tmdb') ? config.path_image + url : original);
    };

    Lampa.TMDB.api = function (url) {
        var original = Lampa.Utils.protocol() + 'api.themoviedb.org/3/' + url;
        return fixUrl(Lampa.Storage.field('proxy_tmdb') ? config.path_api + url : original);
    };
})();
