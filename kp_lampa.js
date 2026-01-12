(function () {
    'use strict';

    var KP_Smart = {
        data_id: {},
        data_name: {},
        params: { user_id: '', api_key: '' },
        is_running: false,

        init: function () {
            // Пытаемся восстановить базу из памяти
            this.loadBase();
            
            // Если база пустая, пробуем восстановить из "вечного" хранилища Lampa (если доступно)
            if (Object.keys(this.data_id).length === 0) {
                 try { 
                    var backup = localStorage.getItem('kp_backup_persistent'); 
                    if(backup) {
                        var parsed = JSON.parse(backup);
                        this.data_id = parsed.ids;
                        this.data_name = parsed.names;
                    }
                 } catch(e){}
            }

            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            this.addMenu();
            this.addRenderHook();
        },

        loadBase: function() {
            try { 
                var raw = JSON.parse(Lampa.Storage.get('kp_smart_base', '{}'));
                this.data_id = raw.ids || {};
                this.data_name = raw.names || {};
            } catch (e) { this.data_id = {}; this.data_name = {}; }
        },

        saveBase: function() {
            var dump = { ids: this.data_id, names: this.data_name };
            Lampa.Storage.set('kp_smart_base', JSON.stringify(dump));
            // Дублируем в localStorage напрямую (надежнее на некоторых ТВ)
            try { localStorage.setItem('kp_backup_persistent', JSON.stringify(dump)); } catch(e){}
        },

        makeKey: function(title, year) {
            if (!title) return null;
            return (title.toLowerCase().replace(/[^a-zа-я0-9]/g, '')) + (year || '');
        },

        addMenu: function () {
            var count = Object.keys(this.data_id).length;
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg></div>
                <div class="menu__text">КП: Обновить (${count})</div>
            </li>`);

            item.on('hover:enter', function () { KP_Smart.checkParamsAndRun(); });
            
            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'ID', value: '3493759', free: true, nosave: true }, function (v) {
                    if (v) { KP_Smart.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_Smart.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Smart.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_Smart.startSync(); }
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
                    // 1. По ID
                    var kp_id = card.kp_id || card.kinopoisk_id || card.filmId || (card.ids ? card.ids.kp : null);
                    if (kp_id && KP_Smart.data_id[kp_id]) my_score = KP_Smart.data_id[kp_id];
                    // 2. По Имени
                    if (!my_score) {
                        var year = (card.release_date || card.first_air_date || '0000').substring(0, 4);
                        var key_ru = KP_Smart.makeKey(card.title, year);
                        if (key_ru && KP_Smart.data_name[key_ru]) my_score = KP_Smart.data_name[key_ru];
                    }
                    if (my_score) KP_Smart.drawBadge(e.card, my_score);
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
            if (this.is_running) return;
            this.is_running = true;
            Lampa.Noty.show('Проверка обновлений...');

            var page = 1;
            var total_new = 0;
            // Флаг "Умной остановки": если True, значит база есть и мы ищем только новое
            var smart_mode = (Object.keys(this.data_id).length > 100); 

            var next = function() {
                $.ajax({
                    url: 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + KP_Smart.params.user_id + '/votes?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Smart.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_Smart.finish('Готово', total_new);
                            return;
                        }

                        var new_on_page = 0;

                        res.items.forEach(function(item) {
                            var fid = item.kinopoiskId || item.filmId;
                            var rating = parseInt(item.rating || item.vote || 0);
                            
                            // Если фильм уже есть в базе И оценка такая же — это "Старый"
                            // Если фильма нет или оценка поменялась — это "Новый"
                            if (fid && rating) {
                                if (KP_Smart.data_id[fid] !== rating) {
                                    KP_Smart.data_id[fid] = rating;
                                    
                                    // Сохраняем имена
                                    var nameRu = item.nameRu;
                                    var nameEn = item.nameEn || item.nameOriginal;
                                    var year = (item.year || '').toString();
                                    if (nameRu) KP_Smart.data_name[KP_Smart.makeKey(nameRu, year)] = rating;
                                    if (nameEn) KP_Smart.data_name[KP_Smart.makeKey(nameEn, year)] = rating;

                                    new_on_page++;
                                    total_new++;
                                }
                            }
                        });

                        // --- ЛОГИКА УМНОЙ ОСТАНОВКИ ---
                        // Если включен Умный режим, И на текущей странице 0 новых фильмов...
                        // Значит мы дошли до старых записей. Можно стопать.
                        if (smart_mode && new_on_page === 0) {
                            KP_Smart.finish('Обновлено (Быстро)', total_new);
                            return;
                        }

                        if (!smart_mode) Lampa.Noty.show('Стр ' + page + ': +' + new_on_page);
                        
                        KP_Smart.saveBase(); // Сохраняем

                        if (res.items.length < 20) { 
                            KP_Smart.finish('Загружено всё', total_new); 
                            return; 
                        }
                        
                        page++;
                        setTimeout(next, 300);
                    },
                    error: function() {
                        KP_Smart.is_running = false;
                        Lampa.Noty.show('Ошибка сети');
                    }
                });
            };
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            $('.menu .menu__list').find('[data-action="kp_sync"] .menu__text').text('КП: Обновить (' + Object.keys(this.data_id).length + ')');
            
            // Если нашли новые фильмы, покажем уведомление. Если нет - просто обновим UI.
            if(count > 0 || msg === 'Загружено всё') {
                Lampa.Noty.show(msg + '. Новых: ' + count);
            } else {
                Lampa.Noty.show('Новых оценок нет');
            }
            
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Smart.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Smart.init(); });

})();
