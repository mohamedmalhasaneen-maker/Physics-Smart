import React from 'react';
import katex from 'katex';

export const LatexInline = React.memo(function LatexInline({
  latex,
  className = '',
}: {
  latex: string;
  className?: string;
}) {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      strict: false,
    });
    return (
      <span
        dir="ltr"
        className={`inline-block align-middle ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return <code dir="ltr">{latex}</code>;
  }
});

export const LatexBlock = React.memo(function LatexBlock({
  latex,
  className = '',
}: {
  latex: string;
  className?: string;
}) {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: false,
    });
    return (
      <div
        dir="ltr"
        className={`my-2.5 overflow-x-auto rounded-xl glass-equation px-4 py-2.5 text-center text-slate-900 dark:text-slate-100 ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return (
      <pre dir="ltr" className="my-2 rounded-xl glass-equation p-3 text-xs text-cyan-600 dark:text-cyan-300">
        {latex}
      </pre>
    );
  }
});

/**
 * Renders prose containing mixed Arabic/English text, **bold** segments,
 * $$display$$ blocks, and $inline$ LaTeX safely.
 */
export const RichPhysicsText = React.memo(function RichPhysicsText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  if (!text) return null;

  // Split by display math $$...$$ first
  const displayParts = text.split(/(\$\$[\s\S]*?\$\$)/g);

  return (
    <div className={`space-y-2 leading-relaxed ${className}`}>
      {displayParts.map((segment, idx) => {
        if (segment.startsWith('$$') && segment.endsWith('$$') && segment.length > 4) {
          const inner = segment.slice(2, -2).trim();
          return <LatexBlock key={idx} latex={inner} />;
        }

        // Split paragraphs by newline
        const lines = segment.split('\n').filter((l) => l.trim().length > 0);
        return lines.map((line, lineIdx) => {
          // Split by inline $...$
          const inlineParts = line.split(/(\$[^$\n]+?\$)/g);
          return (
            <p key={`${idx}-${lineIdx}`} className="text-sm sm:text-[15px] leading-7">
              {inlineParts.map((part, pIdx) => {
                if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
                  return <LatexInline key={pIdx} latex={part.slice(1, -1)} className="mx-1" />;
                }
                // Handle **bold**
                const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
                return boldParts.map((bp, bIdx) => {
                  if (bp.startsWith('**') && bp.endsWith('**')) {
                    return (
                      <strong key={`${pIdx}-${bIdx}`} className="font-semibold text-slate-900 dark:text-white">
                        {bp.slice(2, -2)}
                      </strong>
                    );
                  }
                  return <React.Fragment key={`${pIdx}-${bIdx}`}>{bp}</React.Fragment>;
                });
              })}
            </p>
          );
        });
      })}
    </div>
  );
});
