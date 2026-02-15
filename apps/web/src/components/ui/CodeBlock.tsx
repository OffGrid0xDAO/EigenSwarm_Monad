'use client';

import { useState } from 'react';

interface CodeTab {
  filename: string;
  code: string;
  language?: string;
}

interface CodeBlockProps {
  tabs: CodeTab[];
  className?: string;
}

function highlightSyntax(code: string): string {
  let result = code
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments
  result = result.replace(/(\/\/.*$)/gm, '<span class="syntax-comment">$1</span>');

  // Strings (double-quoted)
  result = result.replace(/(&quot;|")((?:[^"\\]|\\.)*)(&quot;|")/g, '<span class="syntax-string">"$2"</span>');
  // Strings (single-quoted)
  result = result.replace(/(&#39;|')((?:[^'\\]|\\.)*)((&#39;|'))/g, '<span class="syntax-string">\'$2\'</span>');
  // Template literals
  result = result.replace(/(`[^`]*`)/g, '<span class="syntax-string">$1</span>');

  // Keywords
  result = result.replace(
    /\b(import|from|export|const|let|var|async|await|function|return|if|else|new|type|interface|class|extends|implements|typeof|as)\b/g,
    '<span class="syntax-keyword">$1</span>'
  );

  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="syntax-number">$1</span>');

  // Types / Capitalized words after : or as
  result = result.replace(/:\s*([A-Z]\w+)/g, ': <span class="syntax-type">$1</span>');

  // Function calls
  result = result.replace(/(\w+)\(/g, '<span class="syntax-function">$1</span>(');

  // Arrow
  result = result.replace(/=&gt;/g, '<span class="syntax-operator">=&gt;</span>');

  // Property access after .
  result = result.replace(/\.(\w+)/g, '.<span class="syntax-property">$1</span>');

  return result;
}

export function CodeBlock({ tabs, className = '' }: CodeBlockProps) {
  const [activeTab, setActiveTab] = useState(0);
  const activeCode = tabs[activeTab];

  return (
    <div className={`rounded-xl border border-border-subtle overflow-hidden ${className}`}>
      {/* Tab bar */}
      <div className="flex items-center bg-code-bg border-b border-border-subtle px-1">
        {tabs.map((tab, i) => (
          <button
            key={tab.filename}
            onClick={() => setActiveTab(i)}
            className={`
              px-3.5 py-2.5 text-xs font-mono transition-colors relative
              ${i === activeTab
                ? 'text-txt-primary'
                : 'text-txt-disabled hover:text-txt-muted'
              }
            `}
          >
            {tab.filename}
            {i === activeTab && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-txt-primary" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        {/* Copy button */}
        <button
          onClick={() => navigator.clipboard?.writeText(activeCode.code)}
          className="p-2 text-txt-disabled hover:text-txt-muted transition-colors"
          title="Copy code"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
      </div>
      {/* Code content */}
      <div className="bg-code-bg p-4 overflow-x-auto">
        <pre className="text-[13px] leading-6 font-mono">
          <code dangerouslySetInnerHTML={{ __html: highlightSyntax(activeCode.code) }} />
        </pre>
      </div>
    </div>
  );
}
