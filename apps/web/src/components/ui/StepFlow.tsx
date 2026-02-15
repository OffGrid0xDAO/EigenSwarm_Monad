'use client';

interface StepFlowProps {
  steps: string[];
  currentStep: number;
}

export function StepFlow({ steps, currentStep }: StepFlowProps) {
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        const isLast = i === steps.length - 1;

        return (
          <div key={i} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex items-center gap-2.5">
              <div
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-medium transition-all
                  ${isCompleted
                    ? 'bg-txt-primary text-bg-void'
                    : isActive
                      ? 'bg-bg-elevated text-txt-primary border border-border-hover'
                      : 'bg-bg-elevated text-txt-disabled border border-border-subtle'
                  }
                `}
              >
                {isCompleted ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2.5 6l2.5 2.5 4.5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  isActive ? 'text-txt-primary' : isCompleted ? 'text-txt-muted' : 'text-txt-disabled'
                }`}
              >
                {step}
              </span>
            </div>
            {!isLast && (
              <div
                className={`flex-1 h-px mx-4 ${
                  isCompleted ? 'bg-txt-primary' : 'bg-border-subtle'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
