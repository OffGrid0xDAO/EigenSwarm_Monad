'use client';

interface Logo {
  name: string;
  svg: string;
}

interface LogoCarouselProps {
  logos: Logo[];
}

export function LogoCarousel({ logos }: LogoCarouselProps) {
  // Double the logos for seamless loop
  const doubled = [...logos, ...logos];

  return (
    <div className="logo-carousel py-8">
      <div className="logo-carousel-track">
        {doubled.map((logo, i) => (
          <div
            key={`${logo.name}-${i}`}
            className="flex items-center gap-2.5 opacity-40 hover:opacity-70 transition-opacity flex-shrink-0"
          >
            <span dangerouslySetInnerHTML={{ __html: logo.svg }} />
            <span className="text-sm font-medium text-txt-muted whitespace-nowrap">{logo.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
