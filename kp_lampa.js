(function () {
    'use strict';

    var KP_API_Plugin = {
        data: {},
        is_running: false,

        params: {
            user_id: '',
            api_key: '', // Сюда мы сохраним ключ
        },

        init: function () {
            // Читаем кэш
            try { this.data = JSON.parse(Lampa.Storage.get('kp_api_cache', '{}')); } 
            catch (e) { this.data = {}; }

            // Читаем настройки
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            // --- ДОБАВЛЯЕМ НАСТРОЙКИ В "ОСТАЛЬНОЕ" ---
            
            // 1. Поле для ID
            Lampa.SettingsApi.addParam({
                component: 'more',
                param: { name: 'kp_user_id', type: 'input', default: '', placeholder: '3493759' },
                field: { name: 'КП: ID Пользователя', description: 'Цифры из ссылки на профиль' },
                onChange: function (v) { KP_API_Plugin.params.user_id = v; }
            });

            // 2. Поле для API Key
            Lampa.SettingsApi.addParam({
                component: 'more',
                param: { name: 'kp_api_key', type: 'input', default: '', placeholder: 'xxxx-xxxx-xxxx' },
                field: { name: 'КП: API Key', description: 'Ключ с kinopoiskapiunofficial.tech' },
                onChange: function (v) { KP_API_Plugin.params.api_key = v; }
            });

            this.addMenu();
            this.addRenderHook();
        },

        addMenu: function () {
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
                    </svg>
                </div>
                <div class="menu__text">КП: Обновить (API)</div>
            </li>`);

            item.on('hover:enter', function () { KP_API_Plugin.startSync(); });

            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_API_Plugin.data[id]) {
                        KP_API_Plugin.drawBadge(e.card, KP_API_Plugin.data[id]);
                    }
                }
            });
        },

        drawBadge: function (card, score) {
            if (card.find('.kp-badge').length) return;
            var color = score >= 7 ? '#27ae60' : (score >= 5 ? '#7f8c8d' : '#c0392b');
            var badge = `<div class="kp-badge" style="position: absolute;top: 0.4em;right: 0.4em;background: ${color};color: #fff;width: 1.6em;height: 1.6em;line-height: 1.6em;text-align: center;border-radius: 50%;font-weight: 800;font-size: 0.9em;box-shadow: 1px 1px 4px rgba(0,0,0,0.8);z-index: 5;pointer-events: none;">${score}</div>`;
            card.find('.card__view').append(badge);
        },

        // --- ЛОГИКА API ---
        startSync: function () {
            // Обновляем параметры перед стартом
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            if (!this.params.user_id) return Lampa.Noty.show('Введите ID в Настройки -> Остальное');
            if (!this.params.api_key) return Lampa.Noty.show('Введите API Key в Настройки -> Остальное');
            if (this.is_running) return Lampa.Noty.show('Синхронизация уже идет...');

            this.is_running = true;
            Lampa.Noty.show('API: Запрос данных...');

            // У этого API есть лимит 500 запросов в день.
            // Но нет метода "Скачать все оценки юзера". 
            // Придется хитрить: ищем фильмы по ID юзера.
            // Эндпоинт: /api/v2.2/films/collections?type=USER_MOVIES&page=X
            // К сожалению, он не отдает оценки самого юзера в явном виде в бесплатной версии,
            // НО давай попробуем специальный метод парсинга через их базу.

            // ВАРИАНТ B: 
            // К сожалению, прямой API для оценок закрыт даже у них.
            // Но мы можем использовать этот плагин как "Облачную базу".
            // Если этот метод не сработает, то API бессилен.
            
            // Тест API
            var page = 1;
            var new_items = 0;
            var max_pages = 20; // Ограничим чтобы не съесть весь лимит
            
            var next = function() {
                // Пытаемся взять коллекцию "Любимые фильмы" или просто список
                // Внимание: UNOFFICIAL API меняет методы часто.
                // Сейчас пробуем метод получения топа
                
                $.ajax({
                    url: 'https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=TOP_POPULAR_ALL&page=' + page, // ТЕСТОВЫЙ ЗАПРОС
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_API_Plugin.params.api_key },
                    success: function (res) {
                        // Если этот запрос прошел, значит ключ верный.
                        // Но проблема: API не отдает ЛИЧНЫЕ оценки.
                        
                        // Я вынужден тебя огорчить: 
                        // Ни один публичный API сейчас не отдает личные оценки пользователя
                        // без авторизации через OAuth Яндекса (что на телеке сделать нереально сложно).
                        
                        KP_API_Plugin.is_running = false;
                        Lampa.Noty.show('Тест API успешен, но доступ к оценкам закрыт Яндексом.');
                    },
                    error: function(e) {
                        KP_API_Plugin.is_running = false;
                        Lampa.Noty.show('Ошибка API. Проверьте ключ.');
                    }
                });
            };
            
            // Запускаем
            next();
        }
    };

    if (window.appready) KP_API_Plugin.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_API_Plugin.init(); });

})();
