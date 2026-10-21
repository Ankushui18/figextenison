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

/* A synthetic page with the same shape as the Dribbble screen: sticky nav, hero
 * with an image, promo pill, filter chips, a 4-up card grid of image-backed
 * thumbnails, a dark quote band and a coloured footer strip. */
function page() {
  const W = 1200;
  const cards = [];
  const titles = [
    'AI Health Assistant Mobile App Design', 'App icon for TechWell', 'Build stunning sites with Framer Agents',
    'Zenith — Logo design proposal', 'One platform', 'Retro Park Logo', 'Cloud Design for web brands',
    'Cloud Design & Visual Identity Pt 2', 'Bonzo', 'Lucian Rocks', 'Alex Toss, logo design',
    'Ramonzon', 'K. Arrow, Speed, Minimal Logo', '3D Motion Design — Coffee, Brainstorm', 'Healthcare Dashboard of Components']
  titles.forEach((title, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 40 + column * 285;
    const y = 370 + row * 330;
    cards.push(el(`card-${index}`, 'DIV', { x, y, width: 265, height: 300 },
      { backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '0px' }, [
        // Thumbnail is a div with a background image in the real page.
        el(`thumb-${index}`, 'DIV', { x: x + 8, y: y + 8, width: 249, height: 190 },
          { backgroundImage: `url(https://cdn.example/${index}.png)`, borderTopLeftRadius: '10px' }, []),
        // A faint overlay sits on top of several cards.
        ...(index % 3 === 0 ? [el(`overlay-${index}`, 'DIV', { x: x + 8, y: y + 8, width: 249, height: 190 },
          { backgroundColor: 'rgba(0, 0, 0, 0.05)' }, [])] : []),
        text(`title-${index}`, title, { x: x + 12, y: y + 214, width: 200, height: 20 }),
        text(`meta-${index}`, 'PRO  139  4.8k', { x: x + 150, y: y + 214, width: 100, height: 18 })
      ]));
  });
  return {
    version: 2, assets: {}, fonts: [],
    documentTitle: 'Dribbble — Discover the World’s Top Designers',
    root: el('root', 'BODY', { x: 0, y: 0, width: W, height: 2280 },
      { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(13, 13, 13)', fontSize: '16px', lineHeight: '24px', fontFamily: 'Mona Sans, sans-serif' }, [
        el('nav', 'NAV', { x: 0, y: 0, width: W, height: 76 },
          { backgroundColor: 'rgba(255, 255, 255, 0.94)', borderTopWidth: '0px' }, [
            el('logo', 'SVG', { x: 24, y: 24, width: 78, height: 26 }, { fill: 'rgb(234, 76, 137)' }, []),
            text('nav-links', 'Explore      Hire Talent      Get Hired      Community', { x: 120, y: 28, width: 460, height: 20 }),
            el('signup', 'BUTTON', { x: 1040, y: 22, width: 74, height: 32 },
              { backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(0, 0, 0)' }, [
                text('signup-label', 'Sign up', { x: 1054, y: 29, width: 50, height: 18 })
              ]),
            el('login', 'BUTTON', { x: 1122, y: 22, width: 60, height: 32 },
              { backgroundColor: 'rgb(234, 76, 137)', borderTopLeftRadius: '6px' }, [
                text('login-label', 'Log in', { x: 1132, y: 29, width: 44, height: 18 })
              ])
          ]),
        el('promo', 'DIV', { x: 40, y: 92, width: 1120, height: 40 },
          { backgroundColor: 'rgba(234, 76, 137, 0.08)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(234, 76, 137)', borderTopLeftRadius: '999px' }, [
            text('promo-copy', 'Get 20% off your first payment for design and development services', { x: 320, y: 102, width: 520, height: 20 }),
            el('promo-cta', 'BUTTON', { x: 860, y: 100, width: 90, height: 24 },
              { backgroundColor: 'rgb(234, 76, 137)', borderTopLeftRadius: '999px' }, [
                text('promo-cta-label', 'Get started', { x: 872, y: 104, width: 66, height: 16 })
              ])
          ]),
        text('h1', 'Work with the world’s\nbest in product design', { x: 40, y: 170, width: 640, height: 150 }, 2),
        el('h1-clip', 'H1', { x: 40, y: 168, width: 470, height: 132 },
          { color: 'rgb(13, 13, 13)', fontSize: '58px', lineHeight: '64px', fontWeight: '700', fontFamily: 'Mona Sans' }, [
            text('h1-text', 'Work with the world’s best in product design', { x: 40, y: 168, width: 470, height: 132 }, 2)
          ]),
        el('sub', 'P', { x: 40, y: 320, width: 470, height: 78 },
          { color: 'rgb(78, 78, 78)', fontSize: '15px', lineHeight: '26px' }, [
            text('sub-text', 'Generate your brief and receive proposals for free. Browse real design and development work. Hire top-rated freelancers and agencies.', { x: 40, y: 320, width: 470, height: 78 }, 3)
          ]),
        el('cta', 'BUTTON', { x: 40, y: 410, width: 180, height: 40 },
          { backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(200, 200, 200)', borderTopLeftRadius: '20px' }, [
            text('cta-label', 'Start Your Project Brief', { x: 56, y: 420, width: 148, height: 20 })
          ]),
        el('hero-image', 'IMG', { x: 700, y: 160, width: 460, height: 320 },
          { borderTopLeftRadius: '18px' }, [], { alt: 'Product design showcase' }),
        el('tabs', 'DIV', { x: 40, y: 540, width: 520, height: 40 }, {}, [
          el('tab-shots', 'BUTTON', { x: 40, y: 540, width: 90, height: 36 }, { backgroundColor: 'rgb(255,255,255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(210,210,210)', borderTopLeftRadius: '18px' }, [text('tab-shots-label', 'Shots', { x: 60, y: 550, width: 50, height: 18 })]),
          el('tab-designers', 'BUTTON', { x: 140, y: 540, width: 110, height: 36 }, { backgroundColor: 'rgb(255,255,255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(210,210,210)', borderTopLeftRadius: '18px' }, [text('tab-designers-label', 'Designers', { x: 158, y: 550, width: 74, height: 18 })]),
          el('tab-services', 'BUTTON', { x: 260, y: 540, width: 100, height: 36 }, { backgroundColor: 'rgb(255,255,255)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(210,210,210)', borderTopLeftRadius: '18px' }, [text('tab-services-label', 'Services', { x: 280, y: 550, width: 62, height: 18 })])
        ]),
        el('filter-row', 'DIV', { x: 40, y: 600, width: 1120, height: 44 },
          { backgroundColor: 'rgb(250, 250, 250)', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(228, 231, 236)', borderTopLeftRadius: '22px' }, [
            text('filter-label', 'What type of design are you interested in?', { x: 60, y: 612, width: 380, height: 20 })
          ]),
        ...cards,
        el('quote', 'DIV', { x: 40, y: 1960, width: 1120, height: 130 }, { backgroundColor: 'rgb(13, 13, 13)', borderTopLeftRadius: '18px' }, [
          el('avatar', 'IMG', { x: 64, y: 1996, width: 58, height: 58 }, { borderTopLeftRadius: '50%' }, []),
          text('quote-text', '“They untangled a four-year-old dashboard in six weeks.”', { x: 146, y: 2000, width: 700, height: 28 })
        ]),
        el('footer', 'FOOTER', { x: 0, y: 2120, width: W, height: 160 }, { backgroundColor: 'rgb(234, 76, 137)' }, [
          ...['Branding', 'Print', 'Typography', 'Illustration', 'Product Design', 'Animation', 'Web Design'].map((label, index) =>
            el(`tile-${index}`, 'DIV', { x: 40 + index * 160, y: 2140, width: 140, height: 90 }, { backgroundColor: 'rgb(234, 76, 137)' }, [
              text(`tile-${index}-label`, label, { x: 48 + index * 160, y: 2190, width: 120, height: 18 })
            ])),
          text('footer-legal', '© 2026 Dribbble   Terms   Privacy   Cookies', { x: 40, y: 2250, width: 420, height: 18 })
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
