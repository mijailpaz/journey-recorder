function getSelector(el) {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
  const classes = el.classList && el.classList.length ? `.${[...el.classList].join('.')}` : '';
  return `${tag}${classes}`;
}

document.addEventListener(
  'click',
  (event) => {
    try {
      const el = event.target;
      chrome.runtime.sendMessage({
        type: 'addEvent',
        event: {
          kind: 'click',
          selector: getSelector(el),
          text: (el.innerText || '').trim().substring(0, 80),
          ts: Date.now()
        }
      });
    } catch (error) {
      console.warn('Failed to capture click', error);
    }
  },
  true
);
