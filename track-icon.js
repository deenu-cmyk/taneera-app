/* track-icon.js — adds a "Track Order" icon to the header.
   Click: scrolls to the Track Your Order box, highlights it and focuses the Order ID field. */
(function () {
  // 1) styles
  var css = '' +
    '.track-btn{color:#9C7A44}' +
    '.track-btn:hover{background:#C29D5E!important;color:#243020!important}' +
    '.track-ping{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:#C29D5E;animation:trackPing 2.4s infinite}' +
    '@keyframes trackPing{0%{box-shadow:0 0 0 0 rgba(194,157,94,.55)}70%{box-shadow:0 0 0 9px rgba(194,157,94,0)}100%{box-shadow:0 0 0 0 rgba(194,157,94,0)}}' +
    '#track-order.track-flash .track-card{animation:trackGlow 1.8s ease}' +
    '@keyframes trackGlow{0%,100%{box-shadow:0 10px 30px rgba(63,74,56,.08)}30%{box-shadow:0 0 0 4px rgba(194,157,94,.55),0 18px 44px rgba(63,74,56,.18)}}' +
    '@media(prefers-reduced-motion:reduce){.track-ping{animation:none}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // 2) action
  window.goToTrackOrder = function () {
    var hadOffer = window.location.hash.indexOf('#offer/') === 0;
    if (hadOffer) window.location.hash = '';
    setTimeout(function () {
      var sec = document.getElementById('track-order');
      if (!sec) return;
      sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sec.classList.add('track-flash');
      setTimeout(function () { sec.classList.remove('track-flash'); }, 1900);
      setTimeout(function () {
        var inp = document.getElementById('trackOrderInput');
        if (inp) inp.focus({ preventScroll: true });
      }, 700);
    }, hadOffer ? 80 : 0);
  };

  // 3) header button (inserted before the "My Orders" box icon)
  var ordersBtn = document.querySelector('.nav-actions button[onclick="openOrdersModal()"]');
  if (ordersBtn) {
    var btn = document.createElement('button');
    btn.className = 'icon-btn track-btn';
    btn.type = 'button';
    btn.title = 'Track your order';
    btn.setAttribute('aria-label', 'Track your order');
    btn.onclick = window.goToTrackOrder;
    btn.innerHTML =
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:21px;height:21px">' +
      '<path d="M12 21.5s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10.5" r="2.4"/></svg>' +
      '<span class="track-ping" aria-hidden="true"></span>';
    ordersBtn.parentNode.insertBefore(btn, ordersBtn);
  }

  // 4) mobile menu link
  var panel = document.getElementById('mobilePanel');
  if (panel) {
    var a = document.createElement('a');
    a.href = '#track-order';
    a.textContent = 'Track Order';
    a.onclick = function (e) { e.preventDefault(); panel.classList.remove('open'); window.goToTrackOrder(); };
    panel.appendChild(a);
  }
})();
