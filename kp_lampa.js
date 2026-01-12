(function () {
    'use strict';

    var KP_System = {
        data: {},
        params: { user_id: '', api_key: '' },

        init: function () {
            // 1. Пытаемся восстановить базу
            try { this.data = JSON.parse(Lampa.Storage.get('kp_global_base', '{}')); } catch (e) { this.data = {}; }
            
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            this.addMenu();
            this.addRenderHook();
        },

        addMenu: function () {
            var count = Object.keys(this.data).length;
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" style="width:1.5em;height:1.5em"><path d="M12 2v20M2 12h20"></path></svg></div>
                <div class="menu__text">КП: Обновить (База: ${count})</div>
            </li>`);

            item.on('hover:enter', function () { KP_System.checkParamsAndRun(); });

            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'Введите ID (цифры)', value: '3493759', free: true, nosave: true }, function (v) {
                    if (v) { KP_System.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_System.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'Введите API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_System.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_System.startSync(); }
                });
                return;
            }
            this.startSync();
        },

        // --- ГЛАВНАЯ ПРОБЛЕМА: ID ---
        // Lampa часто не знает KP_ID. Пытаемся найти его везде.
        getKpId: function(card) {
            return card.kp_id || 
                   card.kinopoisk_id || 
                   card.filmId || 
                   (card.ids ? card.ids.kp : null) || 
                   (card.external_ids ? card.external_ids.kinopoisk_id : null);
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var card = e.data;
                    var kp_id = KP_System.getKpId(card);
                    
                    // Рисуем бейдж, если есть совпадение
                    if (kp_id && KP_System.data[kp_id]) {
                        KP_System.drawBadge(e.card, KP_System.data[kp_id]);
                    }

                    // ДИАГНОСТИКА: При долгом нажатии показываем, что видит Lampa
                    e.card.on('long:enter', function() {
                        var info = 'TMDB: ' + (card.id || 'Net') + ' | KP_ID: ' + (kp_id || 'НЕТ!');
                        var rating_info = (kp_id && KP_System.data[kp_id]) ? (' ✅ Оценка: ' + KP_System.data[kp_id]) : ' ❌ Нет в базе';
                        Lampa.Noty.show(info + rating_info);
                    });
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
            Lampa.Noty.show('Скачиваем оценки...');
            var page = 1;
            var total_loaded = 0;
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_System.params.api_key },
                    success: function (res) {
                        if (!res.items || res.items.length === 0) {
                            KP_System.finish('Готово', total_loaded);
                            return;
                        }
                        res.items.forEach(function(item) {
                            var filmId = item.kinopoiskId || item.filmId || item.kpId || (item.film ? item.film.filmId : null);
                            var rating = item.rating || item.vote || item.userRating || item.user_rating || null;
                            if (filmId && rating) KP_System.data[filmId] = parseInt(rating);
                        });

                        total_loaded += res.items.length;
                        Lampa.Noty.show('Загружено: ' + total_loaded);
                        
                        // Сохраняем в НОВОЕ хранилище kp_global_base
                        Lampa.Storage.set('kp_global_base', JSON.stringify(KP_System.data));

                        if (res.items.length < 20) { KP_System.finish('Успех', total_loaded); return; }
                        page++;
                        setTimeout(next, 300);
                    },
                    error: function(xhr) {
                        if(xhr.status === 404 || xhr.status === 401) {
                            Lampa.Storage.set('kp_user_id', ''); Lampa.Storage.set('kp_api_key', '');
                            Lampa.Noty.show('Ошибка: Неверный ID или Ключ!');
                        } else setTimeout(next, 2000);
                    }
                });
            };
            next();
        },

        finish: function(msg, count) {
            Lampa.Noty.show(msg + '. Всего: ' + Object.keys(this.data).length);
            // Обновляем название кнопки в меню
            $('.menu .menu__list').find('[data-action="kp_sync"] .menu__text').text('КП: Обновить (База: ' + Object.keys(this.data).length + ')');
        }
    };

    if (window.appready) KP_System.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_System.init(); });
})();
