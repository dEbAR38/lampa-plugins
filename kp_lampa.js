(function () {
    'use strict';

    var KP_Max = {
        data: {},
        is_running: false,

        params: {
            user_id: '',
            api_key: ''
        },

        init: function () {
            try { this.data = JSON.parse(Lampa.Storage.get('kp_auto_cache', '{}')); } catch (e) { this.data = {}; }
            this.params.user_id = Lampa.Storage.get('kp_user_id', '');
            this.params.api_key = Lampa.Storage.get('kp_api_key', '');

            this.addMenu();
            this.addRenderHook();
            
            // Попытка скрыть ошибку от чужого плагина
            this.hideErrors();
        },

        hideErrors: function() {
            // Периодически проверяем и скрываем текст "авторизация не удалась"
            setInterval(function(){
                $('.card__rating').each(function(){
                    if($(this).text().indexOf('не удалась') > -1) $(this).hide();
                });
            }, 2000);
        },

        addMenu: function () {
            var item = $(`
            <li class="menu__item selector" data-action="kp_sync">
                <div class="menu__ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" style="width:1.5em;height:1.5em">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
                    </svg>
                </div>
                <div class="menu__text">КП: Полная синхронизация</div>
            </li>`);

            item.on('hover:enter', function () { KP_Max.checkParamsAndRun(); });

            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
            else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') $('.menu .menu__list').eq(0).append(item); });
        },

        checkParamsAndRun: function() {
            if (!this.params.user_id) {
                Lampa.Input.edit({ title: 'Введите ID (цифры)', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Max.params.user_id = v; Lampa.Storage.set('kp_user_id', v); KP_Max.checkParamsAndRun(); }
                });
                return;
            }
            if (!this.params.api_key) {
                Lampa.Input.edit({ title: 'Введите API Key', value: '', free: true, nosave: true }, function (v) {
                    if (v) { KP_Max.params.api_key = v; Lampa.Storage.set('kp_api_key', v); KP_Max.startSync(); }
                });
                return;
            }
            this.startSync();
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var id = (e.data.kp_id || e.data.id);
                    if (id && KP_Max.data[id]) {
                        KP_Max.drawBadge(e.card, KP_Max.data[id]);
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
            if (this.is_running) return Lampa.Noty.show('Обновление уже идет...');
            this.is_running = true;
            Lampa.Noty.show('Сканирование (Медленный режим)...');

            var page = 1;
            var total_loaded = 0;
            var base_url = 'https://kinopoiskapiunofficial.tech/api/v1/kp_users/' + this.params.user_id + '/votes';
            var retry_count = 0;

            var next = function() {
                $.ajax({
                    url: base_url + '?page=' + page,
                    type: 'GET',
                    headers: { 'X-API-KEY': KP_Max.params.api_key },
                    success: function (res) {
                        retry_count = 0; // Сброс счетчика ошибок

                        if (!res.items || res.items.length === 0) {
                            KP_Max.finish('Готово', total_loaded);
                            return;
                        }

                        var changes = 0;
                        res.items.forEach(function(item) {
                            var filmId = item.kinopoiskId || item.filmId || item.kpId || (item.film ? item.film.filmId : null);
                            var rating = item.rating || item.vote || item.userRating || item.user_rating || null;
                            
                            if (filmId && rating && !isNaN(parseFloat(rating))) {
                                KP_Max.data[filmId] = parseInt(rating);
                                changes++;
                            }
                        });

                        total_loaded += changes;
                        Lampa.Noty.show('Стр ' + page + ': +' + changes + ' (Всего: ' + total_loaded + ')');
                        Lampa.Storage.set('kp_auto_cache', JSON.stringify(KP_Max.data));

                        // Если страница не полная, значит конец
                        if (res.items.length < 20) {
                            KP_Max.finish('Успешно завершено', total_loaded);
                            return;
                        }

                        page++;
                        // Делаем паузу 0.6 сек (чуть медленнее, чтобы не терять пакеты)
                        setTimeout(next, 600);
                    },
                    error: function(xhr) {
                        if (xhr.status === 404 || xhr.status === 401) {
                            KP_Max.finish('Ошибка ID или Ключа', total_loaded);
                        } else {
                            // Если ошибка сети, пробуем ту же страницу еще раз (до 3 раз)
                            retry_count++;
                            if (retry_count < 3) {
                                Lampa.Noty.show('Сбой на стр ' + page + '. Повтор...');
                                setTimeout(next, 3000);
                            } else {
                                // Пропускаем страницу, если она битая
                                Lampa.Noty.show('Пропуск страницы ' + page);
                                page++;
                                retry_count = 0;
                                setTimeout(next, 1000);
                            }
                        }
                    }
                });
            };
            
            next();
        },

        finish: function(msg, count) {
            this.is_running = false;
            Lampa.Noty.show(msg + '. В базе: ' + Object.keys(this.data).length);
            if (Lampa.Activity.active().activity) Lampa.Activity.active().activity.render();
        }
    };

    if (window.appready) KP_Max.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Max.init(); });

})();
