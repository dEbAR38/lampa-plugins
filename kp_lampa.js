(function () {
    'use strict';

    var KP_Master = {
        data: {}, 
        is_running: false,
        
        params: {
            user_id: '',
            force_full: false
        },

        init: function () {
            // Читаем сохраненные оценки
            try {
                var saved = Lampa.Storage.get('kp_master_cache', '{}');
                this.data = JSON.parse(saved);
            } catch(e) { this.data = {}; }

            // Читаем сохраненный ID пользователя
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');

            // --- НАСТРОЙКИ ---
            Lampa.SettingsApi.addParam({
                component: 'kp_master',
                param: { name: 'kp_user_id', type: 'input', default: '' },
                field: { name: 'КиноПоиск ID', description: 'Введите цифры (например: 3493759)' },
                onChange: function(v) { KP_Master.params.user_id = v; }
            });

            Lampa.SettingsApi.addParam({
                component: 'kp_master',
                param: { name: 'kp_force_full', type: 'trigger', default: false },
                field: { name: 'Полная перезагрузка', description: 'Сканировать все страницы заново (если меняли старые оценки)' },
                onChange: function(v) { KP_Master.params.force_full = v; }
            });

            // --- КНОПКА В МЕНЮ (СЛЕВА) ---
            Lampa.Listener.follow('app', function (e) {
                if (e.type == 'ready') {
                    var html = `
                    <li class="menu__item selector" data-action="kp_sync">
                        <div class="menu__ico">
                            <svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" style="width:1.5em;height:1.5em">
                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                                <polyline points="9 11 12 14 22 4"></polyline>
                            </svg>
                        </div>
                        <div class="menu__text">КП: Синхронизация</div>
                    </li>`;
                    var item = $(html);
                    item.on('hover:enter', function () { KP_Master.startScan(); });
                    $('.menu .menu__list').eq(0).append(item);
                }
            });

            // --- ОТРИСОВКА НА КАРТОЧКАХ ---
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_Master.data[id]) {
                        KP_Master.drawBadge(e.card, KP_Master.data[id]);
                    }
                }
            });
        },

        drawBadge: function(card, score) {
            if(card.find('.kp-badge').length) return;
            
            // Цвета: Зеленый (7+), Серый (5-6), Красный (<5)
            var color = score >= 7 ? '#27ae60' : (score >= 5 ? '#7f8c8d' : '#c0392b');
            
            var badge = `
                <div class="kp-badge" style="
                    position: absolute;
                    top: 0.4em;
                    right: 0.4em;
                    background: ${color};
                    color: #fff;
                    width: 1.6em;
                    height: 1.6em;
                    line-height: 1.6em;
                    text-align: center;
                    border-radius: 50%;
                    font-weight: 800;
                    font-size: 0.9em;
                    box-shadow: 1px 1px 4px rgba(0,0,0,0.8);
                    z-index: 5;
                    pointer-events: none;
                ">${score}</div>
            `;
            card.find('.card__view').append(badge);
        },

        // --- ЛОГИКА СКАНИРОВАНИЯ ---
        startScan: function () {
            if (!this.params.user_id) {
                // Пытаемся взять из настроек еще раз
                this.params.user_id = Lampa.Storage.get('kp_user_id', ''); 
            }
            if (!this.params.user_id) return Lampa.Noty.show('Сначала введите ID в настройках!');
            
            if (this.is_running) return Lampa.Noty.show('Синхронизация уже идет...');

            this.is_running = true;
            this.params.force_full = Lampa.Storage.get('kp_force_full', false);
            
            Lampa.Noty.show('Поиск оценок...');

            var page = 1;
            var new_items = 0;
            // Сортировка по дате добавления - самая важная часть для скорости
            var base_url = 'https://www.kinopoisk.ru/user/' + this.params.user_id + '/votes/list/ord/date/page/';

            var next = function () {
                var proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(base_url + page + '/');

                $.ajax({
                    url: proxy,
                    dataType: 'json',
                    timeout: 10000,
                    success: function (res) {
                        if (!res.contents) { KP_Master.finish('Ошибка доступа (Proxy)'); return; }

                        var text = res.contents;
                        // Универсальный поиск: ищем "film/ID/" и рядом цифру оценки
                        var regex = /film\/(\d+)\/[\s\S]*?(?:vote|rating|date|kp_rating)[^>]*?>\s*(\d{1,2})\s*</g;
                        var matches = [...text.matchAll(regex)];

                        // Если ничего не нашли на странице - конец списка
                        if (matches.length === 0) {
                            KP_Master.finish('Готово (Конец списка)', new_items);
                            return;
                        }

                        var changes_on_page = 0;
                        matches.forEach(function (m) {
                            var id = m[1];
                            var rating = parseInt(m[2]);

                            // Если оценка новая или изменилась
                            if (KP_Master.data[id] !== rating) {
                                KP_Master.data[id] = rating;
                                changes_on_page++;
                                new_items++;
                            }
                        });

                        Lampa.Noty.show('Стр ' + page + ': найдено ' + matches.length + ' (Новых: ' + changes_on_page + ')');
                        
                        // Сохраняем прогресс
                        Lampa.Storage.set('kp_master_cache', JSON.stringify(KP_Master.data));

                        // УМНАЯ ОСТАНОВКА:
                        // Если на странице нет ни одной новой оценки и мы не просили "Полную перезагрузку"
                        if (changes_on_page === 0 && !KP_Master.params.force_full && page > 1) {
                            KP_Master.finish('Синхронизировано', new_items);
                            return;
                        }

                        page++;
                        if (page > 150) { KP_Master.finish('Лимит страниц', new_items); return; }

                        // Задержка чтобы не забанили (2.5 сек)
                        setTimeout(next, 2500);
                    },
                    error: function () {
                        // При ошибке пробуем еще раз через 5 сек
                        setTimeout(next, 5000);
                    }
                });
            };

            next();
        },

        finish: function (msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. Обновлено: ' + (count || 0));
            // Перерисовываем экран
            if(Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Master.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Master.init(); });
})();
