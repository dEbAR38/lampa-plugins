(function () {
    'use strict';

    var KP_Titan = {
        data_id: {},
        data_name: {},
        params: { user_id: '', api_key: '' },
        is_running: false,

        init: function () {
            // 1. АГРЕССИВНАЯ ЗАГРУЗКА
            // Читаем напрямую из памяти браузера, минуя кэш Лампы
            this.loadDirect();

            // Если все равно пусто - пробуем стандартный метод
            if (Object.keys(this.data_id).length === 0) {
                 try { 
                    var raw = JSON.parse(Lampa.Storage.get('kp_smart_base', '{}'));
                    this.data_id = raw.ids || {};
                    this.data_name = raw.names || {};
                 } catch(e) {}
            }

            // Настройки
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            this.addMenu();
            this.addRenderHook();
            
            // Если база есть, выводим уведомление при старте
            var count = Object.keys(this.data_id).length;
            if (count > 0) {
                console.log('KP: Loaded ' + count + ' items from storage');
            }
        },

        // Прямое чтение из localStorage
        loadDirect: function() {
            try {
                var json = localStorage.getItem('kp_titan_storage');
                if (json) {
                    var parsed = JSON.parse(json);
                    this.data_id = parsed.ids || {};
                    this.data_name = parsed.names || {};
                }
            } catch(e) {}
        },

        // Прямая запись (Железобетонное сохранение)
        saveDirect: function() {
            var dump = { ids: this.data_id, names: this.data_name };
            var str = JSON.stringify(dump);
            
            // 1. Стандартный метод
            Lampa.Storage.set('kp_smart_base', str);
            
            // 2. Прямой метод (надежнее)
            try { localStorage.setItem('kp_titan_storage', str); } catch(e) {}
        },

        makeKey: function(title, year) {
            if (!title) return null;
            return (title.toLowerCase().replace(/[^a-zа-я0-9]/g, '')) + (year || '');
        },

        addMenu: function () {
            var count = Object.keys(this.data_id).length;
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></div>
                <div class="menu__text">КП: Обновить (${count})</div>
            </li>`);

            item.on('hover:enter', function () { KP_Titan.checkParamsAndRun(); });
            
            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'ID (цифры)', value: '3493759', free: true, nosave: true }, function (v) {
                    if (v) { KP_Titan.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_Titan.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Titan.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_Titan.startSync(); }
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
                    if (kp_id && KP_Titan.data_id[kp_id]) my_score = KP_Titan.data_id[kp_id];
                    
                    // 2. По Имени (если нет ID)
                    if (!my_score) {
                        var year = (card.release_date || card.first_air_date || '0000').substring(0, 4);
                        var key_ru = KP_Titan.makeKey(card.title, year);
                        if (key_ru && KP_Titan.data_name[key_ru]) my_score = KP_Titan.data_name[key_ru];
                    }

                    if (my_score) KP_Titan.drawBadge(e.card, my_score);
                }
            });
        },

        drawBadge: function (card, score) {
            // Удаляем старые бейджи от других плагинов, если они мешают
            if (card.find('.kp-badge').length) return;
            
            var color = score >= 7 ? '#27ae60' : (score >= 5 ? '#7f8c8d' : '#c0392b');
            var badge = `<div class="kp-badge" style="position: absolute;top: 0.4em;right: 0.4em;background: ${color};color: #fff;width: 1.6em;height: 1.6em;line-height: 1.6em;text-align: center;border-radius: 50%;font-weight: 800;font-size: 0.9em;box-shadow: 1px 1px 4px rgba(0,0,0,0.8);z-index: 10;pointer-events: none;">${score}</div>`;
            card.find('.card__view').append(badge);
        },

        startSync: function () {
            if (this.is_running) return;
            this.is_running = true;
            Lampa.Noty.show('Синхронизация...');

            var page = 1;
            var total_new = 0;
            var smart_mode = (Object.keys(this.data_id).length > 100); 

            var next = function() {
                $.ajax({
                    url: 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + KP_Titan.params.user_id + '/votes?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Titan.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_Titan.finish('Готово', total_new);
                            return;
                        }

                        var new_on_page = 0;
                        res.items.forEach(function(item) {
                            var fid = item.kinopoiskId || item.filmId;
                            var rating = parseInt(item.rating || item.vote || 0);
                            
                            if (fid && rating) {
                                if (KP_Titan.data_id[fid] !== rating) {
                                    KP_Titan.data_id[fid] = rating;
                                    
                                    var nameRu = item.nameRu;
                                    var nameEn = item.nameEn || item.nameOriginal;
                                    var year = (item.year || '').toString();
                                    if (nameRu) KP_Titan.data_name[KP_Titan.makeKey(nameRu, year)] = rating;
                                    if (nameEn) KP_Titan.data_name[KP_Titan.makeKey(nameEn, year)] = rating;

                                    new_on_page++;
                                    total_new++;
                                }
                            }
                        });

                        if (smart_mode && new_on_page === 0) {
                            KP_Titan.finish('Обновлено (Быстро)', total_new);
                            return;
                        }

                        if (!smart_mode) Lampa.Noty.show('Стр ' + page + ': +' + new_on_page);
                        
                        KP_Titan.saveDirect(); // Сохраняем надежно

                        if (res.items.length < 20) { 
                            KP_Titan.finish('Загружено всё', total_new); 
                            return; 
                        }
                        
                        page++;
                        setTimeout(next, 300);
                    },
                    error: function() {
                        KP_Titan.is_running = false;
                        Lampa.Noty.show('Ошибка сети');
                    }
                });
            };
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            $('.menu .menu__list').find('[data-action="kp_sync"] .menu__text').text('КП: Обновить (' + Object.keys(this.data_id).length + ')');
            Lampa.Noty.show(msg + '. Новых: ' + count);
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Titan.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Titan.init(); });

})();
