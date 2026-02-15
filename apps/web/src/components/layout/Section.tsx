'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface SectionProps {
  id?: string;
  children: ReactNode;
  alternate?: boolean;
  className?: string;
  narrow?: boolean;
}

export function Section({ id, children, alternate = false, className = '', narrow = false }: SectionProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-visible');
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      id={id}
      className={`
        fade-in-section py-20 lg:py-28
        ${alternate ? 'bg-bg-alt' : 'bg-bg-void'}
        ${className}
      `}
    >
      <div className={`mx-auto px-6 lg:px-8 ${narrow ? 'max-w-4xl' : 'max-w-7xl'}`}>
        {children}
      </div>
    </section>
  );
}
