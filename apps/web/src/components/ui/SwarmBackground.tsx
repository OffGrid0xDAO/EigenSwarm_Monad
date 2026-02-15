'use client';

/**
 * Ultraviolet blob swarm — defocused organic purple shapes drifting on dark backgrounds.
 * Fixed-position layer behind all content. Pure CSS animation, no JS overhead.
 */
export function SwarmBackground() {
  return (
    <>
      <div className="swarm-bg" aria-hidden="true">
        <div className="swarm-blob swarm-blob-1" />
        <div className="swarm-blob swarm-blob-2" />
        <div className="swarm-blob swarm-blob-3" />
        <div className="swarm-blob swarm-blob-4" />
        <div className="swarm-blob swarm-blob-5" />
        <div className="swarm-blob swarm-blob-6" />
        <div className="swarm-blob swarm-blob-7" />
        <div className="swarm-blob swarm-blob-8" />
      </div>
      <div className="swarm-grain" aria-hidden="true" />
    </>
  );
}
