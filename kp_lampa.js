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
            // Загружаем базу
            try { this.data = JSON.parse(Lampa.Storage.get('kp_auto_cache', '{}')); } 
            catch (e) { this.data = {}; }

            // Загружаем параметры
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            // МЫ БОЛЬШЕ НЕ ЛЕЗЕМ В НАСТРОЙКИ (чтобы не было зеленого экрана)
            
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

            item.on('hover:enter', function () { 
                KP_Auto.checkParamsAndRun(); 
            });

            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        // --- ЦЕПОЧКА ПРОВЕРОК ---
        checkParamsAndRun: function() {
            // 1. Проверяем ID
            if (!this.params.user_id) {
                Lampa.Input.edit({
                    title: 'Введите ID КиноПоиска (только цифры)',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    if (new_value) {
                        KP_Auto.params.user_id = new_value;
                        Lampa.Storage.set('kp_user_id', new_value);
                        // После ввода ID сразу проверяем Ключ
                        KP_Auto.checkParamsAndRun();
                    }
                });
                return;
            }

            // 2. Проверяем API Key
            if (!this.params.api_key) {
                Lampa.Input.edit({
                    title: 'Введите API Key (kinopoiskapiunofficial)',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    if (new_value) {
                        KP_Auto.params.api_key = new_value;
                        Lampa.Storage.set('kp_api_key', new_value);
                        // Всё есть, запускаем!
                        KP_Auto.startSync();
                    }
                });
                return;
            }

            // 3. Всё на месте
            this.startSync();
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
            if (this.is_running) return Lampa.Noty.show('Работаю...');
            this.is_running = true;
            Lampa.Noty.show('API: Скачиваю оценки...');

            var page = 1;
            var total_loaded = 0;
            // Правильный метод API v1
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Auto.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_Auto.finish('Готово', total_loaded);
                            return;
                        }

                        var changes = 0;
                        res.items.forEach(function(item) {
                            var filmId = item.kinopoiskId || item.filmId;
                            var rating = item.rating || item.vote; 
                            if (filmId && rating && !isNaN(parseFloat(rating))) {
                                KP_Auto.data[filmId] = parseInt(rating);
                                changes++;
                            }
                        });

                        total_loaded += changes;
                        Lampa.Noty.show('Стр ' + page + ': +' + changes);
                        Lampa.Storage.set('kp_auto_cache', JSON.stringify(KP_Auto.data));

                        // Если страница не полная, значит конец
                        if (res.items.length < 20) {
                            KP_Auto.finish('Все загружено', total_loaded);
                            return;
                        }

                        page++;
                        setTimeout(next, 300); // API быстрый, 0.3 сек пауза
                    },
                    error: function(xhr) {
                        if (xhr.status === 404) {
                            // Очистим ID чтобы спросить заново
                            Lampa.Storage.set('kp_user_id', ''); 
                            KP_Auto.params.user_id = '';
                            KP_Auto.finish('Ошибка 404: Неверный ID пользователя! Нажмите еще раз.', total_loaded);
                        } else if (xhr.status === 401 || xhr.status === 402) {
                            // Очистим ключ
                            Lampa.Storage.set('kp_api_key', '');
                            KP_Auto.params.api_key = '';
                            KP_Auto.finish('Ошибка API Key: Неверный ключ! Нажмите еще раз.', total_loaded);
                        } else {
                            Lampa.Noty.show('Пауза (лимит запросов)...');
                            setTimeout(next, 2000);
                        }
                    }
                });
            };
            
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. Всего: ' + Object.keys(this.data).length);
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Auto.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Auto.init(); });

})();
