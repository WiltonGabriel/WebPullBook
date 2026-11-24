const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Minimalist Lucide/Tabler-inspired 24x24 stroke icons constructed safely via `document.createElementNS`
 * (zero `innerHTML`, CSP-safe, zero runtime dependencies).
 */
const ICON_SHAPES = {
  crosshair: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '22', y1: '12', x2: '18', y2: '12' }],
    ['line', { x1: '6', y1: '12', x2: '2', y2: '12' }],
    ['line', { x1: '12', y1: '6', x2: '12', y2: '2' }],
    ['line', { x1: '12', y1: '22', x2: '12', y2: '18' }]
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: '12', y1: '15', x2: '12', y2: '3' }]
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['polyline', { points: '21 3 21 9 15 9' }]
  ],
  eye: [
    ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' }],
    ['circle', { cx: '12', cy: '12', r: '3' }]
  ],
  'search-check': [
    ['path', { d: 'm8 11 2 2 4-4' }],
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['path', { d: 'm21 21-4.3-4.3' }]
  ],
  pencil: [
    ['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }],
    ['path', { d: 'm15 5 4 4' }]
  ],
  trash: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
  ],
  sliders: [
    ['line', { x1: '4', y1: '21', x2: '4', y2: '14' }],
    ['line', { x1: '4', y1: '10', x2: '4', y2: '3' }],
    ['line', { x1: '12', y1: '21', x2: '12', y2: '12' }],
    ['line', { x1: '12', y1: '8', x2: '12', y2: '3' }],
    ['line', { x1: '20', y1: '21', x2: '20', y2: '16' }],
    ['line', { x1: '20', y1: '12', x2: '20', y2: '3' }],
    ['line', { x1: '2', y1: '14', x2: '6', y2: '14' }],
    ['line', { x1: '10', y1: '8', x2: '14', y2: '8' }],
    ['line', { x1: '18', y1: '16', x2: '22', y2: '16' }]
  ],
  x: [
    ['line', { x1: '18', y1: '6', x2: '6', y2: '18' }],
    ['line', { x1: '6', y1: '6', x2: '18', y2: '18' }]
  ],
  'check-circle': [
    ['path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }],
    ['polyline', { points: '22 4 12 14.01 9 11.01' }]
  ],
  'alert-triangle': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
    ['line', { x1: '12', y1: '9', x2: '12', y2: '13' }],
    ['line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }]
  ],
  'alert-circle': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '12', y1: '8', x2: '12', y2: '12' }],
    ['line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }]
  ],
  info: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '12', y1: '16', x2: '12', y2: '12' }],
    ['line', { x1: '12', y1: '8', x2: '12.01', y2: '8' }]
  ]
};

export function createIcon(name, { size = 16, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className ? `wpb-icon ${className}` : 'wpb-icon');

  const shapes = ICON_SHAPES[name] || ICON_SHAPES.info;
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

export function setButtonLabel(btn, text) {
  if (!btn) return;
  const labelEl = btn.querySelector?.('.wpb-btn-label');
  if (labelEl) {
    labelEl.textContent = text;
    return;
  }
  btn.textContent = text;
}

export function createIconButtonContent(btn, iconName, text, { size = 15 } = {}) {
  if (!btn) return;
  const icon = createIcon(iconName, { size });
  const label = document.createElement('span');
  label.className = 'wpb-btn-label';
  label.textContent = text;
  btn.replaceChildren(icon, label);
}

export function applyStaticIcons(root = document) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-wpb-icon]')) {
    const iconName = el.getAttribute('data-wpb-icon');
    if (!iconName) continue;
    if (el.querySelector?.('.wpb-icon')) continue;
    const isIconOnly = el.getAttribute('data-wpb-icon-only') === 'true';
    const size = isIconOnly ? 16 : 15;
    const svg = createIcon(iconName, { size });
    if (isIconOnly) {
      el.classList.add('btn-icon-only');
      el.replaceChildren(svg);
    } else if (el.firstChild) {
      el.insertBefore(svg, el.firstChild);
    } else {
      el.appendChild(svg);
    }
  }
}
