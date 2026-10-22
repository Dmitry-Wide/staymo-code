/* Dubai blog FAQ and catalogue CTA. No network requests or form handling.
   Contract: data-dubai-meta="faq" holds the native CMS-bound JSON text;
   data-dubai-blog-body marks the article; data-dubai-blog-list marks the list;
   data-dubai-faq-target is inside the native Schema | FAQPage HtmlEmbed;
   data-cta-template is the hidden, Designer-authored CTA source.
   CSS hides only [data-cta-template]; the clone keeps all native styles. */
export function initFAQ(root = document) {
  const carrier = root.querySelector('[data-dubai-meta="faq"]');
  const body = root.querySelector('[data-dubai-blog-body]');
  const target = root.querySelector('[data-dubai-faq-target]');
  if (!carrier || !body || !target || !carrier.textContent.trim()) return;
  let faq;
  try { faq = JSON.parse(carrier.textContent); } catch { return; }
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const visible = normalize(body.textContent);
  if (!faq || faq['@type'] !== 'FAQPage' || !Array.isArray(faq.mainEntity) || !faq.mainEntity.length) return;
  if (!faq.mainEntity.every(question => question && question['@type'] === 'Question' &&
    typeof question.name === 'string' && question.name.trim() &&
    question.acceptedAnswer?.['@type'] === 'Answer' &&
    typeof question.acceptedAnswer.text === 'string' && question.acceptedAnswer.text.trim() &&
    visible.includes(normalize(question.name)) && visible.includes(normalize(question.acceptedAnswer.text)))) return;
  if (root.querySelector('script[data-dubai-faq]')) return;
  const script = root.createElement('script');
  script.type = 'application/ld+json';
  script.dataset.dubaiFaq = '';
  script.textContent = JSON.stringify(faq).replace(/</g, '\\u003c');
  target.append(script);
}

export function initCatalogueCTA(root = document) {
  const list = root.querySelector('[data-dubai-blog-list]');
  const template = root.querySelector('[data-cta-template]');
  if (!list || !template || list.dataset.dubaiCtaReady) return;
  list.dataset.dubaiCtaReady = 'true';
  function inject() {
    const clones = [...list.querySelectorAll(':scope > [data-dubai-cta]')];
    const cards = [...list.children].filter(child => !child.hasAttribute('data-dubai-cta'));
    const target = cards[6] || null;
    if (clones.length === 1 && clones[0].nextElementSibling === target) return;
    clones.forEach(clone => clone.remove());
    const clone = template.cloneNode(true);
    clone.removeAttribute('data-cta-template');
    clone.setAttribute('data-dubai-cta', '');
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    list.insertBefore(clone, target);
  }
  const observer = new MutationObserver(inject);
  observer.observe(list, { childList: true });
  inject();
  return observer;
}

// Listing moved from /dubai-blogs to /dubai/blog (old URL 301s); accept both, with or without a trailing slash.
export const isCataloguePath = path => /^\/(dubai-blogs|dubai\/blog)\/?$/.test(path);

if (typeof document !== 'undefined') {
  const init = () => {
    if (isCataloguePath(location.pathname)) initCatalogueCTA();
    if (location.pathname.startsWith('/dubai-blog/')) initFAQ();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
