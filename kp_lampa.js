(function () {
    'use strict';

    var KP_NameMatch = {
        data_id: {},    // Поиск по ID (быстрый)
        data_name: {},  // Поиск по Названию (резервный)
        
        params: { user_id: '', api_key: '' },
        is_running: false,

        init: function () {
            // Пытаемся загрузить базу
            this.loadBase();

            // Загружаем настройки
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            this.addMenu();
            this.addRenderHook();

            // АВТО-ВОССТАНОВЛЕНИЕ: Если база пустая, качаем сами
            if (Object.keys(this.data_id).length === 0 && this.params.user_id && this.params.api_key) {
                setTimeout(function(){ KP_NameMatch.startSync(true); }, 5000);
            }
        },

        loadBase: function() {
            try { 
                var raw = JSON.parse(Lampa.Storage.get('kp_smart_base', '{}'));
                this.data_id = raw.ids || {};
                this.data_name = raw.names || {};
            } catch (e) { 
                this.data_id = {}; this.data_name = {}; 
            }
        },

        saveBase: function() {
            var dump = { ids: this.data_id, names: this.data_name };
            Lampa.Storage.set('kp_smart_base', JSON.stringify(dump));
        },

        // Генерация ключа для поиска по названию: "матрица2020"
        makeKey: function(title, year) {
            if (!title) return null;
            return (title.toLowerCase().replace(/[^a-zа-я0-9]/g, '')) + (year || '');
        },

        addMenu: function () {
            var count = Object.keys(this.data_id).length;
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
                <div class="menu__text">КП: Обновить (Фильмов: ${count})</div>
            </li>`);

            item.on('hover:enter', function () { KP_NameMatch.checkParamsAndRun(); });
            
            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'ID (цифры)', value: '3493759', free: true, nosave: true }, function (v) {
                    if (v) { KP_NameMatch.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_NameMatch.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_NameMatch.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_NameMatch.startSync(); }
                });
                return;
            }
            this.startSync();
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var card = e.data;
                    var my_score = null;

                    // 1. Попытка по ID (самая точная)
                    var kp_id = card.kp_id || card.kinopoisk_id || card.filmId || (card.ids ? card.ids.kp : null);
                    if (kp_id && KP_NameMatch.data_id[kp_id]) {
                        my_score = KP_NameMatch.data_id[kp_id];
                    }

                    // 2. Если ID нет, пробуем по Названию + Году
                    if (!my_score) {
                        var year = (card.release_date || card.first_air_date || '0000').substring(0, 4);
                        
                        // Пробуем русское название
                        var key_ru = KP_NameMatch.makeKey(card.title, year);
                        if (key_ru && KP_NameMatch.data_name[key_ru]) my_score = KP_NameMatch.data_name[key_ru];

                        // Пробуем оригинал
                        if (!my_score) {
                            var key_en = KP_NameMatch.makeKey(card.original_title || card.original_name, year);
                            if (key_en && KP_NameMatch.data_name[key_en]) my_score = KP_NameMatch.data_name[key_en];
                        }
                    }

                    // Рисуем
                    if (my_score) {
                        KP_NameMatch.drawBadge(e.card, my_score);
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

        startSync: function (silent) {
            if (this.is_running) return;
            this.is_running = true;
            
            if(!silent) Lampa.Noty.show('Обновление базы имен...');

            var page = 1;
            var total = 0;
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_NameMatch.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_NameMatch.finish('Готово', total, silent);
                            return;
                        }

                        res.items.forEach(function(item) {
                            // Данные от API
                            var fid = item.kinopoiskId || item.filmId;
                            var rating = parseInt(item.rating || item.vote || 0);
                            var nameRu = item.nameRu;
                            var nameEn = item.nameEn || item.nameOriginal;
                            var year = (item.year || '').toString();

                            if (fid && rating) {
                                // Сохраняем ID
                                KP_NameMatch.data_id[fid] = rating;

                                // Сохраняем Названия для "Умного поиска"
                                // Ключ: "горничная2025"
                                if (nameRu) KP_NameMatch.data_name[KP_NameMatch.makeKey(nameRu, year)] = rating;
                                if (nameEn) KP_NameMatch.data_name[KP_NameMatch.makeKey(nameEn, year)] = rating;
                                
                                total++;
                            }
                        });

                        if(!silent) Lampa.Noty.show('Стр ' + page + ': +' + res.items.length);
                        
                        KP_NameMatch.saveBase(); // Сохраняем сразу

                        if (res.items.length < 20) { 
                            KP_NameMatch.finish('Успешно', total, silent); 
                            return; 
                        }
                        
                        page++;
                        setTimeout(next, 300);
                    },
                    error: function(xhr) {
                        // Если ошибка при авто-запуске, молчим и пробуем позже
                        if(!silent) Lampa.Noty.show('Ошибка загрузки: ' + xhr.status);
                        KP_NameMatch.is_running = false;
                    }
                });
            };
            next();
        },

        finish: function(msg, count, silent) {
            this.is_running = false;
            $('.menu .menu__list').find('[data-action="kp_sync"] .menu__text').text('КП: Обновить (Фильмов: ' + Object.keys(this.data_id).length + ')');
            if(!silent) Lampa.Noty.show(msg + '. База обновлена.');
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_NameMatch.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_NameMatch.init(); });

})();
