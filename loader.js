(function () {
    'use strict';
    
    // Ссылка на твой ОСНОВНОЙ файл с кодом
    // ВАЖНО: Замени debar38 на свой ник, если он другой
    var plugin_url = 'https://debar38.github.io/lampa-plugins/kp_lampa.js';

    // Добавляем к ссылке текущее время (?v=123456789)
    // Это заставляет телевизор думать, что файл новый, и качать его заново
    var script = document.createElement('script');
    script.src = plugin_url + '?v=' + Date.now(); 
    script.async = true;
    script.type = 'text/javascript';
    
    document.body.appendChild(script);
})();
