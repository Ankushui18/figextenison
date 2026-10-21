#!/usr/bin/env node
/* Render the shipped wireframe transform to an SVG, so the output can be reviewed
 * without a browser. Development aid only: not shipped in the extension. */
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'extension');
const Core = (() => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'js/wireframe-core.js'), 'utf8'), context);
  return context.PageCaptureWireframeCore;
})();

const el = (id, tag, rect, styles = {}, childNodes = [], attributes = {}) => ({
  nodeType: 1, id, tag, attributes, styles, rect, childNodes
});
const text = (id, value, rect, lineCount = 1) => ({ nodeType: 3, id, text: value, rect, lineCount });

/* A synthetic page shaped like the Dribbble screen this extension is tested
 * against: sticky nav, promo pill, hero copy plus a dark media card, tab row,
 * search field, chip row, a 4-up grid of shot cards (image thumbnails with a dark
 * hover scrim, a PRO badge and a caption row), category tiles and a footer.
 * The scrims are the point: in greyscale they used to become grey slabs. */
function page() {
  const W = 1280;
  const PINK = 'rgb(234, 76, 137)';
  const INK = 'rgb(13, 13, 13)';
  const LINE = 'rgb(228, 231, 236)';
  const shots = [
    ['AI Health Assistant Mobile App Design', 'Artpump', '139', '4.8k'],
    ['App icon for TechWell', 'Mike Dolgushin', '80', '7k'],
    ['Build stunning sites with Framer Agents', 'Framer', '165', '10.4k'],
    ['Branding & Visual Identity', 'Madison Bernhardt', '197', '6.2k'],
    ['One platform to streamline your agency business.', 'Bonzo', '104', '4.4k'],
    ['Retro Park Logo', 'Lucian Rocks', '19', '4.6k'],
    ['Alex Toss, logo design', 'Alex Toss', '62', '8.2k'],
    ['Product design for fintech', 'Ramón Pérez', '104', '8.3k'],
    ['Zenoscope', 'Zenoscope Studio', '119', '8.8k'],
    ['One Week Wonders', 'One Week Wonders', '61', '11.4k'],
    ['Dashboard components', 'One Week Wonders', '61', '8.4k'],
    ['Nicolò Zanasi', 'Nicolò Zanasi', '127', '5.4k']
  ];
  const columns = 4, cardW = 292, cardH = 300, gapX = 8, gapY = 28, gridX = 32, gridY = 792;
  const cards = [];
  shots.forEach(([title, author, likes, views], index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const x = gridX + column * (cardW + gapX);
    const y = gridY + row * (cardH + gapY);
    cards.push(el(`shot-${index}`, 'LI', { x, y, width: cardW, height: cardH }, { listStyleType: 'none' }, [
      el(`shot-link-${index}`, 'a', { x, y, width: cardW, height: cardW * 0.75 }, { display: 'block' }, [
        // The thumbnail is a background-image div on some cards and an <img> on
        // others; both are media.
        index % 3 === 2
          ? el(`shot-img-${index}`, 'IMG', { x, y, width: cardW, height: cardW * 0.75 },
            { borderRadius: '10px', objectFit: 'cover' }, [], { attributes: { alt: title } })
          : el(`shot-thumb-${index}`, 'DIV', { x, y, width: cardW, height: cardW * 0.75 },
            { backgroundImage: `url(https://cdn.dribbble.com/shots/${index}.png)`, backgroundSize: 'cover', borderRadius: '10px' }, []),
        // Dribbble's hover scrim: dark, 80% alpha, no content of its own.
        el(`shot-scrim-${index}`, 'DIV', { x, y, width: cardW * 0.55, height: cardW * 0.75 },
          { backgroundColor: 'rgba(13, 13, 13, 0.8)', borderRadius: '10px 0 0 10px' }, []),
        // The PRO badge is the same shape but a fraction of the area: it stays.
        el(`shot-pro-${index}`, 'DIV', { x: x + 8, y: y + 8, width: 46, height: 22 },
          { backgroundColor: 'rgba(0, 0, 0, 0.5)', borderRadius: '6px' }, [
            text(`shot-pro-label-${index}`, 'PRO', { x: x + 14, y: y + 12, width: 30, height: 14 })
          ])
      ]),
      el(`shot-caption-${index}`, 'DIV', { x, y: y + cardW * 0.75 + 8, width: cardW, height: 44 }, {}, [
        el(`shot-avatar-${index}`, 'IMG', { x, y: y + cardW * 0.75 + 10, width: 24, height: 24 },
          { borderRadius: '50%' }, [], { attributes: { alt: author } }),
        text(`shot-title-${index}`, title, { x: x + 32, y: y + cardW * 0.75 + 12, width: cardW - 120, height: 18 }),
        text(`shot-meta-${index}`, `${likes}  ${views}`, { x: x + cardW - 92, y: y + cardW * 0.75 + 12, width: 84, height: 18 })
      ])
    ]));
  });

  const categories = ['Web Design', 'Mobile', 'Branding', 'Print', 'Typography', 'Illustration', 'Product Design'];
  const categoryRow = categories.map((label, index) => {
    const x = 32 + index * 176, y = 1806;
    return el(`category-${index}`, 'a', { x, y, width: 160, height: 140 }, {}, [
      el(`category-tile-${index}`, 'DIV', { x, y, width: 160, height: 108 },
        { backgroundImage: `url(https://cdn.dribbble.com/categories/${index}.png)`, backgroundSize: 'cover', borderRadius: '8px' }, []),
      text(`category-label-${index}`, label, { x, y: y + 116, width: 140, height: 18 })
    ]);
  });

  return {
    version: 2, assets: {}, fonts: [], documentTitle: 'Dribbble — Discover the World’s Top Designers',
    root: el('root', 'BODY', { x: 0, y: 0, width: W, height: 2200 },
      { backgroundColor: 'rgb(255, 255, 255)', color: INK, fontSize: '16px', lineHeight: '24px', fontFamily: 'Mona Sans, Helvetica, sans-serif' }, [
        el('nav', 'NAV', { x: 0, y: 0, width: W, height: 72 },
          { backgroundColor: 'rgb(255, 255, 255)', position: 'sticky', zIndex: '10' }, [
            el('logo', 'a', { x: 32, y: 24, width: 92, height: 28 }, { color: PINK }, [
              text('logo-text', 'Dribbble', { x: 32, y: 26, width: 90, height: 24 })
            ]),
            text('nav-links', 'Explore      Hire Talent      Get Hired      Community', { x: 150, y: 28, width: 520, height: 20 }),
            el('nav-signup', 'BUTTON', { x: 1010, y: 20, width: 74, height: 32 },
              { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '8px' }, [
                text('nav-signup-label', 'Sign up', { x: 1022, y: 27, width: 52, height: 18 })
              ]),
            el('nav-login', 'BUTTON', { x: 1094, y: 20, width: 74, height: 32 },
              { backgroundColor: INK, color: 'rgb(255, 255, 255)', borderRadius: '8px' }, [
                text('nav-login-label', 'Log In', { x: 1110, y: 27, width: 44, height: 18 })
              ]),
            // a closed dropdown: not on the page, so not in the wireframe
            el('nav-menu', 'DIV', { x: 150, y: 72, width: 320, height: 320 },
              { display: 'none', backgroundColor: 'rgb(255, 255, 255)' }, [
                text('nav-menu-item', 'Hidden nav panel', { x: 166, y: 96, width: 200, height: 20 })
              ])
          ]),
        el('promo', 'DIV', { x: 32, y: 88, width: W - 64, height: 44 },
          { backgroundColor: 'rgb(255, 241, 246)', borderRadius: '22px' }, [
            text('promo-text', 'Get 20% off your first payment for design and development services on Dribbble 💸 Use code WELCOME20', { x: 260, y: 100, width: 620, height: 20 }),
            el('promo-cta', 'a', { x: 892, y: 100, width: 86, height: 20 }, { color: INK }, [
              text('promo-cta-label', 'Get Started', { x: 892, y: 100, width: 84, height: 18 })
            ]),
            el('promo-close', 'BUTTON', { x: 1216, y: 100, width: 16, height: 16 }, {}, [])
          ]),
        el('audience', 'DIV', { x: 32, y: 168, width: 300, height: 28 }, {}, [
          el('audience-hire', 'a', { x: 32, y: 168, width: 96, height: 26 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '6px' }, [
              text('audience-hire-label', 'HIRE TALENT', { x: 42, y: 173, width: 78, height: 16 })
            ]),
          el('audience-get', 'a', { x: 136, y: 168, width: 92, height: 26 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '6px' }, [
              text('audience-get-label', 'GET HIRED', { x: 146, y: 173, width: 74, height: 16 })
            ])
        ]),
        el('h1', 'H1', { x: 32, y: 214, width: 560, height: 132 },
          { fontSize: '56px', fontWeight: '700', lineHeight: '64px', color: INK }, [
            text('h1-line1', 'Work with the world’s', { x: 32, y: 214, width: 540, height: 64 }),
            el('h1-line2', 'SPAN', { x: 32, y: 278, width: 300, height: 64 }, { color: PINK }, [
              text('h1-line2-text', 'best in web design', { x: 32, y: 278, width: 296, height: 60 })
            ])
          ]),
        el('benefits', 'UL', { x: 32, y: 366, width: 520, height: 96 }, {}, [
          'Generate your brief and receive proposals for free.',
          'Browse real design and development work.',
          'Hire top-rated freelancers and agencies.'
        ].map((copy, index) => el(`benefit-${index}`, 'LI', { x: 32, y: 366 + index * 32, width: 520, height: 24 }, {}, [
          el(`benefit-check-${index}`, 'SVG', { x: 32, y: 370 + index * 32, width: 16, height: 16 }, { fill: PINK }, []),
          text(`benefit-${index}-text`, copy, { x: 58, y: 368 + index * 32, width: 470, height: 20 })
        ]))),
        el('hero-cta', 'BUTTON', { x: 32, y: 494, width: 200, height: 44 },
          { backgroundColor: INK, color: 'rgb(255, 255, 255)', borderRadius: '22px' }, [
            text('hero-cta-label', 'Start Your Project Brief', { x: 54, y: 506, width: 166, height: 20 })
          ]),
        // The hero media card: a dark surface that holds an image, not a grey slab.
        el('hero-card', 'DIV', { x: 700, y: 168, width: 548, height: 400 },
          { backgroundColor: 'rgb(10, 10, 10)', borderRadius: '24px', overflow: 'hidden' }, [
            el('hero-orb', 'IMG', { x: 900, y: 300, width: 150, height: 150 }, { borderRadius: '50%' }, [],
              { attributes: { alt: 'Listening orb' } }),
            el('hero-scrim', 'DIV', { x: 700, y: 168, width: 548, height: 400 },
              { backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.6), rgba(0,0,0,0))' }, []),
            el('hero-author', 'IMG', { x: 1080, y: 500, width: 36, height: 36 }, { borderRadius: '50%' }, [],
              { attributes: { alt: 'Michael Franklin' } })
          ]),
        el('tabs', 'DIV', { x: 32, y: 616, width: 340, height: 40 }, {}, [
          el('tab-shots', 'BUTTON', { x: 32, y: 616, width: 92, height: 36 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '18px' }, [
              text('tab-shots-label', 'Shots', { x: 60, y: 626, width: 44, height: 18 })
            ]),
          el('tab-designers', 'BUTTON', { x: 132, y: 616, width: 112, height: 36 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '18px' }, [
              text('tab-designers-label', 'Designers', { x: 158, y: 626, width: 74, height: 18 })
            ]),
          el('tab-services', 'BUTTON', { x: 252, y: 616, width: 104, height: 36 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '18px' }, [
              text('tab-services-label', 'Services', { x: 276, y: 626, width: 62, height: 18 })
            ])
        ]),
        el('search', 'DIV', { x: 32, y: 664, width: W - 64, height: 48 },
          { backgroundColor: 'rgb(250, 250, 250)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '24px' }, [
            text('search-label', 'What type of design are you interested in?', { x: 56, y: 678, width: 380, height: 20 }),
            el('search-go', 'BUTTON', { x: 1200, y: 676, width: 24, height: 24 }, { backgroundColor: PINK, borderRadius: '50%' }, [])
          ]),
        el('chips', 'DIV', { x: 32, y: 724, width: W - 64, height: 32 }, {}, [
          ...['Popular', 'dashboard', 'landing page', 'mobile app', 'portfolio', 'ecommerce', 'animation', 'illustration'].map((label, index) =>
            text(`chip-${index}`, label, { x: 36 + index * 118, y: 728, width: 104, height: 18 })),
          el('chips-sort', 'BUTTON', { x: 1160, y: 726, width: 88, height: 26 },
            { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE, borderRadius: '6px' }, [
              text('chips-sort-label', 'Popular', { x: 1172, y: 731, width: 60, height: 16 })
            ])
        ]),
        ...cards,
        el('categories', 'DIV', { x: 32, y: 1806, width: W - 64, height: 140 }, {}, categoryRow),
        el('footer', 'FOOTER', { x: 0, y: 1990, width: W, height: 170 },
          { backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: LINE }, [
            text('footer-logo', 'Dribbble', { x: 32, y: 2032, width: 90, height: 24 }),
            text('footer-links', 'For designers   Hire talent   Inspiration   Advertising   Blog   About   Support', { x: 300, y: 2036, width: 640, height: 20 }),
            text('footer-legal', '© 2026 Dribbble   Terms   Privacy   Cookies', { x: 32, y: 2110, width: 420, height: 18 }),
            text('footer-more', 'Jobs   Tags   Places   Resources', { x: 940, y: 2110, width: 320, height: 18 })
          ])
      ])
  };
}

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = value => Math.round(Number(value) * 10) / 10;

function render(doc, label) {
  const width = doc.root.rect.width, height = doc.root.rect.height;
  const out = [];
  const walk = node => {
    if (node.nodeType === 3) {
      const styles = node.parentStyles || {};
      const size = parseFloat(styles.fontSize || 14);
      const lineHeight = parseFloat(styles.lineHeight || size * 1.4);
      const lines = String(node.text || '').split(/\n/);
      // Wrap to the measured box so the preview shows plausible line breaks.
      const charsPerLine = Math.max(8, Math.floor(node.rect.width / (size * 0.52)));
      const wrapped = [];
      for (const line of lines) {
        let current = '';
        for (const word of line.split(/\s+/)) {
          if ((current + ' ' + word).trim().length > charsPerLine && current) { wrapped.push(current); current = word; }
          else current = (current + ' ' + word).trim();
        }
        if (current) wrapped.push(current);
      }
      wrapped.slice(0, 12).forEach((line, index) => {
        out.push(`<text x="${num(node.rect.x)}" y="${num(node.rect.y + index * lineHeight + size * 0.92)}" font-family="${esc(styles.fontFamily || 'Inter, Arial')}" font-size="${num(size)}" font-weight="${esc(String(styles.fontWeight || 400))}" fill="${esc(styles.color || '#222')}">${esc(line)}</text>`);
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const styles = node.styles || {};
    const rect = node.rect || { x: 0, y: 0, width: 1, height: 1 };
    if (!rect.width || !rect.height) return;
    const fill = styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? styles.backgroundColor : 'none';
    const strokeWidth = parseFloat(styles.borderTopWidth || 0) || 0;
    const stroke = styles.borderTopStyle && styles.borderTopStyle !== 'none' && strokeWidth > 0 ? (styles.borderTopColor || '#d0d0d0') : 'none';
    const radius = parseFloat(styles.borderTopLeftRadius || 0) || 0;
    out.push(`<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" rx="${num(radius)}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${num(strokeWidth)}"/>`);
    for (const child of node.childNodes || []) { child.parentStyles = styles; walk(child); }
  };
  walk(doc.root);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<g>${out.join('')}</g>
<text x="12" y="18" font-family="monospace" font-size="11" fill="#999">${esc(label)}</text>
</svg>`;
}

const level = process.argv[2] || 'medium';
const target = process.argv[3] || '/tmp/wireframe-preview.svg';
const result = Core.transformDocument(page(), { level });
fs.writeFileSync(target, render(result.document, `${level} · ${JSON.stringify(Core.summarize(result))}`));
console.log(target, JSON.stringify(Core.summarize(result)));
