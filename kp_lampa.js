(function () {
    'use strict';

    var KP_Master = {
        data: {},
        is_running: false,

        init: function () {
            Lampa.Noty.show('КП Плагин: Легкая версия (V10)');
            
            try {
                var saved = Lampa.Storage.get('kp_master_cache', '{}');
                this.data = JSON.parse(saved);
            } catch (e) { this.data = {}; }

            this.addMenu();
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

            item.on('hover:enter', function () { KP_Master.checkIdAndRun(); });

            if ($('.menu .menu__list').length) {
                $('.menu .menu__list').eq(0).append(item);
            } else {
                Lampa.Listener.follow('app', function (e) {
                    if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item);
                });
            }
        },

        checkIdAndRun: function() {
            var current_id = Lampa.Storage.get('kp_user_id', '');
            if (current_id) {
                this.startScan(current_id);
            } else {
                Lampa.Input.edit({
                    title: 'Введите ID КиноПоиска',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    if (new_value) {
                        Lampa.Storage.set('kp_user_id', new_value);
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
            if (this.is_running) return Lampa.Noty.show('Уже работает...');

            this.is_running = true;
            Lampa.Noty.show('Сканирование начато. Не нажимайте ничего...');

            var page = 1;
            var new_items = 0;
            var base_url = 'https://www.kinopoisk.ru/user/' + user_id + '/votes/list/ord/date/page/';
            
            // Счетчик для редкого сохранения
            var save_counter = 0;

            var next = function () {
                var proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(base_url + page + '/');
                
                $.ajax({
                    url: proxy, 
                    dataType: 'json', 
                    timeout: 15000, // Увеличили таймаут ожидания
                    success: function (res) {
                        if (!res.contents) { 
                            KP_Master.finish('Ошибка сети (прокси)', new_items); 
                            return; 
                        }
                        
                        var text = res.contents;
                        // Очищаем res сразу, чтобы освободить память ТВ
                        res = null; 

                        var regex = /film\/(\d+)\/[\s\S]*?(?:vote|rating|date|kp_rating)[^>]*?>\s*(\d{1,2})\s*</g;
                        var matches = [...text.matchAll(regex)];

                        if (matches.length === 0) { 
                            KP_Master.finish('Готово (Все страницы)', new_items); 
                            return; 
                        }

                        var changes = 0;
                        matches.forEach(function (m) {
                            var id = m[1]; var rating = parseInt(m[2]);
                            if (KP_Master.data[id] !== rating) {
                                KP_Master.data[id] = rating; changes++; new_items++;
                            }
                        });

                        Lampa.Noty.show('Стр ' + page + ': найдено ' + matches.length);
                        
                        // ОПТИМИЗАЦИЯ: Сохраняем только каждую 5-ю страницу
                        save_counter++;
                        if (save_counter % 5 === 0) {
                            Lampa.Storage.set('kp_master_cache', JSON.stringify(KP_Master.data));
                        }

                        if (changes === 0 && page > 1) { 
                            KP_Master.finish('Синхронизировано', new_items); return; 
                        }
                        
                        page++;
                        if (page > 150) { KP_Master.finish('Лимит страниц', new_items); return; }
                        
                        // ОПТИМИЗАЦИЯ: Ждем 4 секунды вместо 2.5
                        setTimeout(next, 4000); 
                    },
                    error: function () { 
                        Lampa.Noty.show('Сбой сети. Жду 10 сек...');
                        setTimeout(next, 10000); 
                    }
                });
            };
            next();
        },

        finish: function (msg, count) {
            this.is_running = false;
            // Финальное сохранение обязательно
            Lampa.Storage.set('kp_master_cache', JSON.stringify(this.data));
            
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
