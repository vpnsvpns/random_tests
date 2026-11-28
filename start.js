(function () {
    'use strict';

    Lampa.Platform.tv();

    function init() {
        // Отслеживание событий запросов и переключение источника при необходимости
        Lampa.Listener.follow('request_secuses', function (event) {
            if (event.data && event.data.cub) {
                var activity = Lampa.Activity.active();
                activity.source = 'tmdb';
                Lampa.Storage.set('source', 'tmdb', true);
                Lampa.Activity.replace(activity);
                Lampa.Storage.set('source', 'cub', true);
            }
        });

        // Снятие блокировок/ограничений в настройках Lampa
        var timer = setInterval(function () {
            if (typeof window.lampa_settings !== 'undefined' && (window.lampa_settings.blocked || window.lampa_settings.fixdcma)) {
                clearInterval(timer);
                if (window.lampa_settings.fixdcma) {
                    window.lampa_settings.fixdcma = false;
                }
            }
        }, 100);
    }

    // Инициализация при готовности приложения на любой версии Lampa
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
