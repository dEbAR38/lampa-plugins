(function () {
    'use strict';

    var KP_Auto = {
        data: {},
        is_running: false,

        params: {
            user_id: '',
            api_key: ''
        },

        init: function () {
            // Загружаем сохраненную базу
            try { this.data = JSON.parse(Lampa.Storage.get('kp_auto_cache', '{}')); } 
            catch (e) { this.data = {}; }

            // Загружаем настройки
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            // --- НАСТРОЙКИ (В разделе "Остальное") ---
            Lampa.SettingsApi.addParam({
                component: 'more',
                param: { name: 'kp_user_id', type: 'input', default: '', placeholder: '3493759' },
                field: { name: 'КП: ID Пользователя', description: 'Цифры из профиля' },
                onChange: function (v) { KP_Auto.params.user_id = v; }
            });

            Lampa.SettingsApi.addParam({
                component: 'more',
                param: { name: 'kp_api_key', type: 'input', default: '', placeholder: 'xxxxx-xxxx-xxxx' },
                field: { name: 'КП: API Key', description: 'Ключ с kinopoiskapiunofficial.tech' },
                onChange: function (v) { KP_Auto.params.api_key = v; }
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

            item.on('hover:enter', function () { KP_Auto.startSync(); });

            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_Auto.data[id]) {
                        KP_Auto.drawBadge(e.card, KP_Auto.data[id]);
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

        startSync: function () {
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            if (!this.params.user_id) return Lampa.Noty.show('Введите ID в Настройках!');
            if (!this.params.api_key) return Lampa.Noty.show('Введите API Key в Настройках!');
            if (this.is_running) return Lampa.Noty.show('Синхронизация уже идет...');

            this.is_running = true;
            Lampa.Noty.show('API: Старт...');

            var page = 1;
            var total_loaded = 0;
            // Endpoint из документации
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Auto.params.api_key },
                    success: function (res) {
                        // API обычно возвращает { total: 100, items: [...] }
                        if (!res.items || res.items.length === 0) {
                            KP_Auto.finish('Готово', total_loaded);
                            return;
                        }

                        var changes = 0;
                        res.items.forEach(function(item) {
                            // Структура item может отличаться, проверяем
                            var filmId = item.kinopoiskId || item.filmId;
                            // Оценка может быть null, если просто "просмотрено"
                            var rating = item.rating || item.vote; 
                            
                            if (filmId && rating && !isNaN(parseFloat(rating))) {
                                KP_Auto.data[filmId] = parseInt(rating);
                                changes++;
                            }
                        });

                        total_loaded += changes;
                        Lampa.Noty.show('Стр ' + page + ': получено ' + changes);
                        
                        // Сохраняем промежуточно
                        Lampa.Storage.set('kp_auto_cache', JSON.stringify(KP_Auto.data));

                        // Если страница не полная (обычно 20 или 50 элементов), значит конец
                        if (res.items.length < 20) {
                            KP_Auto.finish('Все загружено', total_loaded);
                            return;
                        }

                        page++;
                        // Лимит API - 20 запросов в секунду, мы делаем медленнее для безопасности
                        setTimeout(next, 500); 
                    },
                    error: function(xhr) {
                        if (xhr.status === 404) {
                            KP_Auto.finish('Ошибка 404: Пользователь или оценки не найдены. Проверь ID.', total_loaded);
                        } else if (xhr.status === 401 || xhr.status === 402) {
                            KP_Auto.finish('Ошибка API Key: Неверный ключ или лимит исчерпан.', total_loaded);
                        } else {
                            // Иногда сервер дает 429 (Too Many Requests), ждем подольше
                            Lampa.Noty.show('Лимит запросов. Жду 2 сек...');
                            setTimeout(next, 2000);
                        }
                    }
                });
            };
            
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. Всего оценок: ' + Object.keys(this.data).length);
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Auto.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Auto.init(); });

})();
