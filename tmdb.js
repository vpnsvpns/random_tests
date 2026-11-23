/**
 * ══════════════════════════════════════════════════════════════════════════════
 * Плагин «TMDB Proxy (Чистая версия без блокировок)» для Lampa
 * ══════════════════════════════════════════════════════════════════════════════
 * Деобфусцированная и очищенная версия оригинального tmdb-proxy.js.
 *
 * Что изменено и исправлено:
 * 1. ПОЛНОСТЬЮ УДАЛЕНА ОБФУСКАЦИЯ: код чистый, понятный и легко модифицируемый.
 * 2. УБРАНА ПРИВЯЗКА К bylampa.online: теперь работает на ВСЕХ доменах (lampa.mx,
 *    bylampa.online, локально, Smart TV, Android, Tizen, WebOS).
 * 3. ПОЛНАЯ ПОДДЕРЖКА HTTPS: не ломает запросы смешанного контента (Mixed Content)
 *    при открытии Lampa через HTTPS.
 * 4. ВОССТАНОВЛЕН ДОСТУП К НАСТРОЙКАМ ПРОКСИ: удален вредоносный код, скрывавший
 *    пункт настроек прокси в меню Lampa.
 * 5. ВЫБОР ЗЕРКАЛ И ПОЛЬЗОВАТЕЛЬСКОГО ПРОКСИ: поддерживает как быстрые зеркала
 *    (imagetmdb.com, tmdb.cub.red), так и прямой доступ к api.themoviedb.org,
 *    а также кастомный сервер пользователя.
 * ══════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  var PLUGIN_NAME = 'TMDB Proxy';
  var PLUGIN_VERSION = '2.0.0';

  function init() {
    if (window.plugin_tmdb_proxy_ready) return;
    window.plugin_tmdb_proxy_ready = true;

    // Включаем поддержку TV-платформ
    try {
      if (Lampa.Platform && Lampa.Platform.tv) {
        Lampa.Platform.tv();
      }
    } catch (e) {}

    // Определяем текущий протокол страницы (http: или https:)
    var protocol = (Lampa.Utils && Lampa.Utils.protocol ? Lampa.Utils.protocol() : window.location.protocol === 'https:' ? 'https:' : 'http:');
    if (!protocol.endsWith('//')) protocol = protocol.replace(/:?$/, '://');

    // Базовые надежные зеркала с поддержкой HTTPS и CORS
    var MIRRORS = {
      // Прямой доступ
      direct: {
        name: 'Официальный TMDB (Прямой)',
        image: protocol + 'image.tmdb.org/',
        api: protocol + 'api.themoviedb.org/3/'
      },
      // Зеркало CUB / ImageTMDB (работает везде, в т.ч. в РФ без блокировок)
      cub: {
        name: 'Зеркало ImageTMDB / CUB (Рекомендуется)',
        image: 'https://imagetmdb.com/',
        api: protocol + 'api.themoviedb.org/3/'
      },
      // Альтернативное зеркало Lampa
      mirror: {
        name: 'TMDB Proxy Mirror',
        image: 'https://imagetmdb.com/',
        api: 'https://tmdb.cub.red/3/'
      }
    };

    /**
     * Нормализация URL (удаление лишних слешей)
     */
    function normalizeUrl(url) {
      if (!url) return '';
      var prefix = url.slice(0, 8); // 'https://' или 'http://'
      var rest = url.slice(8).replace(/\/+/g, '/');
      return prefix + rest;
    }

    /**
     * Получить активный префикс для изображений
     */
    function getImagePrefix() {
      var customImg = Lampa.Storage.get('tmdb_proxy_custom_image', '');
      if (customImg) {
        if (!customImg.startsWith('http')) customImg = protocol + customImg;
        if (!customImg.endsWith('/')) customImg += '/';
        return customImg;
      }

      var preset = Lampa.Storage.get('tmdb_proxy_preset', 'cub');
      var selected = MIRRORS[preset] || MIRRORS.cub;
      return selected.image;
    }

    /**
     * Получить активный префикс для TMDB API
     */
    function getApiPrefix() {
      var customApi = Lampa.Storage.get('tmdb_proxy_custom_api', '');
      if (customApi) {
        if (!customApi.startsWith('http')) customApi = protocol + customApi;
        if (!customApi.endsWith('/')) customApi += '/';
        return customApi;
      }

      var preset = Lampa.Storage.get('tmdb_proxy_preset', 'cub');
      var selected = MIRRORS[preset] || MIRRORS.cub;
      return selected.api;
    }

    // Подмена метода формирования ссылки на изображение (постеры, фоны)
    Lampa.TMDB.image = function (path) {
      if (!path) return '';
      // Если путь уже абсолютный
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
      }
      var cleanPath = path.replace(/^\/+/, '');
      var base = getImagePrefix();
      return normalizeUrl(base + cleanPath);
    };

    // Подмена метода формирования ссылки на TMDB API
    Lampa.TMDB.api = function (path) {
      if (!path) return '';
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
      }
      var cleanPath = path.replace(/^\/+/, '');
      var base = getApiPrefix();
      return normalizeUrl(base + cleanPath);
    };

    /* -------------------------------------------------------------------------- */
    /*                         ДОБАВЛЕНИЕ НАСТРОЕК В LAMPA                         */
    /* -------------------------------------------------------------------------- */

    try {
      if (Lampa.SettingsApi) {
        Lampa.SettingsApi.addComponent({
          component: 'tmdb_proxy',
          name: PLUGIN_NAME,
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        });

        Lampa.SettingsApi.addParam({
          component: 'tmdb_proxy',
          param: {
            name: 'tmdb_proxy_preset',
            type: 'select',
            values: {
              cub: 'ImageTMDB / CUB (Стабильный)',
              direct: 'Официальный TMDB (Прямой)',
              mirror: 'TMDB CUB Red'
            },
            default: 'cub'
          },
          field: {
            name: 'Сервер постеров и API',
            description: 'Выбор стабильного зеркала для быстрой загрузки постеров и метаданных'
          }
        });

        Lampa.SettingsApi.addParam({
          component: 'tmdb_proxy',
          param: {
            name: 'tmdb_proxy_custom_image',
            type: 'input',
            default: ''
          },
          field: {
            name: 'Пользовательский сервер картинок',
            description: 'Оставьте пустым для использования выбранного выше пресета'
          }
        });

        Lampa.SettingsApi.addParam({
          component: 'tmdb_proxy',
          param: {
            name: 'tmdb_proxy_custom_api',
            type: 'input',
            default: ''
          },
          field: {
            name: 'Пользовательский TMDB API',
            description: 'Оставьте пустым для использования выбранного выше пресета'
          }
        });
      }
    } catch (e) {}

    console.log(PLUGIN_NAME + ' v' + PLUGIN_VERSION + ' успешно загружен без блокировок.');
  }

  // Запуск плагина с учетом состояния готовности Lampa
  if (window.appready) {
    init();
  } else if (window.Lampa && Lampa.Listener) {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') init();
    });
  } else {
    init();
  }
})();
