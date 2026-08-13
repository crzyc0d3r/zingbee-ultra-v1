export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdownWithMath(content: string): string {
  if (!content) return "";

  let html = content;

  const katex = typeof window !== "undefined" ? (window as any).katex : null;

  const renderMath = (tex: string, displayMode: boolean): string => {
    const trimmed = tex.trim();
    if (katex) {
      try {
        return katex.renderToString(trimmed, { displayMode, throwOnError: false });
      } catch {
        // fall through
      }
    }
    return displayMode
      ? `<div class="math-display">$$${escapeHtml(trimmed)}$$</div>`
      : `<span class="math-inline">$${escapeHtml(trimmed)}$</span>`;
  };

  // Display math: $$...$$ and \[...\]
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => renderMath(tex, true));
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex) => renderMath(tex, true));

  // Inline math: $...$ and \(...\)
  html = html.replace(/\$([^$\n]+?)\$/g, (_m, tex) => renderMath(tex, false));
  html = html.replace(/\\\((.+?)\\\)/g, (_m, tex) => renderMath(tex, false));

  // Code blocks: ```...```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *...*
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headers: # ...
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Images: ![alt](url)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;" />',
  );

  // Line breaks
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`;
  }

  return html;
}
