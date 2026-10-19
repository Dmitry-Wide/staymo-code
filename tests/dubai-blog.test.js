import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { initFAQ, initCatalogueCTA } from '../src/dubai-blog.js';

const faq = {
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question', name: 'Why Dubai?',
    acceptedAnswer: { '@type': 'Answer', text: 'A visible answer.' } }],
};
let observer;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { observer?.disconnect(); observer = undefined; });

function article(value = JSON.stringify(faq), text = 'Why Dubai? A visible answer.') {
  document.body.innerHTML = '<div data-dubai-meta="faq"></div><article data-dubai-blog-body></article>';
  document.querySelector('[data-dubai-meta]').textContent = value;
  document.querySelector('article').textContent = text;
}

describe('Dubai FAQ schema', () => {
  it('emits one valid JSON-LD only when the Q/A matches the article', () => {
    article(); initFAQ(); initFAQ();
    const scripts = document.querySelectorAll('script[data-dubai-faq]');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent)).toEqual(faq);
  });

  it.each(['', 'broken JSON', 'null', '{}', '{"@type":"FAQPage","mainEntity":[null]}'])
    ('ignores absent or malformed FAQ data: %s', value => {
      article(value); expect(() => initFAQ()).not.toThrow();
      expect(document.querySelector('script[data-dubai-faq]')).toBeNull();
    });

  it('does not mark up questions or answers missing from the visible article', () => {
    article(JSON.stringify(faq), 'Why Dubai? A different answer.'); initFAQ();
    expect(document.querySelector('script[data-dubai-faq]')).toBeNull();
  });

  it('serializes HTML-like answer text safely and preserves apostrophes', () => {
    const value = structuredClone(faq);
    value.mainEntity[0].acceptedAnswer.text = "Dubai's </script><p>answer";
    article(JSON.stringify(value), "Why Dubai? Dubai's </script><p>answer"); initFAQ();
    const script = document.querySelector('script[data-dubai-faq]');
    expect(script.textContent).not.toContain('</script>');
    expect(JSON.parse(script.textContent)).toEqual(value);
  });
});

describe('Dubai catalogue CTA', () => {
  function listing(count) {
    document.body.innerHTML = '<div data-dubai-blog-list></div><div data-cta-template><a id="source-id" href="/dubai">Dubai CTA</a></div>';
    const list = document.querySelector('[data-dubai-blog-list]');
    list.innerHTML = '<div>Article</div>'.repeat(count);
    return list;
  }

  it('inserts one CTA in slot seven and preserves the Dubai link', () => {
    const list = listing(9); observer = initCatalogueCTA(); initCatalogueCTA();
    expect(list.querySelectorAll('[data-dubai-cta]')).toHaveLength(1);
    expect(list.children[6].hasAttribute('data-dubai-cta')).toBe(true);
    expect(list.children[6].querySelector('a').getAttribute('href')).toBe('/dubai');
    expect(list.querySelector('[id]')).toBeNull();
    expect(document.querySelector('[data-cta-template]')).not.toBeNull();
  });

  it('restores one CTA after filtering replaces all cards', async () => {
    const list = listing(9); observer = initCatalogueCTA();
    list.innerHTML = '<div>Filtered article</div>'.repeat(2);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(list.children).toHaveLength(3);
    expect(list.children[2].hasAttribute('data-dubai-cta')).toBe(true);
    expect(list.querySelectorAll('[data-dubai-cta]')).toHaveLength(1);
  });
});
