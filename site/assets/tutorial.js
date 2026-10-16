// Video pages: chapter and transcript buttons seek the video; tutorial.html#t=125
// starts at 2:05; the chapter being played is highlighted.
const video = document.getElementById('tutorial-video');
if (video) {
  const seek = (seconds, play = true) => {
    video.currentTime = seconds;
    if (play) video.play().catch(() => {});
  };
  for (const button of document.querySelectorAll('[data-seek]')) {
    button.addEventListener('click', () => {
      seek(Number(button.dataset.seek));
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  const start = Number(new URLSearchParams(location.hash.slice(1)).get('t'));
  if (start > 0) {
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => seek(start, false), { once: true });
  }
  const chapters = [...document.querySelectorAll('.chapters [data-seek]')];
  video.addEventListener('timeupdate', () => {
    let current = null;
    for (const button of chapters) if (Number(button.dataset.seek) <= video.currentTime + 0.25) current = button;
    for (const button of chapters) button.classList.toggle('current', button === current);
  });
}
