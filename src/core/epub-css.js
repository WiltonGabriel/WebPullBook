/**
 * Build e-reader-friendly EPUB CSS without locking body font-family/px font-size
 * unless the user explicitly selects a font override.
 */
export function buildEpubStylesheet({
  fontFamily = 'reader-default',
  textAlign = 'justify',
  lineHeight = 1.55,
  paragraphIndent = false
} = {}) {
  const fontRule =
    fontFamily === 'serif'
      ? '  font-family: Georgia, "Times New Roman", serif;\n'
      : fontFamily === 'sans'
        ? '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n'
        : '';

  const pMargin = paragraphIndent ? '0.15em 0' : '0.55em 0';
  const pIndent = paragraphIndent ? '  text-indent: 1.4em;\n' : '';
  const safeLineHeight = Math.min(2.4, Math.max(1.1, Number(lineHeight) || 1.55));
  const safeAlign = textAlign === 'left' ? 'left' : 'justify';

  return `body {
  margin: 2% 4%;
  line-height: ${safeLineHeight};
${fontRule}}
h1 {
  font-size: 1.55em;
  font-weight: bold;
  text-align: center;
  margin: 1.2em 0 0.7em;
  line-height: 1.25;
}
h2, h2.chapter-title {
  font-size: 1.35em;
  font-weight: bold;
  text-align: center;
  margin: 1.1em 0 0.6em;
  line-height: 1.25;
}
h3, h4, h5, h6 {
  font-size: 1.15em;
  font-weight: bold;
  text-align: center;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.chapter-subtitle {
  font-size: 1.05em;
  text-align: center;
  font-style: italic;
  opacity: 0.85;
  margin-top: -0.3em;
  margin-bottom: 1.4em;
}
p {
  margin: ${pMargin};
  text-align: ${safeAlign};
${pIndent}  overflow-wrap: break-word;
}
b, strong, .wpb-bold { font-weight: bold; }
i, em, .wpb-italic { font-style: italic; }
u, .wpb-underline { text-decoration: underline; }
s, del, .wpb-strike { text-decoration: line-through; }
small, .wpb-sm { font-size: 0.85em; }
.wpb-lg { font-size: 1.2em; }
.wpb-mono, code, pre { font-family: monospace; }
.wpb-center { text-align: center; text-indent: 0; }
.wpb-right { text-align: right; text-indent: 0; }
.wpb-left { text-align: left; }
blockquote {
  margin: 0.9em 1.2em;
  padding-left: 0.85em;
  border-left: 3px solid #888;
  font-style: italic;
}
code { font-size: 0.9em; }
pre {
  font-size: 0.88em;
  white-space: pre-wrap;
  margin: 0.8em 0;
  padding: 0.6em;
  border: 1px solid #999;
}
ul, ol {
  margin: 0.6em 0;
  padding-left: 1.6em;
}
li { margin: 0.25em 0; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.8em 0;
  font-size: 0.92em;
}
th, td {
  border: 1px solid #888;
  padding: 0.35em 0.5em;
}
img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: 0.8em auto;
}
.info-box {
  border: 1px solid #999;
  padding: 0.8em 1em;
  margin: 1em 0;
}
.info-meta p {
  text-align: left;
  text-indent: 0;
  margin: 0.3em 0;
}
div.svg_outer {
  display: block;
  margin: 0;
  padding: 0;
  text-align: center;
}
div.svg_inner {
  display: block;
  text-align: center;
}
hr {
  border: none;
  border-top: 1px solid #888;
  margin: 1.2em 0;
}
`;
}

export const DEFAULT_EPUB_CSS = buildEpubStylesheet();
