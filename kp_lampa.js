(function () {
    'use strict';

    var KP_Auto = {
        data: {},
        is_running: false,
        debug_shown: false, // Флаг, чтобы показать debug только 1 раз

        params: { user_id: '', api_key: '' },

        init: function () {
            try { this.data = JSON.parse(Lampa.Storage.get('kp_auto_cache', '{}')); } catch (e) { this.data = {}; }
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');
            this.addMenu();
            this.addRenderHook();
        },

        addMenu: function () {
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg></div>
                <div class="menu__text">КП: Обновить (V15)</div>
            </li>`);
            item.on('hover:enter', function () { KP_Auto.checkParamsAndRun(); });
            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'Введите ID (цифры)', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Auto.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_Auto.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'Введите API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Auto.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_Auto.startSync(); }
                });
                return;
            }
            this.startSync();
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_Auto.data[id]) KP_Auto.drawBadge(e.card, KP_Auto.data[id]);
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
            this.debug_shown = false;
            
            Lampa.Noty.show('API: Старт...');

            var page = 1;
            var total_loaded = 0;
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Auto.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_Auto.finish('Пусто', total_loaded);
                            return;
                        }

                        // --- ОТЛАДКА: ПОКАЗАТЬ ПЕРВЫЙ ЭЛЕМЕНТ ---
                        if (!KP_Auto.debug_shown) {
                            var sample = JSON.stringify(res.items[0]).substring(0, 150); // Берем первые 150 символов
                            Lampa.Noty.show('DEBUG: ' + sample);
                            console.log('KP DEBUG:', res.items[0]);
                            KP_Auto.debug_shown = true;
                        }
                        // ----------------------------------------

                        var changes = 0;
                        res.items.forEach(function(item) {
                            // "ВСЕЯДНЫЙ" ПОИСК (Пытаемся найти ID и Оценку во всех возможных полях)
                            var filmId = item.kinopoiskId || item.filmId || item.kpId || (item.film ? item.film.filmId : null);
                            var rating = item.rating || item.vote || item.userRating || item.user_rating || null;
                            
                            if (filmId && rating && !isNaN(parseFloat(rating))) {
                                KP_Auto.data[filmId] = parseInt(rating);
                                changes++;
                            }
                        });

                        total_loaded += changes;
                        Lampa.Noty.show('Стр ' + page + ': найдено ' + changes);
                        Lampa.Storage.set('kp_auto_cache', JSON.stringify(KP_Auto.data));

                        if (res.items.length < 20) { KP_Auto.finish('Все загружено', total_loaded); return; }
                        page++;
                        setTimeout(next, 300);
                    },
                    error: function(xhr) {
                        KP_Auto.finish('Ошибка API: ' + xhr.status, total_loaded);
                    }
                });
            };
            
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. Итог: ' + Object.keys(this.data).length);
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Auto.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Auto.init(); });

})();
