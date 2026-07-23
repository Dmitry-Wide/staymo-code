// Staymo mega-menu controller. Scoped to .mm; hooks: data-open / data-tab / data-acc. Load as <script type="module">.
(function(){
  var mm = document.querySelector('.mm');
  if(!mm) return;
  var panels = Array.prototype.slice.call(mm.querySelectorAll('.mm-panel'));
  var parentOf = { 'how-it-works':'property-owners', 'talk-to-team':'property-owners' };
  var mqMobile = window.matchMedia('(max-width: 47.9375em)');

  function setCurrent(name){
    panels.forEach(function(p){ p.classList.toggle('is-current', p.dataset.panel === name); });
    mm.dataset.current = name || '';
    var act = parentOf[name] || name;
    mm.querySelectorAll('.mm__trigger').forEach(function(t){
      t.classList.toggle('is-active', !!name && t.dataset.open === act);
    });
  }
  function openSurface(){ mm.classList.add('is-active'); if(mqMobile.matches) document.documentElement.classList.add('mm-lock'); }
  function closeAll(){ mm.classList.remove('is-active'); setCurrent(''); document.documentElement.classList.remove('mm-lock'); }

  // desktop: top-bar triggers
  mm.querySelectorAll('.mm__trigger').forEach(function(t){
    t.addEventListener('click', function(e){
      e.preventDefault();
      var name = t.dataset.open;
      if(mm.classList.contains('is-active') && mm.dataset.current === name){ closeAll(); return; }
      openSurface(); setCurrent(name);
    });
  });

  // mobile: accordion headers
  mm.querySelectorAll('.mm-panel__head[data-acc]').forEach(function(h){
    h.addEventListener('click', function(){
      var name = h.dataset.acc;
      setCurrent(mm.dataset.current === name ? '' : name);
    });
  });

  // both breakpoints: internal tab links + back
  mm.querySelectorAll('[data-tab]').forEach(function(l){
    l.addEventListener('click', function(e){
      e.preventDefault();
      openSurface(); setCurrent(l.dataset.tab);
    });
  });

  // mobile: burger
  var burger = mm.querySelector('.mm__burger');
  if(burger) burger.addEventListener('click', function(){
    if(mm.classList.contains('is-active')) closeAll();
    else { openSurface(); setCurrent(''); }
  });

  // desktop: close on outside click / Esc
  document.addEventListener('click', function(e){
    if(!mm.classList.contains('is-active') || mqMobile.matches) return;
    if(mm.contains(e.target)) return;
    closeAll();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeAll(); });

  // reset when crossing the breakpoint
  mqMobile.addEventListener('change', closeAll);

  // deep-link a panel via #mm=<name> (e.g. #mm=how-it-works, #mm=open)
  var h = (location.hash.match(/mm=([\w-]+)/) || [])[1];
  if(h){ openSurface(); if(h !== 'open') setCurrent(h); }
})();
