(function () {
    'use strict';

    var KP_Debug = {
        data: {},
        
        init: function () {
            // Загружаем базу
            try { this.data = JSON.parse(Lampa.Storage.get('kp_auto_cache', '{}')); } catch (e) {}
            
            // Настройки (чтобы не сбились)
            if(!Lampa.Storage.get('kp_user_id', '')) this.restoreSettings();

            this.addMenu();
            this.addRenderHook();
        },

        restoreSettings: function() {
            // Если вдруг настройки слетели, создаем заглушку, чтобы меню работало
            Lampa.Storage.set('kp_user_id', 'placeholder'); 
        },

        addMenu: function () {
            var item = $(`<li class="menu__item selector"><div class="menu__text">КП: (База: ${Object.keys(this.data).length})</div></li>`);
            if ($('.menu .menu__list').length) $('.menu .menu__list').eq(0).append(item);
        },

        addRenderHook: function () {
            Lampa.Listener.follow('card', function (e) {
                if (e.type == 'render') {
                    var card = e.data;
                    
                    // --- ПОИСК ID (Все возможные варианты) ---
                    // Lampa хранит ID КиноПоиска в разных местах в зависимости от источника
                    var kp_id = card.kp_id || card.kinopoisk_id || card.filmId || (card.ids ? card.ids.kp : null);
                    
                    // Если нашли ID в базе
                    if (kp_id && KP_Debug.data[kp_id]) {
                        KP_Debug.drawBadge(e.card, KP_Debug.data[kp_id]);
                    }

                    // --- ДИАГНОСТИКА ПО НАВЕДЕНИЮ ---
                    e.card.on('hover:enter', function() {
                        var info = `TMDB: ${card.id || 'Нет'} | KP: ${kp_id || 'НЕТ!'}`;
                        var has_rating = (kp_id && KP_Debug.data[kp_id]) ? ('✅ Оценка: ' + KP_Debug.data[kp_id]) : '❌ Нет оценки';
                        
                        Lampa.Noty.show(info + ' | ' + has_rating);
                    });
                }
            });
        },

        drawBadge: function (card, score) {
            if (card.find('.kp-badge').length) return;
            var color = score >= 7 ? '#27ae60' : (score >= 5 ? '#7f8c8d' : '#c0392b');
            var badge = `<div class="kp-badge" style="position: absolute;top: 0.4em;right: 0.4em;background: ${color};color: #fff;width: 1.6em;height: 1.6em;line-height: 1.6em;text-align: center;border-radius: 50%;font-weight: 800;font-size: 0.9em;box-shadow: 1px 1px 4px rgba(0,0,0,0.8);z-index: 5;pointer-events: none;">${score}</div>`;
            card.find('.card__view').append(badge);
        }
    };

    if (window.appready) KP_Debug.init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') KP_Debug.init(); });

})();
