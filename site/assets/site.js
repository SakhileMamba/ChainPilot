// Every page: the mobile menu and marking the current page in the navigation.
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('site-nav');
toggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});

const page = document.body.className.match(/page-([\w-]+)/)?.[1];
const current = nav?.querySelector(`[data-nav="${page}"]`);
if (current) current.setAttribute('aria-current', 'page');
