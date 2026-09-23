/**
 * Homepage scroll reveals for feature / bento / band cards.
 *
 * Progressive: without this script cards stay fully visible. With it,
 * `#landing-hero` gets `.has-scroll-reveal` and cards wait for
 * IntersectionObserver before `.is-in`.
 */
(function () {
  var root = document.getElementById('landing-hero');
  if (!root) return;

  var targets = root.querySelectorAll(
    '.feat-card, .bento-card, .band, .section-head, .loved',
  );
  if (!targets.length) return;

  root.classList.add('has-scroll-reveal');

  var io = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );

  for (var j = 0; j < targets.length; j++) {
    io.observe(targets[j]);
  }
})();
