(function () {
    'use strict';

    var KP_Master = {
        data: {},
        is_running: false,

        init: function () {
            // Уведомление о старте
            Lampa.Noty.show('КП Плагин: Safe Mode (Меню отключено)');

            // Загрузка сохраненных данных
            try {
                var saved = Lampa.Storage.get('kp_master_cache', '{}');
                this.data = JSON.parse(saved);
            } catch (e) { this.data = {}; }

            // 1. Добавляем кнопку в левое меню
            this.addMenu();

            // 2. Рисуем оценки
            this.addRenderHook();
        },

        addMenu: function () {
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" style="width:1.5em;height:1.5em">
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                        <polyline points="9 11 12 14 22 4"></polyline>
                    </svg>
                </div>
                <div class="menu__text">КП: Синхронизация</div>
            </li>`);

            // При нажатии запускаем проверку
            item.on('hover:enter', function () { 
                KP_Master.checkIdAndRun(); 
            });

            if ($('.menu .menu__list').length) {
                $('.menu .menu__list').eq(0).append(item);
            } else {
                Lampa.Listener.follow('app', function (e) {
                    if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item);
                });
            }
        },

        // --- ГЛАВНАЯ ЛОГИКА: Спрашиваем ID, если его нет ---
        checkIdAndRun: function() {
            var current_id = Lampa.Storage.get('kp_user_id', '');

            if (current_id) {
                // ID есть, запускаем синхронизацию
                // Можно добавить вопрос "Сбросить ID?" через долгое нажатие, но пока сделаем просто
                this.startScan(current_id);
            } else {
                // ID нет, вызываем клавиатуру
                Lampa.Input.edit({
                    title: 'Введите ID КиноПоиска (только цифры)',
                    value: '',
                    free: true,
                    nosave: true // Мы сохраним сами
                }, function (new_value) {
                    if (new_value) {
                        Lampa.Storage.set('kp_user_id', new_value);
                        Lampa.Noty.show('ID сохранен!');
                        KP_Master.startScan(new_value);
                    }
                });
            }
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_Master.data[id]) {
                        KP_Master.drawBadge(e.card, KP_Master.data[id]);
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

        startScan: function (user_id) {
            if (this.is_running) return Lampa.Noty.show('Синхронизация уже идет...');

            this.is_running = true;
            Lampa.Noty.show('Поиск оценок...');

            var page = 1;
            var new_items = 0;
            var base_url = 'https://www.kinopoisk.ru/user/' + user_id + '/votes/list/ord/date/page/';

            var next = function () {
                var proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(base_url + page + '/');
                $.ajax({
                    url: proxy, dataType: 'json', timeout: 10000,
                    success: function (res) {
                        if (!res.contents) { KP_Master.finish('Ошибка доступа (Proxy)'); return; }
                        
                        var regex = /film\/(\d+)\/[\s\S]*?(?:vote|rating|date|kp_rating)[^>]*?>\s*(\d{1,2})\s*</g;
                        var matches = [...res.contents.matchAll(regex)];

                        if (matches.length === 0) { KP_Master.finish('Готово', new_items); return; }

                        var changes = 0;
                        matches.forEach(function (m) {
                            var id = m[1]; var rating = parseInt(m[2]);
                            if (KP_Master.data[id] !== rating) {
                                KP_Master.data[id] = rating; changes++; new_items++;
                            }
                        });

                        Lampa.Noty.show('Стр ' + page + ': ' + matches.length + ' (Новых: ' + changes + ')');
                        Lampa.Storage.set('kp_master_cache', JSON.stringify(KP_Master.data));

                        // Сканируем только новые, если не найдено изменений - стоп
                        if (changes === 0 && page > 1) { 
                            KP_Master.finish('Синхронизировано', new_items); return; 
                        }
                        page++;
                        if (page > 150) { KP_Master.finish('Лимит страниц', new_items); return; }
                        setTimeout(next, 2500);
                    },
                    error: function () { setTimeout(next, 5000); }
                });
            };
            next();
        },

        finish: function (msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. Обновлено: ' + (count || 0));
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    function startPlugin() {
        if (window.kp_plugin_loaded) return;
        window.kp_plugin_loaded = true;
        KP_Master.init();
    }

    if (window.appready) startPlugin();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') startPlugin(); });

})();
