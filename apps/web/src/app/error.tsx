'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-lg font-medium text-txt-primary">Something went wrong</h2>
      <p className="text-sm text-txt-muted max-w-md text-center">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm rounded-lg bg-eigen-violet text-white hover:bg-eigen-violet/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
